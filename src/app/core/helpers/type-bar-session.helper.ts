import { TYPE_BAR } from '../models/constants';
import { EmulatorKeyCode, EmulatorKeyCodeHelper, KeyTask } from '../models/game';
import { MirrorStep, TypeMirror } from './type-mirror.helper';
import { TypeKeyHelper, TypedKey } from './type-key.helper';

/** How a submission to the key queue ended: the part of `KeySendResult` the bar reads. */
export interface TypeSendResult {
  completed: number;
  total: number;
  cancelled: boolean;
}

/** What the session needs from the rest of the app. Plain functions, so a spec can hand in fakes. */
export interface TypeBarHooks {
  /**
   * Hand tasks to the guest's key queue as ONE submission. Resolves when the guest has them all
   * (or `cancel()` stopped it), rejects when there is no emulator or it throws. `progress` is
   * asked for only by a send long enough to deserve it; `guardCapsLock` says whether the queue
   * should read the guest's CapsLock first (see {@link TYPE_BAR.CAPS_GUARD_REARM_MS}).
   */
  send(tasks: KeyTask[], options: { progress?: (done: number, total: number) => void; guardCapsLock: boolean }): Promise<TypeSendResult>;
  /** Tasks waiting in the queue now: a held key stops repeating while it is backed up. */
  pending(): number;
  /** The diagnostics log (category `ime`). The data is a thunk: the log is off almost always. */
  log(message: string, data?: () => unknown): void;
  /** The guest and the bar stopped agreeing because a send was cut short or failed; the bar has been cleared. */
  desync?(reason: 'cancelled' | 'failed', detail: { completed: number; total: number } | unknown): void;
  /** A long send is under way (or over: `null`), for the progress chip. */
  progress?(state: { done: number; total: number } | null): void;
  /** Code points typed as "?" in the guest. */
  substituted?(count: number): void;
}

export interface TypeBarTimers {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const BROWSER_TIMERS: TypeBarTimers = {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface TypeBarSessionOptions {
  /** See {@link TYPE_BAR.COMPOSITION_SETTLE_MS}. */
  settleMs?: number;
  timers?: TypeBarTimers;
  /** Milliseconds on a monotonic clock; a spec hands in its own. */
  now?: () => number;
}

/**
 * The type bar's field, wired to the guest: what its events mean, and when each one is allowed to
 * send. The Angular component owns the look; this owns the rules, so they can be driven with
 * scripted events against a real `<input>` and a fake queue.
 *
 * **Text comes from the field's value, never from a key.** Every `input` and `compositionend`
 * runs {@link TypeMirror.sync}, which compares the value with what the guest holds; the keyboard's
 * own opinion of what it just did (an insertion, a replacement, a swipe, a dictation, a correction)
 * does not matter, and neither does which of the two events arrives first.
 *
 * **A composition is mirrored when it ends.** While an IME holds a word it may still rewrite it
 * (a Gboard suggestion, a dictation's interim result, a Japanese conversion), and each rewrite
 * would be Backspaces and a retype in a guest that spends 20 ms a character. Mirroring the middle
 * of it was NOT shown to be safe: with interim text a second correction lands after the guest has
 * already got the first one, and a stale burst of Backspaces hits whatever the guest has focused by
 * then. So `input` events inside a composition only arm a settle timer, and `compositionend` (in
 * either order with the last `input`) syncs. The timer exists because an IME that never ends its
 * composition must not leave the bar mute: after {@link TYPE_BAR.COMPOSITION_SETTLE_MS} of quiet
 * the text as it stands is mirrored, and a later rewrite is a plain diff on top of it. A key from
 * the strip, a blur and closing the bar mirror the text as it stands too (`flush`).
 *
 * **The bar clears itself when the guest leaves the field it describes: `abandon`.** A key that
 * moves the guest (Enter, Tab, the arrows, F-keys...), a tap on the game's own field and a key from
 * the deck all do, and the bar's text then belongs to a field the guest has left: typed on, it would
 * read "FelipeSilva" over a field holding "Silva", and a Backspace past what was typed in it would
 * delete text the bar never wrote. `abandon` empties the bar and forgets what the guest holds NOW,
 * composition or not, and it ends the composition itself: a keyboard that keeps a word underlined
 * until a space does not end it for a key tapped on the strip or a tap on the game, so waiting for
 * it would leave the old field's word in the bar for good. The field gives up the focus and takes it
 * back in the same call (the browser commits a composition when its field is blurred), with nothing
 * synced on the way: the committed text belongs to the old field and the guest is already, or about
 * to be, in another. Clearing is always the safe direction: an empty bar means "I hold nothing of
 * this field", so the next text appends and a Backspace is the guest's own. Writing the value of a
 * field the IME is still composing in is how text gets resurrected on some keyboards, which is why
 * the composition is ended first and not written over. **Whether that blur and focus keeps the OS
 * keyboard open is not verified on a device**; if it does not, the bar stays docked with its keys and
 * a tap on the field brings the keyboard back.
 *
 * **A send that does not arrive whole clears the bar too** (`desync`): after a Cancelar or an
 * emulator that threw, the guest holds an unknown part of the text, and the honest state is a new,
 * empty bar. That clear (`clear`) waits for a composition to end instead of ending it, because
 * nothing about it asks the keyboard to stop: the mirror keeps describing the field exactly as it
 * is until then, so the next word still diffs against the same prefix.
 *
 * Every event of the field is written to the log (category `ime`) while the bar is open, with its
 * type, data, `isComposing`, key and `keyCode`, and so is every step that is sent: that log is what
 * the real-device pass is for.
 */
export class TypeBarSession {
  readonly mirror = new TypeMirror();

  private readonly timers: TypeBarTimers;
  private readonly settleMs: number;
  private readonly now: () => number;
  private readonly cleanups: Array<() => void> = [];
  private composing = false;
  /** `abandon` is ending a composition by blurring the field: what the browser commits on the way is not synced. */
  private abandoning = false;
  private lastLettersAt = Number.NEGATIVE_INFINITY;
  private settleHandle: unknown = null;
  private resetPending = false;
  private disposed = false;
  /** Sends in flight, so the progress chip is not cleared by a short one finishing under a long one. */
  private longSends = 0;

  constructor(
    private readonly input: HTMLInputElement,
    private readonly hooks: TypeBarHooks,
    options: TypeBarSessionOptions = {},
  ) {
    this.timers = options.timers ?? BROWSER_TIMERS;
    this.settleMs = options.settleMs ?? TYPE_BAR.COMPOSITION_SETTLE_MS;
    this.now = options.now ?? (() => performance.now());
    this.listen('beforeinput', event => this.onBeforeInput(event as InputEvent));
    this.listen('input', event => this.onInput(event as InputEvent));
    this.listen('compositionstart', event => this.onComposition('compositionstart', event as CompositionEvent));
    this.listen('compositionupdate', event => this.onComposition('compositionupdate', event as CompositionEvent));
    this.listen('compositionend', event => this.onComposition('compositionend', event as CompositionEvent));
    this.listen('keydown', event => this.onKeyDown(event as KeyboardEvent));
    this.listen('keyup', event => this.onKeyUp(event as KeyboardEvent));
    this.listen('blur', () => this.onBlur());
    this.listen('focus', () => this.hooks.log('focus', () => ({ value: this.input.value })));
    this.listen('paste', () => this.hooks.log('paste', () => ({ value: this.input.value })));
  }

  /**
   * Mirror the field as it stands, composition or not. Used before a key from the strip, on blur,
   * on the settle timer and on close: all of them are "send what the player can see".
   */
  flush(why: string): void {
    if (this.disposed) return;
    this.cancelSettle();
    this.syncNow(why);
  }

  /**
   * A key from the strip (or the page): what is in the bar first, then the key. A key that moves
   * the guest clears the bar afterwards.
   */
  press(codes: readonly EmulatorKeyCode[], name: string): void {
    if (this.disposed) return;
    this.flush(`before ${name}`);
    this.sendKey({ codes: [...codes], name, resets: TypeKeyHelper.resetsField(codes), repeatable: false });
  }

  /**
   * The strip's Backspace. In a bar with text it is an edit of the bar (the mirror then deletes in
   * the guest); in an empty one it is the guest's own Backspace, which is how a field the bar
   * never held is cleared from the phone.
   */
  backspace(): void {
    if (this.disposed) return;
    this.flush('before Backspace');
    // The value is about to be written, and a field the IME is composing in must not be written to
    // (it is how text is resurrected): the composition is committed first, as it stands, which the
    // flush above has already sent.
    if (this.composing) this.endComposition('strip Backspace');
    const points = Array.from(this.input.value);
    if (points.length === 0 || TypeMirror.settled(this.input.value).length === 0) {
      // Nothing the guest holds comes from the bar: the key is the guest's own. A space or two
      // held back are dropped with it, so the player's next Backspace is not a no-op.
      if (points.length > 0) this.input.value = '';
      this.sendKey({ codes: [EmulatorKeyCode.KBD_backspace], name: 'Backspace', resets: false, repeatable: true });
      return;
    }
    points.pop();
    this.hooks.log('strip Backspace edits the bar', () => ({ value: this.input.value }));
    this.input.value = points.join('');
    this.syncNow('strip Backspace');
  }

  /** Empty the bar and forget what the guest holds, now if no composition is active, else when it ends. */
  clear(why: string): void {
    if (this.disposed) return;
    this.resetPending = true;
    this.applyResetIfIdle(why);
  }

  /**
   * The guest has left the field the bar describes (a key that moves it, a tap on the game, a key
   * from the deck): empty the bar and forget what the guest holds now, ending any composition
   * first. `flush` mirrors what the player can see before it goes, for a caller that runs while the
   * guest is still in the old field (the start of a touch); a key already sent from elsewhere has
   * left that field behind, and text sent after it would land in the new one.
   */
  abandon(why: string, options: { flush?: boolean } = {}): void {
    if (this.disposed) return;
    if (options.flush) this.flush(`before ${why}`);
    if (!this.composing && this.input.value === '' && this.mirror.isEmpty) {
      // Nothing to forget, and a clear that was waiting has nothing left to empty either.
      this.resetPending = false;
      return;
    }
    this.resetPending = true;
    if (this.composing) this.endComposition(why);
    this.applyResetIfIdle(why);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelSettle();
    while (this.cleanups.length > 0) this.cleanups.pop()?.();
    this.hooks.log('session closed', () => ({ held: this.mirror.guestText.length }));
  }

  // ------------------------------------------------------------------------------ events

  private onBeforeInput(event: InputEvent): void {
    this.hooks.log('beforeinput', () => ({
      type: event.inputType, data: event.data, composing: event.isComposing, value: this.input.value,
    }));
  }

  private onInput(event: InputEvent): void {
    if (this.abandoning) return;
    // The event's own word beats the flag: a browser that orders `compositionend` after the last
    // `input` says "composing" on that input, and one that orders it before says "not".
    if (typeof event.isComposing === 'boolean') this.composing = event.isComposing;
    this.hooks.log('input', () => ({
      type: event.inputType, data: event.data, composing: this.composing, value: this.input.value,
    }));
    this.afterValueChange('input');
  }

  private onComposition(type: 'compositionstart' | 'compositionupdate' | 'compositionend', event: CompositionEvent): void {
    this.hooks.log(type, () => ({ data: event.data, value: this.input.value }));
    if (this.abandoning) return;
    if (type === 'compositionend') {
      this.composing = false;
      this.cancelSettle();
      this.syncNow('compositionend');
      this.applyResetIfIdle('compositionend');
      return;
    }
    this.composing = true;
    this.armSettle();
  }

  private onKeyDown(event: KeyboardEvent): void {
    this.hooks.log('keydown', () => ({
      key: event.key, code: event.code, keyCode: event.keyCode, composing: event.isComposing,
      repeat: event.repeat, shift: event.shiftKey, ctrl: event.ctrlKey, alt: event.altKey,
    }));
    const key = TypeKeyHelper.fromKeyboardEvent(event, this.input.value === '' && !this.composing);
    if (!key) return;

    // Always ours, even when it comes to nothing: Tab would leave the field, Enter would submit,
    // F5 would reload the page, an arrow would move the caret in the bar and not in the game.
    event.preventDefault();
    if (event.repeat && (!key.repeatable || this.hooks.pending() >= TYPE_BAR.REPEAT_MAX_PENDING)) return;
    this.flush(`before ${key.name}`);
    this.sendKey(key);
  }

  private onKeyUp(event: KeyboardEvent): void {
    this.hooks.log('keyup', () => ({ key: event.key, code: event.code, keyCode: event.keyCode, composing: event.isComposing }));
  }

  private onBlur(): void {
    this.hooks.log('blur', () => ({ value: this.input.value, composing: this.composing }));
    if (this.abandoning) return;
    // Leaving the field commits a composition on every browser that has one, and some deliver the
    // `compositionend` late or not at all: what the player can see is what the guest gets.
    this.composing = false;
    this.flush('blur');
    this.applyResetIfIdle('blur');
  }

  // ------------------------------------------------------------------------------ the sync

  private afterValueChange(why: string): void {
    if (this.composing) {
      this.armSettle();
      return;
    }
    this.cancelSettle();
    this.syncNow(why);
    this.applyResetIfIdle(why);
  }

  private syncNow(why: string): void {
    const step = this.mirror.sync(this.input.value);
    if (!step) return;
    this.transmit(step, why);
  }

  private transmit(step: MirrorStep, why: string): void {
    const planned = TypeMirror.plan(step);
    this.hooks.log('sync', () => ({
      why, backspaces: step.backspaces, typed: step.text, tasks: planned.tasks.length, guest: this.mirror.guestText,
    }));
    if (planned.substituted > 0) this.hooks.substituted?.(planned.substituted);
    this.dispatch(planned.tasks, why);
  }

  private sendKey(key: TypedKey): void {
    this.hooks.log('key', () => ({ name: key.name, codes: key.codes }));
    this.dispatch([{ kind: 'chord', keys: key.codes }], key.name);
    if (key.resets) this.abandon(key.name);
  }

  /** One submission to the queue, and what to do about the guest when it does not arrive whole. */
  private dispatch(tasks: KeyTask[], why: string): void {
    const long = tasks.length >= TYPE_BAR.PROGRESS_MIN_TASKS;
    if (long) {
      this.longSends++;
      this.hooks.progress?.({ done: 0, total: tasks.length });
    }
    const finish = () => {
      if (!long) return;
      this.longSends = Math.max(0, this.longSends - 1);
      if (this.longSends === 0) this.hooks.progress?.(null);
    };

    this.hooks.send(tasks, {
      ...(long ? { progress: (done: number, total: number) => this.hooks.progress?.({ done, total }) } : {}),
      guardCapsLock: this.capsGuardDue(tasks),
    }).then(
      result => {
        finish();
        if (result.cancelled || result.completed < result.total) {
          this.hooks.log('send cut short', () => ({ why, ...result }));
          this.desync('cancelled', result);
        }
      },
      error => {
        finish();
        this.hooks.log('send failed', () => ({ why, error: String(error) }));
        this.desync('failed', error);
      },
    );
  }

  /**
   * The key queue reads the guest's CapsLock before a text that types letters, which is a round trip
   * to the emulator: per keystroke that would be one in the middle of every word. Nothing on a phone
   * can toggle the guest's CapsLock (only a hardware keyboard forwarded to it can), so the bar asks
   * when it first types letters and again only after {@link TYPE_BAR.CAPS_GUARD_REARM_MS} without
   * typing any: the clock is the last send of letters, guarded or not.
   */
  private capsGuardDue(tasks: readonly KeyTask[]): boolean {
    if (!EmulatorKeyCodeHelper.typesLetters(tasks)) return false;
    const now = this.now();
    const due = now - this.lastLettersAt >= TYPE_BAR.CAPS_GUARD_REARM_MS;
    this.lastLettersAt = now;
    return due;
  }

  private desync(reason: 'cancelled' | 'failed', detail: unknown): void {
    if (this.disposed) return;
    this.clear(`send ${reason}`);
    this.hooks.desync?.(reason, detail);
  }

  // -------------------------------------------------------------------------------- reset

  /**
   * End the IME's hold on the field from inside the player's gesture: blur commits a composition,
   * focus takes the field back so the keyboard is not left closed. Whatever the browser commits or
   * reports on the way is ignored (`abandoning`); the clear that follows empties the field.
   */
  private endComposition(why: string): void {
    this.hooks.log('composition ended by the bar', () => ({ why, value: this.input.value }));
    this.composing = false;
    this.cancelSettle();
    this.abandoning = true;
    try {
      if (this.input.ownerDocument.activeElement === this.input) {
        this.input.blur();
        this.input.focus({ preventScroll: true });
      }
    } finally {
      this.abandoning = false;
    }
  }

  /** The clear and the mirror's reset, together, when no composition is active. */
  private applyResetIfIdle(why: string): void {
    if (!this.resetPending) return;
    if (this.composing) {
      this.hooks.log('clear deferred', () => ({ why }));
      return;
    }
    this.resetPending = false;
    this.cancelSettle();
    this.input.value = '';
    this.mirror.reset();
    this.hooks.log('cleared', () => ({ why }));
  }

  // -------------------------------------------------------------------------------- timers

  private armSettle(): void {
    if (this.settleMs <= 0) return;
    this.cancelSettle();
    this.settleHandle = this.timers.setTimeout(() => {
      this.settleHandle = null;
      this.hooks.log('composition settled', () => ({ value: this.input.value }));
      this.syncNow('settle');
    }, this.settleMs);
  }

  private cancelSettle(): void {
    if (this.settleHandle === null) return;
    this.timers.clearTimeout(this.settleHandle);
    this.settleHandle = null;
  }

  private listen(type: string, handler: (event: Event) => void): void {
    this.input.addEventListener(type, handler);
    this.cleanups.push(() => this.input.removeEventListener(type, handler));
  }
}
