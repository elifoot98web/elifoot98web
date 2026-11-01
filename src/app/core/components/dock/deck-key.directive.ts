import { Directive, ElementRef, EventEmitter, HostBinding, HostListener, Input, OnDestroy, Output, Renderer2 } from '@angular/core';
import { DECK } from '../../models/constants';

/**
 * Turns a `<button>` into a keycap: a press that is felt on the finger's landing, that cannot take
 * the focus from the game, and that ends in exactly one release however it ends.
 *
 * **`pointerdown`, not `click`.** A click is delivered when the finger lifts, ~100 ms after it
 * landed, and the deck is a keyboard. So a key presses on `pointerdown`, with these consequences,
 * each of which was a bug in another soft keyboard:
 *
 * - `preventDefault()` on the pointerdown (and on `mousedown`, for a mouse) keeps the browser from
 *   moving the focus to the button, from starting a text selection and from raising the OS
 *   keyboard. The focus stays in `.emulator-root`, which is where js-dos reads the PHYSICAL
 *   keyboard from: a deck that took the focus would silence the keys on a tablet with a keyboard
 *   case. The button is `tabindex="-1"` for the same reason.
 * - The pointer is captured, so the release arrives even when the finger slides off the key; and
 *   every way a press can end (`pointerup`, `pointercancel`, `lostpointercapture`, the window
 *   losing focus, the page being hidden, the key being disabled under the finger, the directive
 *   being destroyed) is one `deckRelease`, once. A repeating key (KeyRepeatScheduler) hangs its
 *   stop on that, and a lost release there is a key that types by itself.
 * - A second finger on a key that is already down is ignored: a keycap is one press at a time.
 * - The pressed look is a class set here (`deck-key--down`), not `:active`, because iOS Safari
 *   applies `:active` to a touched button only when something on the page listens for touches.
 *
 * **A `click` with no pointer before it is an activation of its own.** TalkBack, VoiceOver, a
 * switch and a keyboard activate a button with a synthesized click and no pointerdown at all, and
 * a deck that only listened for pointers would be a dead keyboard to exactly the people who need
 * the accessible names. So a click that arrives within CLICK_AFTER_POINTER_MS of a pointer's
 * release is the browser's copy of that tap and is ignored; any other is a press and a release.
 * **"A pointer's release" is any keycap's, not this one's.** The browser makes the click of a tap
 * after the lift and aims it at whatever is under the finger THEN, so if the keys moved between
 * the press and the lift the click lands on a different keycap, one that saw no pointer at all
 * (measured, with a bar that appeared when a modifier was tapped: Shift sent Shift+Tab). A shared
 * clock closes that whatever the layout does; the layout does not move either (see DockComponent).
 *
 * **`deckKeyOn="up"` presses on release instead.** For keys inside a panel that can scroll: the
 * scroll gesture starts as a touch on a key, and a key that had already pressed would type on
 * every attempt. The browser cancels the pointer when it takes the gesture over, and a cancelled
 * press does nothing. Keys that repeat cannot do this (they need the landing), so they keep it and
 * take no part in panning instead (`deck-key--landing`, `touch-action: none`): a drag that starts
 * on one is that key's, never a scroll, and the panel scrolls from its gaps and its other keys.
 */
@Directive({
  selector: '[appDeckKey]',
  standalone: false
})
export class DeckKeyDirective implements OnDestroy {

  /** When the key presses: as the finger lands (the default) or as it lifts. */
  @Input() deckKeyOn: 'down' | 'up' = 'down';

  /**
   * Switches the button off (the native `disabled`, so a screen reader says so). A key switched off
   * under a finger lets go at once: no `pointerup` is promised for a button that stopped being one.
   */
  @Input() set deckKeyDisabled(value: boolean) {
    this.renderer.setProperty(this.element.nativeElement, 'disabled', !!value);
    if (value) this.finish(false);
  }

  /** The key went down. */
  @Output() deckPress = new EventEmitter<void>();
  /** The key came up, by whatever means; always follows a `deckPress`. */
  @Output() deckRelease = new EventEmitter<void>();

  @HostBinding('attr.tabindex') readonly tabindex = -1;
  @HostBinding('attr.type') readonly type = 'button';

  /**
   * A key that presses as the finger lands opts out of panning: see `.deck-key--landing` in
   * _deck.scss for why a panel that scrolls cannot be left to decide that for it.
   */
  @HostBinding('class.deck-key--landing') get landing(): boolean {
    return this.deckKeyOn === 'down';
  }

  /** When any keycap last let go of a pointer: the clock the click guard reads (see the class comment). */
  private static lastPointerReleaseAt = Number.NEGATIVE_INFINITY;

  private pointerId: number | null = null;
  private pressedOnDown = false;
  private unwatchPage: Array<() => void> = [];

  constructor(private element: ElementRef<HTMLButtonElement>, private renderer: Renderer2) { }

  @HostListener('pointerdown', ['$event'])
  onPointerDown(event: PointerEvent): void {
    // Always ours, even when it comes to nothing: the default of a pointerdown on a button is the
    // focus, and the focus is the one thing the deck must never take.
    event.preventDefault();
    if (this.disabled || this.pointerId !== null) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    this.pointerId = event.pointerId;
    try {
      this.element.nativeElement.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that is already gone (a very fast tap on a slow frame): the release follows.
    }
    this.renderer.addClass(this.element.nativeElement, 'deck-key--down');
    this.watchPage();
    this.pressedOnDown = this.deckKeyOn === 'down';
    if (this.pressedOnDown) this.deckPress.emit();
  }

  @HostListener('pointerup', ['$event'])
  onPointerUp(event: PointerEvent): void {
    if (event.pointerId !== this.pointerId) return;
    this.finish(true);
  }

  @HostListener('pointercancel', ['$event'])
  onPointerCancel(event: PointerEvent): void {
    if (event.pointerId !== this.pointerId) return;
    this.finish(false);
  }

  @HostListener('lostpointercapture', ['$event'])
  onLostCapture(event: PointerEvent): void {
    if (event.pointerId !== this.pointerId) return;
    this.finish(false);
  }

  /** A mouse's mousedown would focus the button and start a selection; the pointerdown above cannot always stop it. */
  @HostListener('mousedown', ['$event'])
  onMouseDown(event: MouseEvent): void {
    event.preventDefault();
  }

  /** A long press on a phone is a context menu, and a callout on iOS. */
  @HostListener('contextmenu', ['$event'])
  onContextMenu(event: Event): void {
    event.preventDefault();
  }

  @HostListener('dragstart', ['$event'])
  onDragStart(event: Event): void {
    event.preventDefault();
  }

  @HostListener('click', ['$event'])
  onClick(event: MouseEvent): void {
    event.preventDefault();
    if (this.disabled || this.pointerId !== null) return;
    if (DeckKeyDirective.isCopyOfATap(performance.now())) return;
    // Assistive technology or a keyboard: no pointer came first, so this is the whole press.
    this.deckPress.emit();
    this.deckRelease.emit();
  }

  ngOnDestroy(): void {
    this.finish(false);
  }

  /** Whether a click at time `now` (a `performance.now()` reading) is the browser's copy of a tap on a keycap. */
  static isCopyOfATap(now: number): boolean {
    return now - DeckKeyDirective.lastPointerReleaseAt < DECK.CLICK_AFTER_POINTER_MS;
  }

  private get disabled(): boolean {
    return this.element.nativeElement.disabled;
  }

  /** Ends the press that is in progress. `completed` is a lift, as opposed to a cancel. */
  private finish(completed: boolean): void {
    if (this.pointerId === null) return;
    const id = this.pointerId;
    this.pointerId = null;
    this.stopWatchingPage();
    try {
      this.element.nativeElement.releasePointerCapture(id);
    } catch {
      // Already released, or never captured.
    }
    this.renderer.removeClass(this.element.nativeElement, 'deck-key--down');
    DeckKeyDirective.lastPointerReleaseAt = performance.now();

    if (this.pressedOnDown) {
      this.pressedOnDown = false;
      this.deckRelease.emit();
    } else if (completed && this.deckKeyOn === 'up') {
      // Pressed and released at the lift, so a key that fires on release is still one press and one release.
      this.deckPress.emit();
      this.deckRelease.emit();
    }
  }

  /**
   * While a key is down, losing the window or the page ends the press: the `pointerup` of a
   * finger the OS took away may never arrive, and a button left looking pressed (or a key left
   * repeating) is worse than one released early. Listened to only while pressed.
   */
  private watchPage(): void {
    this.unwatchPage = [
      this.renderer.listen('window', 'blur', () => this.finish(false)),
      this.renderer.listen('document', 'visibilitychange', () => { if (document.hidden) this.finish(false); }),
    ];
  }

  private stopWatchingPage(): void {
    this.unwatchPage.forEach(stop => stop());
    this.unwatchPage = [];
  }
}
