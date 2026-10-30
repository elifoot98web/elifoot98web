import { TOUCH_INPUT } from '../models/constants';

/** What a hold does once it has lasted `holdMs`. */
export type HoldMode = 'aim' | 'none';

export interface GestureConfig {
  /** A finger may drift this far (css px) from where it landed and still be a tap. */
  tapSlopPx: number;
  holdMs: number;
  /** A second tap this soon (release to release) and this near the first one is a double-tap. */
  doubleTapMs: number;
  doubleTapSlopPx: number;
  /** How far above the finger aim mode parks the cursor. */
  aimOffsetPx: number;
  /** A contact reporting a bigger radius than this is a palm. */
  palmRadiusPx: number;
  holdMode: HoldMode;
}

/** One reading of one finger. Coordinates are css px on the page, `t` is milliseconds on any monotonic clock. */
export interface TouchSample {
  id: number;
  x: number;
  y: number;
  t: number;
  /** The contact's radius in css px, where the browser reports one. */
  radius?: number;
}

/**
 * What the recognizer decided. `x`/`y` is where the GUEST CURSOR belongs (page css px; the caller
 * maps it to the guest frame); for aim mode that is above the finger, which is then in
 * `fingerX`/`fingerY`.
 */
export type GestureIntent =
  /** A finger landed. `preAim` says whether the cursor should start walking there already. */
  | { type: 'down'; x: number; y: number; preAim: boolean }
  /** Click once, where the finger landed. */
  | { type: 'tap'; x: number; y: number }
  /** Click again where the cursor already is: the guest must see two clicks at ONE position. */
  | { type: 'double-tap'; x: number; y: number }
  /** Press the button at the touch-down point. */
  | { type: 'drag-start'; x: number; y: number }
  | { type: 'drag-move'; x: number; y: number }
  /** Release the button where the finger lifted. */
  | { type: 'drag-end'; x: number; y: number }
  | { type: 'aim-start'; x: number; y: number; fingerX: number; fingerY: number }
  | { type: 'aim-move'; x: number; y: number; fingerX: number; fingerY: number }
  /** Click where the cursor was parked. */
  | { type: 'aim-end'; x: number; y: number; fingerX: number; fingerY: number }
  /** Stop: release the button if it is down and click nothing. */
  | { type: 'cancel'; reason: string }
  /** A contact was refused or is not part of any gesture; for the log. */
  | { type: 'ignored'; reason: 'palm' | 'extra-finger' };

type Phase = 'idle' | 'pending' | 'drag' | 'aim' | 'ignoring';

interface Contact {
  startX: number;
  startY: number;
  x: number;
  y: number;
}

/**
 * Turns fingers into intents. A pure state machine: samples in, intents out, no timers and no
 * DOM, so a spec drives it with made-up timestamps. The one thing that needs a clock, the hold,
 * is exposed as a {@link deadline} that the caller schedules and answers with {@link advance}.
 *
 * What it decides (the numbers are {@link TOUCH_INPUT}'s, and are recalled, not measured on a
 * finger):
 *
 * - **A tap clicks at release**, at the point where the finger LANDED, which is where the cursor
 *   was already sent (`down.preAim`). Clicking at release is what makes a second finger able to
 *   cancel the touch before anything happened.
 * - **A second tap soon and near enough is a double-tap**, and clicks again without moving the
 *   cursor: Windows needs a real WM_LBUTTONDBLCLK, so both clicks must be at one position. The
 *   `down` of that second tap says `preAim: false` for the same reason: re-aiming at a finger that
 *   landed 20 px away would put the second click outside Windows' double-click rectangle.
 * - **Moving past the slop before the hold time is a drag**: the button goes down at the point
 *   where the finger landed, not where it was when the slop was crossed.
 * - **Holding still is aim mode**: the cursor is parked `aimOffsetPx` above the finger, where it
 *   can be seen, follows it, and the click happens at release. A hold that moves is still aim
 *   mode (moving does not turn it into a drag).
 * - **A second finger cancels the gesture and the touch stays dead until every finger is up.**
 *   What two fingers MEAN (the camera's pinch and pan) is {@link CameraGesture}'s, fed the same
 *   samples by `TouchInputService`; this only has to make sure they never leave a button held, which
 *   is what `cancel` is for.
 * - **A palm is ignored outright**, not tracked: a resting palm does not stop a finger tapping.
 * - **There is no right click.** No tested Elifoot screen reacts to one.
 */
export class GestureRecognizer {
  /** The defaults, from {@link TOUCH_INPUT}. */
  static defaults(): GestureConfig {
    return {
      tapSlopPx: TOUCH_INPUT.TAP_SLOP_PX,
      holdMs: TOUCH_INPUT.HOLD_MS,
      doubleTapMs: TOUCH_INPUT.DOUBLE_TAP_MS,
      doubleTapSlopPx: TOUCH_INPUT.DOUBLE_TAP_SLOP_PX,
      aimOffsetPx: TOUCH_INPUT.AIM_OFFSET_PX,
      palmRadiusPx: TOUCH_INPUT.PALM_RADIUS_PX,
      holdMode: TOUCH_INPUT.HOLD_MODE,
    };
  }

  private readonly config: GestureConfig;
  private phase: Phase = 'idle';
  private readonly contacts = new Map<number, Contact>();
  private holdDeadline: number | null = null;
  /** The last tap that was not part of a double: when it lifted and where it landed. */
  private lastTap: { t: number; x: number; y: number } | null = null;

  constructor(config: Partial<GestureConfig> = {}) {
    this.config = { ...GestureRecognizer.defaults(), ...config };
  }

  /** `'idle'`, `'pending'` (one finger down, undecided), `'drag'`, `'aim'` or `'ignoring'` (a cancelled multi-touch). */
  get state(): string {
    return this.phase;
  }

  /** Whether any tracked finger is down. */
  get active(): boolean {
    return this.contacts.size > 0;
  }

  /** The time at which a held finger becomes aim mode, or `null` if no hold is pending. */
  get deadline(): number | null {
    return this.holdDeadline;
  }

  configure(config: Partial<GestureConfig>): void {
    Object.assign(this.config, config);
  }

  /**
   * Take back the tap that was just reported. The caller does this for a tap that clicked nothing
   * (it landed outside the picture): the recognizer only knows time and distance, and a second
   * tap soon after would otherwise read as a double-tap and "click again where the cursor already
   * is", which is wherever the cursor happened to be left, not under that finger.
   */
  forgetTap(): void {
    this.lastTap = null;
  }

  down(sample: TouchSample): GestureIntent[] {
    if (sample.radius !== undefined && sample.radius > this.config.palmRadiusPx) {
      return [{ type: 'ignored', reason: 'palm' }];
    }
    if (this.contacts.has(sample.id)) return [];

    if (this.phase === 'idle') {
      const last = this.lastTap;
      const secondTap = !!last
        && sample.t - last.t <= this.config.doubleTapMs
        && Math.hypot(sample.x - last.x, sample.y - last.y) <= this.config.doubleTapSlopPx;
      this.contacts.set(sample.id, { startX: sample.x, startY: sample.y, x: sample.x, y: sample.y });
      this.phase = 'pending';
      this.holdDeadline = this.config.holdMode === 'aim' ? sample.t + this.config.holdMs : null;
      return [{ type: 'down', x: sample.x, y: sample.y, preAim: !secondTap }];
    }

    this.contacts.set(sample.id, { startX: sample.x, startY: sample.y, x: sample.x, y: sample.y });
    if (this.phase === 'ignoring') return [{ type: 'ignored', reason: 'extra-finger' }];

    // A second finger on a live gesture: nothing it was going to do happens.
    this.lastTap = null;
    this.holdDeadline = null;
    this.phase = 'ignoring';
    return [{ type: 'cancel', reason: 'second-finger' }];
  }

  move(sample: TouchSample): GestureIntent[] {
    const intents = this.advance(sample.t);
    const contact = this.contacts.get(sample.id);
    if (!contact) return intents;
    contact.x = sample.x;
    contact.y = sample.y;

    switch (this.phase) {
      case 'pending':
        if (Math.hypot(contact.x - contact.startX, contact.y - contact.startY) > this.config.tapSlopPx) {
          this.holdDeadline = null;
          this.phase = 'drag';
          intents.push({ type: 'drag-start', x: contact.startX, y: contact.startY });
          intents.push({ type: 'drag-move', x: contact.x, y: contact.y });
        }
        break;
      case 'drag':
        intents.push({ type: 'drag-move', x: contact.x, y: contact.y });
        break;
      case 'aim':
        intents.push(this.aimIntent('aim-move', contact));
        break;
      default:
        break;
    }
    return intents;
  }

  up(sample: TouchSample): GestureIntent[] {
    const intents = this.advance(sample.t);
    const contact = this.contacts.get(sample.id);
    if (!contact) return intents;
    contact.x = sample.x;
    contact.y = sample.y;
    this.contacts.delete(sample.id);
    this.holdDeadline = null;

    switch (this.phase) {
      case 'pending': {
        const last = this.lastTap;
        const isDouble = !!last
          && sample.t - last.t <= this.config.doubleTapMs
          && Math.hypot(contact.startX - last.x, contact.startY - last.y) <= this.config.doubleTapSlopPx;
        this.phase = 'idle';
        if (isDouble) {
          this.lastTap = null;
          intents.push({ type: 'double-tap', x: contact.startX, y: contact.startY });
        } else {
          this.lastTap = { t: sample.t, x: contact.startX, y: contact.startY };
          intents.push({ type: 'tap', x: contact.startX, y: contact.startY });
        }
        break;
      }
      case 'drag':
        this.phase = 'idle';
        this.lastTap = null;
        intents.push({ type: 'drag-end', x: contact.x, y: contact.y });
        break;
      case 'aim':
        this.phase = 'idle';
        this.lastTap = null;
        intents.push(this.aimIntent('aim-end', contact));
        break;
      case 'ignoring':
        if (this.contacts.size === 0) this.phase = 'idle';
        break;
      default:
        break;
    }
    return intents;
  }

  /** The browser took a finger away (`pointercancel`): same as lifting it, minus the click. */
  cancel(id: number, reason = 'pointercancel'): GestureIntent[] {
    if (!this.contacts.delete(id)) return [];
    if (this.phase === 'ignoring') {
      if (this.contacts.size === 0) this.phase = 'idle';
      return [];
    }
    this.lastTap = null;
    this.holdDeadline = null;
    this.phase = this.contacts.size > 0 ? 'ignoring' : 'idle';
    return [{ type: 'cancel', reason }];
  }

  /** Drop every finger: the page was hidden or lost focus, or the layer is going away. */
  cancelAll(reason: string): GestureIntent[] {
    const had = this.phase !== 'idle' || this.contacts.size > 0;
    this.contacts.clear();
    this.phase = 'idle';
    this.holdDeadline = null;
    this.lastTap = null;
    return had ? [{ type: 'cancel', reason }] : [];
  }

  /** Let time pass: a finger held past the deadline becomes aim mode. */
  advance(now: number): GestureIntent[] {
    const intents: GestureIntent[] = [];
    if (this.phase === 'pending' && this.holdDeadline !== null && now >= this.holdDeadline) {
      const contact = [...this.contacts.values()][0];
      this.holdDeadline = null;
      if (contact) {
        this.phase = 'aim';
        intents.push(this.aimIntent('aim-start', contact));
      }
    }
    return intents;
  }

  private aimIntent(type: 'aim-start' | 'aim-move' | 'aim-end', contact: Contact): GestureIntent {
    return { type, x: contact.x, y: contact.y - this.config.aimOffsetPx, fingerX: contact.x, fingerY: contact.y };
  }
}
