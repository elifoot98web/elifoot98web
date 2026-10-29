import { Injectable, NgZone } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { GestureConfig, GestureIntent, GestureRecognizer, TouchSample } from '../../helpers/gesture-recognizer.helper';
import { GuestPoint, GuestPointer, GuestPointerOptions } from '../../helpers/guest-pointer.helper';
import { TouchFeedbackHelper } from '../../helpers/touch-feedback.helper';
import { TOUCH_INPUT } from '../../models/constants';
import { DosCI } from '../../typings/jsdos';
import { DiagnosticsService } from '../shared/diagnostics.service';

/** The elements of js-dos's surface the layer works with (`dosInstance.layers`). */
export interface TouchSurface {
  /** `#game-container` (`.emulator-root`): the listeners go here, in the capture phase. */
  root: HTMLElement;
  /** `.emulator-mouse-overlay`: where js-dos binds its own pointer handlers. */
  overlay: HTMLElement;
  /** `.emulator-canvas`: the picture; its rectangle maps the finger to the guest frame. */
  canvas: HTMLElement;
  /**
   * Asked once for every finger that lands on the game, before the layer moves the focus to `root`
   * (which a hardware keyboard needs). A text field of the page that is meant to keep it answers
   * true: the live type bar, whose OS keyboard would otherwise close on every tap the player makes
   * on the game's own field. It is also the moment the page learns that the guest is about to be
   * clicked in, which the type bar uses to drop the text it was mirroring; the layer cares only about
   * the answer.
   */
  keepFocus?: () => boolean;
}

/** What {@link TouchInputService.retune} may change on a live layer. The harness sweeps these. */
export interface TouchTuning {
  gesture?: Partial<GestureConfig>;
  pointer?: Partial<GuestPointerOptions>;
  /**
   * Milliseconds on a monotonic clock, for the layer's own timing and the engine's. A spec under
   * `fakeAsync` passes `Date.now`, which it fakes and `performance.now` it does not; it also
   * replaces the event's own timestamp, which would be the real clock.
   */
  now?: () => number;
}

/** A read-only look at the layer, for the harness: it grades `position` against the guest's RAM. */
export interface TouchInspection {
  /** Where the model puts the guest cursor, or `null` when it does not know. */
  position: GuestPoint | null;
  buttonDown: boolean;
  pending: number;
  gesture: string;
  stats: GuestPointer['stats'];
}

interface Binding {
  target: EventTarget;
  type: string;
  handler: (event: Event) => void;
  options: AddEventListenerOptions;
}

/**
 * Direct touch: a tap lands where the finger is.
 *
 * js-dos has no such thing for this guest. It treats a user agent matching
 * `/iPhone|iPad|iPod|Android/` as a phone and gives it a touchpad (a tap clicks at the OLD cursor
 * position, a swipe moves the cursor two guest pixels per unit, no drag), and anything else the
 * desktop pointer-lock path, under which a touch does nothing at all; a default-UA iPad is the
 * second case. Its absolute mode would give tap-to-click but lands 150-350 px off. So this layer
 * takes the finger over before js-dos sees it, works out what the finger meant
 * ({@link GestureRecognizer}) and drives the guest's mouse itself ({@link GuestPointer}).
 *
 * Load-bearing:
 *
 * - **Capture phase on `layers.root`, by pointer type, never by user agent.** The listeners
 *   `stopPropagation()` for `touch` and `pen` pointers whose target is js-dos's overlay or canvas,
 *   so js-dos's own handlers (on the overlay, bubbling) never run for a finger. A real mouse is
 *   not touched: desktop pointer lock, hybrid laptops and an iPad with a mouse behave as before.
 *   Events aimed at anything else inside the root (js-dos's own controls) are left
 *   alone; the control deck is not inside it at all. `layers.pointerDisabled` was rejected: it disables the mouse path too.
 * - **A mouse event right after a touch is the browser's copy of it** and is dropped for
 *   {@link TOUCH_INPUT.COMPAT_MOUSE_WINDOW_MS}. Cancelling the touch events should already stop
 *   it, but on a default-UA iPad js-dos answers a stray `mousedown` with a pointer-lock request.
 * - **A real mouse makes the model forget the cursor.** Both can move the same guest cursor on a
 *   hybrid device, and the engine only knows what it sent itself, so the next touch re-homes.
 * - **A lifted finger wakes the game's audio** (`wakeAudio()`). js-dos resumes its
 *   `AudioContext` from a document-level `click`/`touchstart`, and this layer is why neither arrives.
 * - **Every way a gesture can end releases the button.** The recognizer's cancel, `pointercancel`,
 *   `touchend`/`touchcancel` with no `pointerup`, the page being hidden, the window losing focus,
 *   `pagehide`, a finger silent for {@link TOUCH_INPUT.GESTURE_STALL_MS}, and `detach()` all
 *   reach `GuestPointer.abort()`, which is synchronous. The timers of a hidden page are throttled
 *   or frozen, so the release of a held button cannot be left to one.
 * - **Listeners and timers run outside Angular's zone.** A finger produces pointer events at the
 *   display rate; each would otherwise cost the whole app a change-detection pass.
 * - **Feedback is DOM, not pixels** ({@link TouchFeedbackHelper}): spectators and the OCR
 *   scraper never see it.
 *
 * Holds the command interface only between `attach()` and `detach()`, like the key queue holds it
 * for a job; `GamePage.ngOnDestroy` detaches.
 */
@Injectable({
  providedIn: 'root'
})
export class TouchInputService {
  private session: TouchSession | null = null;
  private tuning: TouchTuning = {};
  private readonly clickSubject = new Subject<GuestPoint>();

  /**
   * Where the guest's cursor was once a click the layer sent (a tap, a double tap, the end of aim
   * mode) had gone out, in guest pixels. The live type bar looks at the pixels there to see
   * whether the guest's cursor is an I-beam (FieldHintService). Emits outside Angular's zone.
   */
  readonly clicks$: Observable<GuestPoint> = this.clickSubject.asObservable();

  constructor(private zone: NgZone, private diagnostics: DiagnosticsService) { }

  /** Whether the layer is installed. */
  get attached(): boolean {
    return this.session !== null;
  }

  /**
   * Install the layer on a booted emulator. Attaching again detaches the previous attachment
   * first, so a second call can never leave two layers fighting over one finger.
   */
  attach(dosCI: DosCI, surface: TouchSurface): void {
    this.detach('replaced');
    this.zone.runOutsideAngular(() => {
      this.session = new TouchSession(dosCI, surface, this.tuning, this.diagnostics, point => this.clickSubject.next(point));
    });
  }

  /** Remove the layer: listeners, timers, feedback, and the button if one is down. */
  detach(reason = 'detach'): void {
    const session = this.session;
    if (!session) return;
    this.session = null;
    session.dispose(reason);
  }

  /** Change the tuning, for this layer and the next. */
  retune(tuning: TouchTuning): void {
    this.tuning = {
      gesture: { ...this.tuning.gesture, ...tuning.gesture },
      pointer: { ...this.tuning.pointer, ...tuning.pointer },
      now: tuning.now ?? this.tuning.now,
    };
    this.session?.retune(tuning);
  }

  inspect(): TouchInspection | null {
    return this.session?.inspect() ?? null;
  }
}

/** The mouse events a browser fires after a touch, on top of the pointer events. */
const COMPAT_MOUSE_EVENTS = ['mousedown', 'mouseup', 'mousemove', 'click', 'dblclick', 'auxclick'];

/** One attachment: everything that exists only while the layer is on. */
class TouchSession {
  private readonly now: () => number;
  /** A clock was handed in, so event timestamps (which are the real clock's) are not used. */
  private readonly ownClock: boolean;
  private readonly recognizer: GestureRecognizer;
  private readonly pointer: GuestPointer;
  private readonly feedback: TouchFeedbackHelper;
  private readonly bindings: Binding[] = [];

  /** The gesture in progress, as far as the guest is concerned. */
  private gesture: { inside: boolean; startedAt: number; moves: number } | null = null;
  private lastTouchAt = Number.NEGATIVE_INFINITY;
  private lastEventAt = 0;
  private swallowedMouseEvents = 0;
  private holdTimer: ReturnType<typeof setTimeout> | undefined;
  private scheduledDeadline: number | null = null;
  private stallTimer: ReturnType<typeof setTimeout> | undefined;
  private lostPointerupTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(
    private readonly ci: DosCI,
    private readonly surface: TouchSurface,
    tuning: TouchTuning,
    private readonly diagnostics: DiagnosticsService,
    private readonly onClick?: (point: GuestPoint) => void,
  ) {
    this.now = tuning.now ?? (() => performance.now());
    this.ownClock = !!tuning.now;
    this.recognizer = new GestureRecognizer(tuning.gesture);
    this.pointer = new GuestPointer(ci, {
      now: this.now,
      ...tuning.pointer,
      log: (message, data) => this.diagnostics.log('pointer', message, data),
    });
    this.feedback = new TouchFeedbackHelper(surface.root);

    this.install();
    this.diagnostics.log('touch', 'layer attached', () => ({
      frame: `${ci.width()}x${ci.height()}`,
      spacingMs: tuning.pointer?.spacingMs ?? TOUCH_INPUT.SEND_SPACING_MS,
    }));
    // Park the cursor now, while nobody is touching, so the first tap does not wait for the trip
    // to the corner. Only where a screen can be touched at all: on a desktop with a mouse it would
    // move the guest's cursor for nothing, and the first touch of a hybrid laptop can wait.
    if (TouchSession.hasTouchScreen()) void this.pointer.prime();
  }

  /** Whether any pointer of this device is a finger. `any-pointer`, not `pointer`: a touch laptop's primary one is its trackpad. */
  private static hasTouchScreen(): boolean {
    return typeof window.matchMedia === 'function' && window.matchMedia('(any-pointer: coarse)').matches;
  }

  retune(tuning: TouchTuning): void {
    if (tuning.gesture) this.recognizer.configure(tuning.gesture);
    if (tuning.pointer) this.pointer.configure(tuning.pointer);
  }

  inspect(): TouchInspection {
    return {
      position: this.pointer.position,
      buttonDown: this.pointer.buttonDown,
      pending: this.pointer.pending,
      gesture: this.recognizer.state,
      stats: this.pointer.stats,
    };
  }

  dispose(reason: string): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const { target, type, handler, options } of this.bindings) target.removeEventListener(type, handler, options);
    this.bindings.length = 0;
    clearTimeout(this.holdTimer);
    clearTimeout(this.stallTimer);
    this.clearLostPointerupCheck();
    this.recognizer.cancelAll(reason);
    // dispose() aborts first, which releases a held button on the spot.
    this.pointer.dispose();
    this.feedback.dispose();
    this.diagnostics.log('touch', 'layer detached', () => ({ reason, ...this.pointer.stats }));
  }

  // ------------------------------------------------------------------------------ listeners

  private install(): void {
    const { root } = this.surface;
    // Capture and not passive: the layer cancels touches, and it has to run before js-dos's own
    // handlers, which sit on the overlay beneath the root.
    const capture: AddEventListenerOptions = { capture: true, passive: false };

    this.listen(root, 'pointerdown', e => this.onPointerDown(e as PointerEvent), capture);
    this.listen(root, 'pointermove', e => this.onPointerMove(e as PointerEvent), capture);
    this.listen(root, 'pointerup', e => this.onPointerEnd(e as PointerEvent), capture);
    this.listen(root, 'pointercancel', e => this.onPointerEnd(e as PointerEvent), capture);

    // js-dos binds touchstart/move/end too (to stopPropagation, nothing else) and a browser may
    // still use them to scroll or zoom; both are shut on the surface.
    for (const type of ['touchstart', 'touchmove']) {
      this.listen(root, type, e => this.onTouchEvent(e as TouchEvent), capture);
    }
    for (const type of ['touchend', 'touchcancel']) {
      this.listen(root, type, e => this.onTouchEnd(e as TouchEvent), capture);
    }
    // Safari's own pinch-zoom of the page.
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
      this.listen(root, type, e => { if (e.cancelable) e.preventDefault(); }, capture);
    }
    for (const type of COMPAT_MOUSE_EVENTS) {
      this.listen(root, type, e => this.onCompatMouse(e as MouseEvent), capture);
    }

    // Anything that takes the page away from the person mid-gesture: the finger's pointerup may
    // never come, and the timers of a hidden page do not run. Any visibility change counts, not
    // only the one to hidden: no finger survives either, and an event that is delivered late (a
    // page that was frozen gets it on thawing) finds the page visible again by the time it runs.
    // `freeze` is the Page Lifecycle API's own word for the same thing.
    this.listen(document, 'visibilitychange', () => this.releaseAll('visibility change'), {});
    this.listen(document, 'freeze', () => this.releaseAll('page frozen'), {});
    this.listen(window, 'blur', () => this.releaseAll('window blur'), {});
    this.listen(window, 'pagehide', () => this.releaseAll('pagehide'), {});
  }

  private listen(target: EventTarget, type: string, handler: (event: Event) => void, options: AddEventListenerOptions): void {
    target.addEventListener(type, handler, options);
    this.bindings.push({ target, type, handler, options });
  }

  /** Whether an event is aimed at the picture or the layer over it, and not at one of js-dos's controls. */
  private ours(event: Event): boolean {
    return event.target === this.surface.overlay || event.target === this.surface.canvas;
  }

  private onPointerDown(event: PointerEvent): void {
    if (event.pointerType === 'mouse') {
      this.noteRealMouse();
      return;
    }
    if (!this.isFinger(event) || !this.ours(event)) return;

    this.swallow(event);
    this.lastTouchAt = this.now();
    // A finger that lands now proves the last one ended: its pointerup was not lost.
    this.clearLostPointerupCheck();
    this.focusSurface();
    this.dispatch(this.recognizer.down(this.sample(event)));
    this.afterInput();
  }

  private onPointerMove(event: PointerEvent): void {
    if (event.pointerType === 'mouse') {
      this.noteRealMouse();
      return;
    }
    if (!this.isFinger(event) || !this.ours(event)) return;

    // Always stopped: js-dos would turn a pointermove into relative motion. Only the contacts the
    // recognizer tracks mean anything, so a hovering pen is ignored by it.
    event.stopPropagation();
    this.lastTouchAt = this.now();
    if (this.gesture) this.gesture.moves++;
    this.dispatch(this.recognizer.move(this.sample(event)));
    this.afterInput();
  }

  private onPointerEnd(event: PointerEvent): void {
    if (!this.isFinger(event) || !this.ours(event)) return;

    this.swallow(event);
    this.lastTouchAt = this.now();
    if (event.type === 'pointerup') this.wakeAudio();
    const intents = event.type === 'pointercancel'
      ? this.recognizer.cancel(event.pointerId)
      : this.recognizer.up(this.sample(event));
    this.dispatch(intents);
    this.afterInput();
  }

  private onTouchEvent(event: TouchEvent): void {
    if (!this.ours(event)) return;
    this.lastTouchAt = this.now();
    this.swallow(event);
  }

  /**
   * Browsers fire `pointerup` before `touchend`, so a gesture that is still alive when the
   * last finger has left the screen has lost its `pointerup`. Checked a beat later, so an
   * engine that orders them the other way is not mistaken for one that lost it. A new finger
   * landing inside that beat cancels the check ({@link clearLostPointerupCheck}): what is down by
   * then is the new gesture, which a fast double tap or two thumbs would otherwise lose.
   */
  private onTouchEnd(event: TouchEvent): void {
    if (!this.ours(event)) return;
    this.lastTouchAt = this.now();
    this.swallow(event);
    if (event.type === 'touchend') this.wakeAudio();
    if (event.touches.length > 0) return;
    this.clearLostPointerupCheck();
    this.lostPointerupTimer = setTimeout(() => {
      this.lostPointerupTimer = undefined;
      if (this.recognizer.active) this.releaseAll('touchend without pointerup');
    }, 80);
  }

  private clearLostPointerupCheck(): void {
    clearTimeout(this.lostPointerupTimer);
    this.lostPointerupTimer = undefined;
  }

  private onCompatMouse(event: MouseEvent): void {
    if (!this.ours(event)) return;
    if (this.now() - this.lastTouchAt > TOUCH_INPUT.COMPAT_MOUSE_WINDOW_MS) return;
    event.stopPropagation();
    if (event.cancelable) event.preventDefault();
    if (this.swallowedMouseEvents++ === 0) {
      this.diagnostics.log('touch', 'compat mouse event dropped', () => ({ type: event.type }));
    }
  }

  /**
   * Resume the game's audio on a lifted finger. js-dos makes its `AudioContext` before any
   * gesture (inside `run()`) and wakes it from a one-shot `click`/`touchstart`/`keydown` listener
   * on `document`. This layer stops the touch before it gets there and cancels the click the
   * browser would have made of it, so on iOS (where a context made outside a gesture stays
   * suspended) the game would stay silent, and a hosting phone would stream silence, until the
   * person happened to tap something outside the game. `pointerup` and `touchend` are the events
   * browsers count as the activation.
   */
  private wakeAudio(): void {
    if (typeof getDosAudioNode !== 'function') return;
    // Typed BaseAudioContext, which has no resume(); it is js-dos's real AudioContext.
    const context = getDosAudioNode()?.context as AudioContext | undefined;
    if (context && context.state !== 'running' && context.state !== 'closed') {
      context.resume().catch(() => { /* still not allowed: the next lift tries again */ });
    }
  }

  /** A real mouse moved or clicked: the guest cursor is no longer where this layer left it. */
  private noteRealMouse(): void {
    this.pointer.invalidate('real mouse');
  }

  private isFinger(event: PointerEvent): boolean {
    return event.pointerType === 'touch' || event.pointerType === 'pen';
  }

  private swallow(event: Event): void {
    event.stopPropagation();
    if (event.cancelable) event.preventDefault();
  }

  /**
   * The same focus a mouse press gives for free. Cancelling the touch cancels the browser's
   * focus change with it, and js-dos reads the keyboard from this element: a hardware keyboard
   * on an iPad would otherwise stop reaching the game after the first tap.
   *
   * Not when a text field of the page asks to keep it (`keepFocus`): taking it would close the OS
   * keyboard that the player has open to type into the very field they are tapping.
   */
  private focusSurface(): void {
    if (this.surface.keepFocus?.()) return;
    if (document.activeElement !== this.surface.root) {
      this.surface.root.focus({ preventScroll: true });
    }
  }

  private sample(event: PointerEvent): TouchSample {
    // Browsers that cannot report the contact say 1x1 (or 0x0); that is no radius at all.
    const reported = Math.max(event.width, event.height);
    return {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      // `timeStamp` is milliseconds on the same clock as performance.now() in every browser this
      // app supports; the guard is for a stamp from an older epoch, which would end every hold.
      t: !this.ownClock && event.timeStamp > 0 && event.timeStamp < 1e11 ? event.timeStamp : this.now(),
      radius: reported > 1 ? reported / 2 : undefined,
    };
  }

  // ------------------------------------------------------------------------------- intents

  /** Page px to the guest's pixels through the picture's own rectangle (letterbox, and later zoom, are one formula). */
  private toGuest(clientX: number, clientY: number): (GuestPoint & { inside: boolean }) | null {
    const width = this.ci.width();
    const height = this.ci.height();
    const rect = this.surface.canvas.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0) || !(width > 0) || !(height > 0)) return null;
    return {
      x: Math.floor((clientX - rect.left) / rect.width * width),
      y: Math.floor((clientY - rect.top) / rect.height * height),
      inside: clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom,
    };
  }

  private dispatch(intents: GestureIntent[]): void {
    for (const intent of intents) this.apply(intent);
  }

  private apply(intent: GestureIntent): void {
    const now = this.now();
    const inside = !!this.gesture?.inside;
    switch (intent.type) {
      case 'down': {
        const guest = this.toGuest(intent.x, intent.y);
        this.gesture = { inside: !!guest?.inside, startedAt: now, moves: 0 };
        if (guest?.inside && intent.preAim) void this.pointer.moveTo(guest);
        this.diagnostics.log('touch', 'down', () => ({ x: Math.round(intent.x), y: Math.round(intent.y), guest, preAim: intent.preAim }));
        break;
      }
      // A touch that starts outside the picture (the strip beside it) does nothing and shows
      // nothing: a ring would say a click happened.
      case 'tap':
        // A tap that clicked nothing must not make the next one a double-tap, which clicks
        // without moving the cursor.
        if (!inside) this.recognizer.forgetTap();
        this.clickAt(intent, 'tap');
        if (inside) this.feedback.pulse('tap', intent.x, intent.y);
        break;
      case 'double-tap':
        // No move: the second click must land where the first one did.
        if (inside) {
          this.announce(this.pointer.click());
          this.feedback.pulse('double', intent.x, intent.y);
        }
        this.logGesture('double-tap', intent);
        break;
      case 'drag-start':
        if (inside) {
          this.moveGuest(intent);
          void this.pointer.press();
          this.feedback.follow(intent.x, intent.y);
        }
        this.logGesture('drag-start', intent);
        break;
      case 'drag-move':
        this.moveGuest(intent);
        if (inside) this.feedback.follow(intent.x, intent.y);
        break;
      case 'drag-end':
        this.moveGuest(intent);
        if (inside) void this.pointer.release();
        this.feedback.stopFollowing();
        this.logGesture('drag-end', intent);
        break;
      case 'aim-start':
        this.moveGuest(intent);
        if (inside) this.feedback.follow(intent.fingerX, intent.fingerY);
        this.logGesture('aim-start', intent);
        break;
      case 'aim-move':
        this.moveGuest(intent);
        if (inside) this.feedback.follow(intent.fingerX, intent.fingerY);
        break;
      case 'aim-end':
        this.clickAt(intent, 'aim-end');
        this.feedback.stopFollowing();
        if (inside) this.feedback.pulse('tap', intent.x, intent.y);
        break;
      case 'cancel':
        this.pointer.abort(intent.reason);
        this.feedback.stopFollowing();
        this.diagnostics.log('touch', 'cancel', () => ({ reason: intent.reason }));
        this.gesture = null;
        break;
      case 'ignored':
        this.diagnostics.log('touch', 'ignored', () => ({ reason: intent.reason }));
        break;
    }
    if (intent.type === 'tap' || intent.type === 'double-tap' || intent.type === 'drag-end' || intent.type === 'aim-end') {
      this.gesture = null;
    }
  }

  private moveGuest(intent: { x: number; y: number }): void {
    if (!this.gesture?.inside) return;
    const guest = this.toGuest(intent.x, intent.y);
    if (guest) void this.pointer.moveTo(guest);
  }

  private clickAt(intent: { x: number; y: number }, label: string): void {
    if (!this.gesture?.inside) {
      this.diagnostics.log('touch', `${label} outside the picture`, () => ({ x: Math.round(intent.x), y: Math.round(intent.y) }));
      return;
    }
    this.moveGuest(intent);
    this.announce(this.pointer.click());
    this.logGesture(label, intent);
  }

  /** Say where the cursor is once a click has gone out (or was dropped: a look at the same place is harmless). */
  private announce(click: Promise<void>): void {
    void click.then(() => {
      const at = this.pointer.position;
      if (!this.disposed && at) this.onClick?.(at);
    });
  }

  private logGesture(label: string, intent: { x: number; y: number }): void {
    const gesture = this.gesture;
    this.diagnostics.log('touch', label, () => ({
      x: Math.round(intent.x),
      y: Math.round(intent.y),
      heldMs: gesture ? Math.round(this.now() - gesture.startedAt) : null,
      moveEvents: gesture?.moves,
    }));
  }

  /** Stop whatever is going on, now: the finger is gone or the page is. */
  private releaseAll(reason: string): void {
    this.dispatch(this.recognizer.cancelAll(reason));
    // A click in its hold, or a press the recognizer no longer knows about.
    if (this.pointer.buttonDown || this.pointer.pending > 0) this.pointer.abort(reason);
    this.feedback.stopFollowing();
    this.afterInput();
  }

  // ------------------------------------------------------------------------------- timers

  /** After every input: keep the hold timer, the stall watchdog and the engine's idea of a finger in step with the recognizer. */
  private afterInput(): void {
    this.lastEventAt = this.now();
    this.pointer.setFingerDown(this.recognizer.active);

    const deadline = this.recognizer.deadline;
    if (deadline !== this.scheduledDeadline) {
      clearTimeout(this.holdTimer);
      this.holdTimer = undefined;
      this.scheduledDeadline = deadline;
      if (deadline !== null) {
        this.holdTimer = setTimeout(() => {
          this.holdTimer = undefined;
          this.scheduledDeadline = null;
          this.dispatch(this.recognizer.advance(this.now()));
          this.afterInput();
        }, Math.max(0, deadline - this.now()));
      }
    }

    if (this.recognizer.active) {
      this.armStallWatch(TOUCH_INPUT.GESTURE_STALL_MS);
    } else {
      clearTimeout(this.stallTimer);
      this.stallTimer = undefined;
    }
  }

  /**
   * The watchdog for a finger that went silent without a pointerup. Re-armed lazily: it fires
   * once per interval and checks how long the finger has really been quiet, rather than being
   * restarted by every pointermove.
   */
  private armStallWatch(afterMs: number): void {
    if (this.stallTimer !== undefined) return;
    this.stallTimer = setTimeout(() => {
      this.stallTimer = undefined;
      if (!this.recognizer.active) return;
      const quiet = this.now() - this.lastEventAt;
      if (quiet >= TOUCH_INPUT.GESTURE_STALL_MS) {
        this.releaseAll('finger silent');
      } else {
        this.armStallWatch(TOUCH_INPUT.GESTURE_STALL_MS - quiet);
      }
    }, afterMs);
  }
}
