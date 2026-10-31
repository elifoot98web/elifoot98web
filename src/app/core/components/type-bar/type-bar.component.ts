import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, NgZone, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild } from '@angular/core';
import { Subscription } from 'rxjs';
import { ChatPanelHelper } from '../../helpers/chat-panel.helper';
import { DeckKeyHelper } from '../../helpers/deck-keys.helper';
import { FieldHint, FieldHintHelper } from '../../helpers/field-hint.helper';
import { KeyRepeatScheduler, KeyRepeatTimers } from '../../helpers/key-repeat.helper';
import { LayoutShape } from '../../helpers/layout-shape.helper';
import { TypeBarLayoutHelper } from '../../helpers/type-bar-layout.helper';
import { TypeBarHooks, TypeBarSession } from '../../helpers/type-bar-session.helper';
import { DECK, TYPE_BAR } from '../../models/constants';
import { EmulatorControlService, GuestKeyQueueService } from '../../services/game';
import { DiagnosticsService, KeyboardInsetService } from '../../services/shared';

/** One key of the strip under the field. */
interface StripKey {
  id: string;
  label: string;
  aria: string;
  /**
   * Left out of the one-row layout. Its width tiers: 0 always shown, 1 from 400 px wide, 2 from 560
   * (and 3 never: the arrows and Shift+Tab, which the deck's Setas panel has).
   */
  tier: 0 | 1 | 2 | 3;
}

/** What the page shows as a toast. */
export interface TypeBarNotice {
  message: string;
  color: 'warning' | 'success';
}

/**
 * The live type bar: a real, visible, one-line field above the OS keyboard whose text appears in the
 * guest as it is typed, so the player can see what they are writing and does not have to type blind
 * into a dialog and hope. EXPERIMENTAL: it is behind the "Teclado ao vivo (experimental)" setting
 * (STORAGE_KEY.LIVE_KEYBOARD, off by default) and the deck's Texto button opens it only when that is
 * on. The compose dialog is still what Texto opens otherwise and still the way to paste a list
 * ("Lista" here, "Digitar texto" in the menu): a list of names is several lines, and this is a
 * line. Decision D7: ship the hardened dialog, build this behind a flag, decide after the device
 * pass. **The mirroring has run only against synthetic IME events in desktop Chrome**; what a real
 * Gboard, Samsung Keyboard and iOS keyboard send is recalled, which is why every event the field
 * gets is written to the diagnostics log (category `ime`) while the bar is open.
 *
 * The rules of the mirror are in {@link TypeBarSession} and {@link TypeMirror}; this is the window
 * around them. What it owns:
 *
 * - **It opens only from a tap and focuses inside it** (`open()` renders and calls `focus()` in the
 *   same synchronous call, which is what iOS demands for the keyboard to come up). It never opens the
 *   OS keyboard by itself, however sure the field hint is that a field is there.
 * - **It never resizes the page.** `position: fixed` against the bottom of the screen, lifted by
 *   `--kb-inset` (KeyboardInsetService, started and stopped with the bar), over the deck: the page
 *   under it, `#game-container` included, does not know it is there. It folds into one row when
 *   the keyboard leaves it no room (TypeBarLayoutHelper), and that is a CSS class on the SAME
 *   field, because a field that was re-created would lose the focus and close the keyboard.
 * - **The strip's keys are keycaps** (`appDeckKey`, the deck's): they take no focus, so the
 *   keyboard stays open under a tap, and they send through the same session as the field, so a key
 *   always follows the text before it.
 * - **A tap on the game keeps the keyboard and empties the bar** (the page's `keepFocus` for the
 *   touch layer, which asks at every finger that lands on the game): the player taps the game's
 *   field and goes on typing, and what the bar held belonged to the field they just left. A key
 *   from the deck does the same (`activity$`, minus the bar's own sends).
 * - **It is mutually exclusive with the chat** (the page closes one when the other opens), and
 *   closing refocuses the emulator, where a hardware keyboard is read.
 * - The look is the deck's: `.deck-face` and `.deck-key` (Win9x, decision D3), the field's bevel
 *   and a title bar; a flat skin is a CSS-only change in `_type-bar.scss` and the two classes
 *   `_win9x.scss` defines.
 */
@Component({
  selector: 'app-type-bar',
  templateUrl: './type-bar.component.html',
  styleUrls: ['./type-bar.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class TypeBarComponent implements OnChanges, OnDestroy {
  /** The emulator's command interface (`any`, as on the page); null until the game has booted. */
  @Input() dosCI: any = null;
  /** What the field hint thinks, for the badge. Never gates anything. */
  @Input() hint: FieldHint = 'none';
  @Input() shape: LayoutShape = 'portrait';
  /** The page is leaving: the bar closes. */
  @Input() disabled = false;

  @Output() closed = new EventEmitter<void>();
  /** "Lista": the player wants the compose dialog. The bar has closed. */
  @Output() pasteList = new EventEmitter<void>();
  @Output() notice = new EventEmitter<TypeBarNotice>();
  /** A key could not be sent (no emulator, or it threw). The page words it and rate-limits it. */
  @Output() keyFailure = new EventEmitter<unknown>();

  @ViewChild('field') private fieldRef?: ElementRef<HTMLInputElement>;

  isOpen = false;
  /** One row instead of the full window. */
  compact = false;
  /** The field asks the OS for a number pad. */
  numeric = false;
  focused = false;
  readonly maxLength = TYPE_BAR.MAX_LENGTH;
  progress: { done: number; total: number } | null = null;

  readonly strip: readonly StripKey[] = [
    { id: 'tab', label: 'Tab', aria: 'Tab', tier: 0 },
    { id: 'shift-tab', label: '⇧Tab', aria: 'Shift mais Tab, voltar ao campo anterior', tier: 3 },
    { id: 'enter', label: 'Enter', aria: 'Enter', tier: 0 },
    { id: 'esc', label: 'Esc', aria: 'Esc', tier: 1 },
    { id: 'backspace', label: 'Apagar', aria: 'Backspace, apagar', tier: 2 },
    { id: 'left', label: '←', aria: 'Seta para a esquerda', tier: 3 },
    { id: 'up', label: '↑', aria: 'Seta para cima', tier: 3 },
    { id: 'down', label: '↓', aria: 'Seta para baixo', tier: 3 },
    { id: 'right', label: '→', aria: 'Seta para a direita', tier: 3 },
  ];

  private session: TypeBarSession | null = null;
  private inset = 0;
  private insetSubscription: Subscription | null = null;
  private activitySubscription: Subscription | null = null;
  /** True while the bar itself is submitting to the queue, so its own keys are not taken for someone else's. */
  private sending = false;
  private readonly backspaceRepeat: KeyRepeatScheduler;

  /** Outside Angular's zone: a held Backspace ticks eighteen times a second, none of which changes a pixel. */
  private readonly timers: KeyRepeatTimers = {
    setTimeout: (handler, ms) => this.zone.runOutsideAngular(() => setTimeout(handler, ms)),
    clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };

  constructor(
    private emulator: EmulatorControlService,
    private keyQueue: GuestKeyQueueService,
    private keyboardInset: KeyboardInsetService,
    private diagnostics: DiagnosticsService,
    private zone: NgZone,
    private cdr: ChangeDetectorRef,
  ) {
    this.backspaceRepeat = new KeyRepeatScheduler(
      { delayMs: DECK.REPEAT_DELAY_MS, intervalMs: DECK.REPEAT_INTERVAL_MS, maxPending: DECK.REPEAT_MAX_PENDING, maxHoldMs: DECK.REPEAT_MAX_HOLD_MS },
      { fire: () => this.session?.backspace(), pending: () => this.emulator.pendingKeys },
      this.timers,
    );
  }

  get hintLabel(): string {
    return FieldHintHelper.label(this.hint);
  }

  get placeholder(): string {
    return this.focused ? 'Digite aqui' : 'Toque aqui para digitar';
  }

  /** Whether the field has the focus: the touch layer leaves the focus alone while it does. */
  hasFocus(): boolean {
    const field = this.fieldRef?.nativeElement;
    return !!field && document.activeElement === field;
  }

  /**
   * A finger has landed on the game (the touch layer asks the page, which asks here, before it moves
   * the focus): the tap is about to click in the guest, which usually moves the guest's focus or caret,
   * and what the bar holds belongs to the field it is leaving. What the player can see is mirrored
   * first (the click is still to come), then the bar is emptied. A touch that clicks nothing (a drag
   * on a scrollbar, a palm) costs only the text on the bar, which is the safe direction: the guest
   * keeps what it has and an empty bar appends to it. Answers whether the field had the focus, which
   * is what the layer needs to leave the OS keyboard open.
   */
  onGameTouched(): boolean {
    const focused = this.hasFocus();
    this.session?.abandon('tap on the game', { flush: true });
    return focused;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['disabled'] && this.disabled) this.close();
    if (changes['shape'] || changes['dosCI']) this.relayout();
  }

  ngOnDestroy(): void {
    this.shutDown(false);
  }

  /**
   * Show the bar and focus the field, synchronously: call it from the tap's own handler. The view
   * is rendered by hand first, because `focus()` needs the field to exist and iOS counts only a
   * focus made in the gesture that asked for it. Idempotent: opened again it refocuses.
   */
  open(): void {
    if (this.disabled) return;
    if (!this.isOpen) {
      this.isOpen = true;
      this.keyboardInset.start();
      this.insetSubscription = this.keyboardInset.inset$.subscribe(inset => {
        this.inset = inset;
        this.relayout();
        this.diagnostics.log('ime', 'bar layout', () => this.layoutSnapshot());
      });
      this.cdr.detectChanges();
      const field = this.fieldRef!.nativeElement;
      this.zone.runOutsideAngular(() => {
        this.session = new TypeBarSession(field, this.hooks());
        // Keys the deck (or anything else) sends move the guest behind the bar's back. activity$ is
        // emitted synchronously inside the submission, so the bar's own sends are told apart by `sending`.
        this.activitySubscription = this.keyQueue.activity$.subscribe(() => {
          if (!this.sending) this.session?.abandon('keys from elsewhere');
        });
      });
      this.diagnostics.log('ime', 'bar open', () => this.layoutSnapshot());
    }

    const field = this.fieldRef?.nativeElement;
    if (!field) return;
    field.focus({ preventScroll: true });
    this.diagnostics.log('ime', 'bar focus', () => ({ focused: document.activeElement === field, tag: document.activeElement?.tagName }));
    this.relayout();
  }

  /** Mirror what the field holds, put the bar away and hand the keyboard back to the game. */
  close(): void {
    if (!this.isOpen) return;
    this.shutDown();
    this.closed.emit();
  }

  // ----------------------------------------------------------------------------- the window

  onFocus(): void {
    this.focused = true;
    this.cdr.markForCheck();
  }

  onBlur(): void {
    this.focused = false;
    this.cdr.markForCheck();
  }

  /** The strip's keys. A Backspace held down repeats; the rest press once. */
  onKey(key: StripKey): void {
    if (key.id === 'backspace') {
      this.backspaceRepeat.start();
      return;
    }
    const entry = DeckKeyHelper.byId(key.id);
    this.session?.press(entry.codes, key.id);
  }

  onKeyUp(key: StripKey): void {
    if (key.id === 'backspace') this.backspaceRepeat.stop('release');
  }

  /**
   * "123": the OS keyboard's number pad for a price. Changing `inputmode` on a field that has the
   * focus is not picked up by every keyboard until the focus is taken again, so it is: blur and focus
   * in the same tap (the keycap is a user gesture), which flushes the field on the way.
   */
  toggleNumeric(): void {
    this.numeric = !this.numeric;
    this.cdr.detectChanges();
    const field = this.fieldRef?.nativeElement;
    if (!field) return;
    this.diagnostics.log('ime', 'numeric', () => ({ numeric: this.numeric }));
    field.blur();
    field.focus({ preventScroll: true });
  }

  /** "Lista": the compose dialog, for several lines at once. */
  requestList(): void {
    this.close();
    this.pasteList.emit();
  }

  cancelSend(): void {
    const dropped = this.emulator.cancelKeys();
    this.diagnostics.log('ime', 'send cancelled by the player', () => ({ dropped }));
  }

  // --------------------------------------------------------------------------------- inside

  private hooks(): TypeBarHooks {
    return {
      send: (tasks, options) => {
        this.sending = true;
        try {
          return this.emulator.sendTasks(this.dosCI, tasks, { onProgress: options.progress, guardCapsLock: options.guardCapsLock });
        } finally {
          this.sending = false;
        }
      },
      pending: () => this.emulator.pendingKeys,
      log: (message, data) => this.diagnostics.log('ime', message, data),
      progress: state => this.zone.run(() => { this.progress = state; this.cdr.markForCheck(); }),
      substituted: count => this.zone.run(() => this.notice.emit({
        message: count === 1
          ? '1 caractere sem equivalente no jogo foi enviado como "?".'
          : `${count} caracteres sem equivalente no jogo foram enviados como "?".`,
        color: 'warning',
      })),
      desync: (reason, detail) => this.zone.run(() => {
        if (reason === 'failed') {
          this.keyFailure.emit(detail);
          return;
        }
        const result = detail as { completed: number; total: number };
        this.notice.emit({
          message: `Envio cancelado: ${result.completed} de ${result.total} teclas enviadas. O campo foi esvaziado.`,
          color: 'warning',
        });
      }),
    };
  }

  private relayout(): void {
    if (!this.isOpen) return;
    const compact = TypeBarLayoutHelper.folds({
      shape: this.shape,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      keyboardInset: this.inset,
      pictureBottom: this.visiblePictureBottom() ?? 0,
    });
    if (compact !== this.compact) {
      this.compact = compact;
      this.diagnostics.log('ime', 'bar folds', () => ({ compact, inset: this.inset }));
    }
    this.cdr.markForCheck();
  }

  /**
   * Where the picture ends on the screen. Not the root's own rectangle: with the camera on that is the MAGNIFIED picture, which runs
   * past the clip that cuts it off (and past the screen), so the bottom is the lower of the two. Without a camera the clip and the
   * picture end together and this is what it always was. The bar never moves the camera either way: it covers what it covers.
   */
  private visiblePictureBottom(): number | null {
    const picture = document.getElementById('game-container');
    if (!picture) return null;
    const clip = picture.parentElement?.getBoundingClientRect();
    const bottom = picture.getBoundingClientRect().bottom;
    return clip ? Math.min(bottom, clip.bottom) : bottom;
  }

  /** Everything the device pass needs to judge where the bar sits: the viewport, the keyboard and the bar's own box. */
  private layoutSnapshot(): unknown {
    const viewport = window.visualViewport;
    const bar = document.querySelector('.type-bar')?.getBoundingClientRect();
    const picture = document.getElementById('game-container')?.getBoundingClientRect();
    const visibleBottom = this.visiblePictureBottom();
    return {
      shape: this.shape,
      compact: this.compact,
      inset: this.inset,
      inner: `${window.innerWidth}x${window.innerHeight}`,
      visual: viewport ? { w: Math.round(viewport.width), h: Math.round(viewport.height), top: Math.round(viewport.offsetTop), scale: viewport.scale } : null,
      bar: bar ? { top: Math.round(bar.top), bottom: Math.round(bar.bottom), h: Math.round(bar.height) } : null,
      picture: picture ? { top: Math.round(picture.top), bottom: Math.round(visibleBottom ?? picture.bottom) } : null,
    };
  }

  /** `render` is false when the view itself is going away and cannot be refreshed. */
  private shutDown(render = true): void {
    if (!this.isOpen) return;
    this.backspaceRepeat.stop('cancel');
    // A paste still going out has its Cancelar on this bar, which is about to go: the player who
    // closes it is not waiting for the rest, and could not stop it from anywhere else. Asked before
    // the flush below, which may start a send of its own.
    const cutPaste = this.progress !== null;
    // What the player can see is what the guest gets, composition or not; then nothing is listened to.
    this.session?.flush('close');
    this.session?.dispose();
    this.session = null;
    this.activitySubscription?.unsubscribe();
    this.activitySubscription = null;
    this.insetSubscription?.unsubscribe();
    this.insetSubscription = null;
    if (cutPaste) {
      const dropped = this.emulator.cancelKeys();
      this.diagnostics.log('ime', 'send cancelled by closing', () => ({ dropped }));
      if (render) this.notice.emit({ message: 'Envio cancelado: o campo foi fechado antes de terminar.', color: 'warning' });
    }
    this.keyboardInset.stop();
    this.fieldRef?.nativeElement.blur();
    this.isOpen = false;
    this.focused = false;
    this.progress = null;
    this.numeric = false;
    this.diagnostics.log('ime', 'bar closed');
    if (render) this.cdr.detectChanges();
    // Back to the game: js-dos reads a hardware keyboard from .emulator-root.
    ChatPanelHelper.focusEmulator();
  }
}
