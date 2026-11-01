import { fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { TYPE_BAR } from '../models/constants';
import { EmulatorKeyCode, KeyTask } from '../models/game';
import { labels } from './type-bar.testing';
import { TypeBarHooks, TypeBarSession, TypeSendResult } from './type-bar-session.helper';

const K = EmulatorKeyCode;
const SETTLE = TYPE_BAR.COMPOSITION_SETTLE_MS;

/** fakeAsync that does not drain what is left, so "nothing is still scheduled" is something a spec can assert. */
const strict = (body: () => void) => fakeAsync(body, { flush: false });

const whole = (tasks: KeyTask[]): TypeSendResult => ({ completed: tasks.length, total: tasks.length, cancelled: false });

interface Rig {
  input: HTMLInputElement;
  session: TypeBarSession;
  /** Every submission to the fake queue, as a line of words (see type-bar.testing). */
  sent: string[];
  /** The tasks of each submission, for the specs that need the real thing. */
  tasks: KeyTask[][];
  log: string[];
  progress: Array<{ done: number; total: number } | null>;
  desyncs: string[];
  substituted: number[];
  /** Whether each submission asked the queue to read the guest's CapsLock first. */
  guards: boolean[];
  /** The clock the session reads, in ms; a spec moves it. */
  clock: { now: number };
  queue: { pending: number; answer: (tasks: KeyTask[]) => Promise<TypeSendResult> };
  finish: () => void;
}

/**
 * A real <input> in the document (the events are real events with real defaults), a fake queue that
 * records what it was handed in order, and the session between them. The queue answers at once
 * unless a spec swaps `queue.answer`.
 */
function rig(options: { settleMs?: number } = {}): Rig {
  const input = document.createElement('input');
  document.body.appendChild(input);
  const sent: string[] = [];
  const tasks: KeyTask[][] = [];
  const log: string[] = [];
  const progress: Rig['progress'] = [];
  const desyncs: string[] = [];
  const substituted: number[] = [];
  const guards: boolean[] = [];
  const clock = { now: 0 };
  const queue: Rig['queue'] = { pending: 0, answer: list => Promise.resolve(whole(list)) };

  const hooks: TypeBarHooks = {
    send: (list, sendOptions) => {
      sent.push(labels(list));
      tasks.push(list);
      guards.push(sendOptions.guardCapsLock);
      if (sendOptions.progress) sendOptions.progress(0, list.length);
      return queue.answer(list);
    },
    pending: () => queue.pending,
    log: message => { log.push(message); },
    desync: reason => { desyncs.push(reason); },
    progress: state => { progress.push(state); },
    substituted: count => { substituted.push(count); },
  };
  const session = new TypeBarSession(input, hooks, { settleMs: options.settleMs, now: () => clock.now });
  return {
    input, session, sent, tasks, log, progress, desyncs, substituted, guards, clock, queue,
    finish: () => { session.dispose(); input.remove(); },
  };
}

// ---- the events a keyboard produces ----

/** One character typed the way iOS and a hardware keyboard do it: beforeinput, the change, input. */
function typeChar(r: Rig, char: string): void {
  r.input.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: char, bubbles: true, cancelable: true }));
  r.input.value += char;
  r.input.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: char, bubbles: true }));
}

function typeText(r: Rig, text: string): void {
  for (const char of Array.from(text)) typeChar(r, char);
}

/** The field changes to `value` in one input event (a paste, a suggestion, a Backspace, a swipe). */
function change(r: Rig, value: string, inputType = 'insertReplacementText', composing = false): void {
  r.input.dispatchEvent(new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true }));
  r.input.value = value;
  r.input.dispatchEvent(new InputEvent('input', { inputType, isComposing: composing, bubbles: true }));
}

const compositionStart = (r: Rig) => r.input.dispatchEvent(new CompositionEvent('compositionstart', { data: '', bubbles: true }));

/** An IME rewriting the word it holds: the value follows, inside the composition. */
function compose(r: Rig, text: string): void {
  r.input.dispatchEvent(new CompositionEvent('compositionupdate', { data: text, bubbles: true }));
  change(r, text, 'insertCompositionText', true);
}

function compositionEnd(r: Rig, text: string): void {
  r.input.dispatchEvent(new CompositionEvent('compositionend', { data: text, bubbles: true }));
}

function keydown(r: Rig, init: KeyboardEventInit & { keyCode?: number }): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  r.input.dispatchEvent(event);
  return event;
}

describe('TypeBarSession', () => {

  describe('plain typing (iOS, a hardware keyboard)', () => {

    it('sends each character as it is typed, accents as Alt codes, in order', strict(() => {
      const r = rig();
      typeText(r, 'João');
      flushMicrotasks();
      expect(r.sent).toEqual(['J', 'o', 'alt227', 'o']);
      r.finish();
    }));

    it('holds the keyboard\'s trailing space back until a character follows it', strict(() => {
      const r = rig();
      typeText(r, 'Zé');
      typeChar(r, ' ');
      expect(r.sent).toEqual(['Z', 'alt233']);
      typeChar(r, 'R');
      expect(r.sent).toEqual(['Z', 'alt233', '_ R']);
      r.finish();
    }));

    it('follows a suggestion tap that rewrites the word and adds a space', strict(() => {
      const r = rig();
      typeText(r, 'Felipa');
      change(r, 'Felipão ', 'insertReplacementText');
      expect(r.sent.slice(6)).toEqual(['BS alt227 o']);
      typeChar(r, 'S');
      expect(r.sent.slice(7)).toEqual(['_ S']);
      r.finish();
    }));

    it('deletes through composed text one guest Backspace at a time', strict(() => {
      const r = rig();
      change(r, 'João', 'insertText');
      change(r, 'Joã', 'deleteContentBackward');
      change(r, 'Jo', 'deleteContentBackward');
      change(r, '', 'deleteContentBackward');
      expect(r.sent).toEqual(['J o alt227 o', 'BS', 'BS', 'BS BS']);
      r.finish();
    }));

    it('counts an emoji as one character in both directions', strict(() => {
      const r = rig();
      change(r, 'a\u{1F600}b', 'insertText');
      change(r, 'a', 'deleteContentBackward');
      expect(r.sent).toEqual(['a ? b', 'BS BS']);
      expect(r.substituted).toEqual([1]);
      r.finish();
    }));

    it('treats a paste of 80 characters as one send with progress, and the progress ends with it', strict(() => {
      const r = rig();
      const pasted = 'a'.repeat(80);
      let release: (result: TypeSendResult) => void = () => undefined;
      r.queue.answer = () => new Promise(resolve => { release = resolve; });
      change(r, pasted, 'insertFromPaste');
      expect(r.sent.length).toBe(1);
      expect(r.tasks[0].length).toBe(80);
      expect(r.progress).toEqual([{ done: 0, total: 80 }, { done: 0, total: 80 }]);
      release({ completed: 80, total: 80, cancelled: false });
      flushMicrotasks();
      expect(r.progress[r.progress.length - 1]).toBeNull();
      expect(r.desyncs).toEqual([]);
      r.finish();
    }));

    it('shows no progress for a send too short to deserve it', strict(() => {
      const r = rig();
      typeText(r, 'abc');
      flushMicrotasks();
      expect(r.progress).toEqual([]);
      r.finish();
    }));
  });

  describe('an IME composition (Gboard, Samsung Keyboard)', () => {

    it('mirrors nothing while the word is being composed, and the whole word when it ends', strict(() => {
      const r = rig();
      compositionStart(r);
      compose(r, 'F');
      compose(r, 'Feli');
      compose(r, 'Felipao');
      compose(r, 'Felipe');
      expect(r.sent).toEqual([]);
      compositionEnd(r, 'Felipe');
      expect(r.sent).toEqual(['F e l i p e']);
      r.finish();
    }));

    it('sends once whichever of compositionend and the last input comes first', strict(() => {
      // Chrome: the last input is still "composing", then compositionend.
      const chrome = rig();
      compositionStart(chrome);
      compose(chrome, 'Zé');
      compositionEnd(chrome, 'Zé');
      expect(chrome.sent).toEqual(['Z alt233']);
      chrome.finish();

      // Safari: compositionend first, then the input that carries the commit.
      const safari = rig();
      compositionStart(safari);
      safari.input.value = 'Zé';
      compositionEnd(safari, 'Zé');
      change(safari, 'Zé', 'insertText');
      expect(safari.sent).toEqual(['Z alt233']);
      safari.finish();
    }));

    it('rewrites on top of what a settled composition already sent', strict(() => {
      const r = rig();
      compositionStart(r);
      compose(r, 'Felipao');
      expect(r.sent).toEqual([]);
      tick(SETTLE);
      expect(r.sent).toEqual(['F e l i p a o']);
      compose(r, 'Felipão');
      compositionEnd(r, 'Felipão');
      expect(r.sent).toEqual(['F e l i p a o', 'BS BS alt227 o']);
      r.finish();
    }));

    it('does not settle while the keyboard keeps changing the word', strict(() => {
      const r = rig();
      compositionStart(r);
      compose(r, 'S');
      tick(SETTLE - 1);
      compose(r, 'Si');
      tick(SETTLE - 1);
      compose(r, 'Sil');
      expect(r.sent).toEqual([]);
      compositionEnd(r, 'Sil');
      expect(r.sent).toEqual(['S i l']);
      r.finish();
    }));

    it('leaves nothing scheduled once the composition has ended', strict(() => {
      const r = rig();
      compositionStart(r);
      compose(r, 'Ze');
      compositionEnd(r, 'Ze');
      expect(r.sent).toEqual(['Z e']);
      r.finish();
    }));

    it('commits only on compositionend when the settle timer is switched off', strict(() => {
      const r = rig({ settleMs: 0 });
      compositionStart(r);
      compose(r, 'Zico');
      tick(60 * 1000);
      expect(r.sent).toEqual([]);
      compositionEnd(r, 'Zico');
      expect(r.sent).toEqual(['Z i c o']);
      r.finish();
    }));

    it('mirrors the word as it stands when the field loses the focus mid-composition', strict(() => {
      const r = rig();
      compositionStart(r);
      compose(r, 'Rai');
      r.input.dispatchEvent(new FocusEvent('blur'));
      expect(r.sent).toEqual(['R a i']);
      r.finish();
    }));

    it('keeps typing after a composition in the same field', strict(() => {
      const r = rig();
      compositionStart(r);
      compose(r, 'Zé');
      compositionEnd(r, 'Zé');
      typeChar(r, ' ');
      typeChar(r, 'R');
      expect(r.sent).toEqual(['Z alt233', '_ R']);
      r.finish();
    }));
  });

  describe('named keys', () => {

    it('sends Enter from its keydown, stops the browser\'s own handling, and clears the bar', strict(() => {
      const r = rig();
      typeText(r, 'Leu');
      const event = keydown(r, { key: 'Enter', keyCode: 13 });
      expect(event.defaultPrevented).toBeTrue();
      expect(r.sent).toEqual(['L', 'e', 'u', 'ENTER']);
      expect(r.input.value).toBe('');
      expect(r.session.mirror.isEmpty).toBeTrue();
      // The next field starts from nothing: no Backspaces for the name that was in the last one.
      typeText(r, 'Ze');
      expect(r.sent.slice(4)).toEqual(['Z', 'e']);
      r.finish();
    }));

    it('sends Tab and Shift+Tab and keeps the browser from moving the focus', strict(() => {
      const r = rig();
      expect(keydown(r, { key: 'Tab', keyCode: 9 }).defaultPrevented).toBeTrue();
      expect(keydown(r, { key: 'Tab', keyCode: 9, shiftKey: true }).defaultPrevented).toBeTrue();
      expect(r.tasks).toEqual([
        [{ kind: 'chord', keys: [K.KBD_tab] }],
        [{ kind: 'chord', keys: [K.KBD_leftshift, K.KBD_tab] }],
      ]);
      r.finish();
    }));

    it('sends Esc, the arrows and the function keys as the game\'s own', strict(() => {
      const r = rig();
      for (const key of ['Escape', 'ArrowLeft', 'ArrowDown', 'F5']) keydown(r, { key });
      expect(r.tasks.map(list => (list[0] as { keys: number[] }).keys)).toEqual([[K.KBD_esc], [K.KBD_left], [K.KBD_down], [K.KBD_f5]]);
      r.finish();
    }));

    it('mirrors the text first, then the key, when a key arrives with text the guest has not got', strict(() => {
      const r = rig({ settleMs: 0 });
      compositionStart(r);
      compose(r, 'Zé');
      expect(r.sent).toEqual([]);
      keydown(r, { key: 'F5' });
      expect(r.sent).toEqual(['Z alt233', 'F5']);
      expect(r.tasks[1]).toEqual([{ kind: 'chord', keys: [K.KBD_f5] }]);
      r.finish();
    }));

    it('ignores a key the IME is in the middle of, however it says so', strict(() => {
      const r = rig();
      keydown(r, { key: 'Enter', isComposing: true });
      keydown(r, { key: 'Unidentified', keyCode: 229 });
      keydown(r, { key: 'Enter', keyCode: 229 });
      expect(r.sent).toEqual([]);
      r.finish();
    }));

    it('leaves a held Enter, Esc or Tab alone after the first press', strict(() => {
      const r = rig();
      keydown(r, { key: 'Enter' });
      keydown(r, { key: 'Enter', repeat: true });
      keydown(r, { key: 'Enter', repeat: true });
      expect(r.sent).toEqual(['ENTER']);
      r.finish();
    }));

    it('lets a held arrow repeat while the queue is not backed up, and not while it is', strict(() => {
      const r = rig();
      keydown(r, { key: 'ArrowDown' });
      keydown(r, { key: 'ArrowDown', repeat: true });
      r.queue.pending = TYPE_BAR.REPEAT_MAX_PENDING;
      keydown(r, { key: 'ArrowDown', repeat: true });
      expect(r.sent.length).toBe(2);
      r.finish();
    }));

    it('leaves letters to the input event: a keydown for "a" sends nothing', strict(() => {
      const r = rig();
      keydown(r, { key: 'a' });
      keydown(r, { key: 'a', keyCode: 229 });
      expect(r.sent).toEqual([]);
      r.finish();
    }));
  });

  describe('Backspace', () => {

    it('in an empty field is the guest\'s own Backspace, because no input event will say so', strict(() => {
      const r = rig();
      const event = keydown(r, { key: 'Backspace', keyCode: 8 });
      expect(event.defaultPrevented).toBeTrue();
      expect(r.sent).toEqual(['BS']);
      r.finish();
    }));

    it('in a field with text is the input event\'s to carry, and goes once', strict(() => {
      const r = rig();
      typeText(r, 'Ze');
      keydown(r, { key: 'Backspace', keyCode: 8 });
      change(r, 'Z', 'deleteContentBackward');
      expect(r.sent).toEqual(['Z', 'e', 'BS']);
      r.finish();
    }));

    it('goes on into the guest\'s field past the bar\'s last character', strict(() => {
      const r = rig();
      typeText(r, 'Ze');
      change(r, 'Z', 'deleteContentBackward');
      change(r, '', 'deleteContentBackward');
      keydown(r, { key: 'Backspace', keyCode: 8 });
      keydown(r, { key: 'Backspace', keyCode: 8 });
      expect(r.sent).toEqual(['Z', 'e', 'BS', 'BS', 'BS', 'BS']);
      r.finish();
    }));

    it('from the strip edits the bar and the guest together', strict(() => {
      const r = rig();
      typeText(r, 'Ze');
      r.session.backspace();
      expect(r.input.value).toBe('Z');
      expect(r.sent).toEqual(['Z', 'e', 'BS']);
      r.session.backspace();
      r.session.backspace();
      expect(r.input.value).toBe('');
      expect(r.sent).toEqual(['Z', 'e', 'BS', 'BS', 'BS']);
      r.finish();
    }));

    it('from the strip, with only held spaces in the bar, is the guest\'s own', strict(() => {
      const r = rig();
      typeText(r, 'Ze');
      r.session.press([K.KBD_enter], 'Enter');
      typeChar(r, ' ');
      r.session.backspace();
      expect(r.input.value).toBe('');
      expect(r.sent.slice(3)).toEqual(['BS']);
      r.finish();
    }));
  });

  describe('keys from the strip', () => {

    it('flush the bar first, then press, then clear', strict(() => {
      const r = rig({ settleMs: 0 });
      compositionStart(r);
      compose(r, 'Leu');
      r.session.press([K.KBD_tab], 'Tab');
      expect(r.sent).toEqual(['L e u', 'TAB']);
      r.finish();
    }));

    it('end a composition that is still going and clear the bar at once, so the old field\'s word cannot stay in it', strict(() => {
      const r = rig({ settleMs: 0 });
      r.input.focus();
      compositionStart(r);
      compose(r, 'Leu');
      r.session.press([K.KBD_enter], 'Enter');
      expect(r.input.value).toBe('');
      expect(r.session.mirror.isEmpty).toBeTrue();
      // The field is the player's again, not left blurred: the keyboard stays where it is.
      expect(document.activeElement).toBe(r.input);
      // What the IME says later is about a word that is gone: nothing goes to the new field for it.
      compositionEnd(r, 'Leu');
      expect(r.sent).toEqual(['L e u', 'ENTER']);
      // And the next word is a new word.
      change(r, 'S', 'insertText');
      expect(r.sent).toEqual(['L e u', 'ENTER', 'S']);
      r.finish();
    }));

    it('sync nothing of what the browser commits while the composition is being ended', strict(() => {
      const r = rig({ settleMs: 0 });
      r.input.focus();
      compositionStart(r);
      compose(r, 'Leu');
      // A browser that commits a different text on blur, with its events: none of it is for the new field.
      spyOn(r.input, 'blur').and.callFake(() => {
        r.input.value = 'Leu!';
        r.input.dispatchEvent(new FocusEvent('blur'));
        r.input.dispatchEvent(new InputEvent('input', { inputType: 'insertFromComposition', isComposing: false, bubbles: true }));
        compositionEnd(r, 'Leu!');
      });
      r.session.press([K.KBD_tab], 'Tab');
      expect(r.sent).toEqual(['L e u', 'TAB']);
      expect(r.input.value).toBe('');
      r.finish();
    }));

    it('clear at once when nothing is composing', strict(() => {
      const r = rig();
      typeText(r, 'Leu');
      r.session.press([K.KBD_enter], 'Enter');
      expect(r.input.value).toBe('');
      r.finish();
    }));

    it('do not clear the bar for a key that does not move the guest', strict(() => {
      const r = rig();
      typeText(r, 'Leu');
      r.session.press([K.KBD_backspace], 'Backspace');
      expect(r.input.value).toBe('Leu');
      r.finish();
    }));

    it('end the composition before the Backspace edits the bar, instead of writing over the IME', strict(() => {
      const r = rig({ settleMs: 0 });
      r.input.focus();
      compositionStart(r);
      compose(r, 'Leu');
      r.session.backspace();
      expect(r.input.value).toBe('Le');
      expect(r.sent).toEqual(['L e u', 'BS']);
      expect(r.log).toContain('composition ended by the bar');
      r.finish();
    }));
  });

  describe('the CapsLock guard', () => {

    it('is asked for the first text that types letters, and not for the keystrokes after it', strict(() => {
      const r = rig();
      typeText(r, 'Ze');
      expect(r.guards).toEqual([true, false]);
      r.finish();
    }));

    it('is not asked for what types no letters: digits, accents, keys', strict(() => {
      const r = rig();
      typeText(r, '12');
      typeChar(r, 'é');
      r.session.press([K.KBD_tab], 'Tab');
      expect(r.guards).toEqual([false, false, false, false]);
      typeChar(r, 'a');
      expect(r.guards[4]).toBeTrue();
      r.finish();
    }));

    it('is asked again only after a silence, not every fifteen seconds of continuous typing', strict(() => {
      const r = rig();
      // A minute of typing, a letter every ten seconds: the first one is guarded and no other.
      for (let second = 0; second <= 60; second += 10) {
        r.clock.now = second * 1000;
        typeChar(r, 'a');
      }
      expect(r.guards).toEqual([true, false, false, false, false, false, false]);
      // Then the player stops for longer than the re-arm time.
      r.clock.now = 60 * 1000 + TYPE_BAR.CAPS_GUARD_REARM_MS;
      typeChar(r, 'b');
      expect(r.guards[7]).toBeTrue();
      r.finish();
    }));
  });

  describe('the guest leaves the field (a tap on the game, a key from the deck)', () => {

    it('empties a bar that holds text, so the next word is not typed onto the old one', strict(() => {
      const r = rig();
      typeText(r, 'Felipe');
      r.session.abandon('tap on the game', { flush: true });
      expect(r.input.value).toBe('');
      expect(r.session.mirror.isEmpty).toBeTrue();
      typeText(r, 'Silva');
      // 'Silva' only: the guest's other field never gets the stale 'Felipe' prefix back.
      expect(r.sent.slice(6)).toEqual(['S', 'i', 'l', 'v', 'a']);
      expect(r.input.value).toBe('Silva');
      r.finish();
    }));

    it('then makes a Backspace the guest\'s own, which is what an empty bar means', strict(() => {
      const r = rig();
      typeText(r, 'Ze');
      r.session.abandon('tap on the game', { flush: true });
      keydown(r, { key: 'Backspace', keyCode: 8 });
      expect(r.sent).toEqual(['Z', 'e', 'BS']);
      r.finish();
    }));

    it('mirrors the word still being composed first when the guest has not moved yet (the start of a touch)', strict(() => {
      const r = rig({ settleMs: 0 });
      r.input.focus();
      compositionStart(r);
      compose(r, 'Leu');
      expect(r.sent).toEqual([]);
      r.session.abandon('tap on the game', { flush: true });
      expect(r.sent).toEqual(['L e u']);
      expect(r.input.value).toBe('');
      expect(r.session.mirror.isEmpty).toBeTrue();
      r.finish();
    }));

    it('does not mirror it when the guest has already moved (a key that came from elsewhere), which would type into the new field', strict(() => {
      const r = rig({ settleMs: 0 });
      r.input.focus();
      compositionStart(r);
      compose(r, 'Leu');
      r.session.abandon('keys from elsewhere');
      expect(r.sent).toEqual([]);
      expect(r.input.value).toBe('');
      compositionEnd(r, 'Leu');
      expect(r.sent).toEqual([]);
      r.finish();
    }));

    it('is nothing at all for an empty bar: no clear, no blur, no log line a device pass would have to read past', strict(() => {
      const r = rig({ settleMs: 0 });
      r.input.focus();
      const blur = spyOn(r.input, 'blur').and.callThrough();
      r.session.abandon('tap on the game', { flush: true });
      expect(r.log).not.toContain('cleared');
      expect(blur).not.toHaveBeenCalled();
      r.finish();
    }));

    it('does not blur a field that is not composing: only an IME holding a word needs ending', strict(() => {
      const r = rig();
      r.input.focus();
      typeText(r, 'Ze');
      const blur = spyOn(r.input, 'blur').and.callThrough();
      r.session.abandon('tap on the game', { flush: true });
      expect(blur).not.toHaveBeenCalled();
      expect(r.input.value).toBe('');
      r.finish();
    }));

    it('does nothing once the session is closed', strict(() => {
      const r = rig();
      typeText(r, 'Ze');
      r.session.dispose();
      r.session.abandon('tap on the game', { flush: true });
      expect(r.input.value).toBe('Ze');
      r.input.remove();
    }));
  });

  describe('a send that does not arrive whole', () => {

    it('clears the bar and says so when a long send is cancelled halfway', strict(() => {
      const r = rig();
      r.queue.answer = () => Promise.resolve({ completed: 30, total: 80, cancelled: true });
      change(r, 'b'.repeat(80), 'insertFromPaste');
      flushMicrotasks();
      expect(r.desyncs).toEqual(['cancelled']);
      expect(r.input.value).toBe('');
      expect(r.session.mirror.isEmpty).toBeTrue();
      r.queue.answer = list => Promise.resolve(whole(list));
      typeText(r, 'ok');
      expect(r.sent.slice(1)).toEqual(['o', 'k']);
      r.finish();
    }));

    it('clears the bar and says so when the emulator throws', strict(() => {
      const r = rig();
      r.queue.answer = () => Promise.reject(new Error('gone'));
      typeChar(r, 'x');
      flushMicrotasks();
      expect(r.desyncs).toEqual(['failed']);
      expect(r.input.value).toBe('');
      r.finish();
    }));

    it('ends the progress even when a short send finishes under a long one', strict(() => {
      const r = rig();
      const releases: Array<(result: TypeSendResult) => void> = [];
      r.queue.answer = () => new Promise(resolve => { releases.push(resolve); });
      change(r, 'c'.repeat(40), 'insertFromPaste');
      typeChar(r, 'd');
      releases[1]({ completed: 1, total: 1, cancelled: false });
      flushMicrotasks();
      expect(r.progress[r.progress.length - 1]).not.toBeNull();
      releases[0]({ completed: 40, total: 40, cancelled: false });
      flushMicrotasks();
      expect(r.progress[r.progress.length - 1]).toBeNull();
      r.finish();
    }));
  });

  describe('rapid typing', () => {

    it('keeps every key in order when a sentence arrives before the queue has answered once', strict(() => {
      const r = rig();
      r.queue.answer = () => new Promise(() => undefined);
      typeText(r, 'Ronaldinho Gaúcho é craque');
      // One submission per input event, in the order the events came; each space rides with the
      // character that follows it, since a space on its own is held back.
      expect(r.sent).toEqual([
        'R', 'o', 'n', 'a', 'l', 'd', 'i', 'n', 'h', 'o',
        '_ G', 'a', 'alt250', 'c', 'h', 'o',
        '_ alt233',
        '_ c', 'r', 'a', 'q', 'u', 'e',
      ]);
      r.finish();
    }));
  });

  describe('the diagnostics log', () => {

    it('writes every event the field gets and every step it sends', strict(() => {
      const r = rig();
      compositionStart(r);
      compose(r, 'Zé');
      compositionEnd(r, 'Zé');
      keydown(r, { key: 'Enter', keyCode: 13 });
      r.input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter' }));
      r.input.dispatchEvent(new FocusEvent('focus'));
      r.input.dispatchEvent(new FocusEvent('blur'));
      for (const message of ['beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend', 'keydown', 'keyup', 'focus', 'blur', 'sync', 'key', 'cleared']) {
        expect(r.log).withContext(message).toContain(message);
      }
      r.finish();
    }));
  });

  describe('dispose', () => {

    it('stops listening and leaves no timer behind', strict(() => {
      const r = rig();
      compositionStart(r);
      compose(r, 'Ze');
      r.session.dispose();
      tick(SETTLE * 3);
      typeChar(r, 'x');
      keydown(r, { key: 'Enter' });
      expect(r.sent).toEqual([]);
      r.input.remove();
    }));
  });
});
