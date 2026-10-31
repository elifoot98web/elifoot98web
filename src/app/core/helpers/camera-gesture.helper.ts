import { CAMERA, TOUCH_INPUT } from '../models/constants';
import { CameraPoint, PinchStep } from './viewport-transform.helper';

/** One reading of one finger, in css px on the page (the same samples the {@link GestureRecognizer} takes). */
export interface PinchSample {
  id: number;
  x: number;
  y: number;
  /** The contact's radius in css px, where the browser reports one; a palm is not a finger of the pinch. */
  radius?: number;
}

export type CameraGestureIntent =
  /** Two fingers are down and the camera now belongs to them. `midpoint` is where, `distance` how far apart. */
  | { type: 'start'; midpoint: CameraPoint; distance: number }
  /** The fingers moved: the step to give the camera, in page px. */
  | { type: 'step'; step: PinchStep }
  /** The camera has let go of the fingers. */
  | { type: 'end'; reason: string };

export interface CameraGestureConfig {
  /** A spread or a pinch smaller than this many css px is not a zoom; see {@link CameraGesture.effectiveDistance}. */
  slopPx: number;
  /** The distance a ratio is measured from is never less than this. */
  minBasePx: number;
  /** A contact reporting a bigger radius than this is a palm. */
  palmRadiusPx: number;
}

/**
 * Two fingers, turned into the camera's steps. A pure state machine like {@link GestureRecognizer}: samples in, intents out, no
 * timer and no DOM, so a spec drives it with made-up positions. {@link TouchInputService} feeds it the SAME samples as the
 * recognizer (whose second-finger rule has already cancelled any click or drag by then), and gives the steps to the camera.
 *
 * - **The first two fingers are the pinch.** A third is ignored while they are down, and so is a palm.
 * - **When either of the two lifts the pinch is over, and the touch is dead until every finger is up.** The one that is left
 *   would otherwise form a new pair with the next finger that lands, and a person lifting one finger of a pan to put it back
 *   must not zoom, nor click: the recognizer's `ignoring` phase has the same rule.
 * - **A step is the change since the last step**, not since the start: the camera clamps at the edges, and a gesture that kept
 *   the total would owe the distance it overshot before it moved again. The camera answers each step against where it IS.
 * - **A dead band on the spread**: two fingers drift against each other while they pan, and the scale must not shimmer. The
 *   distance counts from where the band ends, so the zoom is continuous when it is crossed (no jump).
 */
export class CameraGesture {

  static defaults(): CameraGestureConfig {
    return { slopPx: CAMERA.PINCH_SLOP_PX, minBasePx: CAMERA.PINCH_MIN_BASE_PX, palmRadiusPx: TOUCH_INPUT.PALM_RADIUS_PX };
  }

  /**
   * The distance a pinch is worth: `startDistance` while the fingers have moved apart or together by no more than `slop`, and the
   * change beyond the band after that. `base` (never below the start) is what a ratio is measured from.
   */
  static effectiveDistance(startDistance: number, distance: number, slop: number, minBase: number): number {
    const base = Math.max(startDistance, minBase);
    const change = distance - startDistance;
    const beyond = Math.max(0, Math.abs(change) - slop);
    return Math.max(1, base + Math.sign(change) * beyond);
  }

  private readonly config: CameraGestureConfig;
  private readonly contacts = new Map<number, CameraPoint>();
  private pair: [number, number] | null = null;
  /** A pinch has ended with fingers still down: nothing starts until they are all up. */
  private dead = false;
  private startDistance = 0;
  private lastMidpoint: CameraPoint = { x: 0, y: 0 };
  private lastEffective = 0;

  constructor(config: Partial<CameraGestureConfig> = {}) {
    this.config = { ...CameraGesture.defaults(), ...config };
  }

  /** Two fingers are driving the camera. */
  get active(): boolean {
    return this.pair !== null;
  }

  /** Any finger is down. */
  get touching(): boolean {
    return this.contacts.size > 0;
  }

  down(sample: PinchSample): CameraGestureIntent[] {
    if (sample.radius !== undefined && sample.radius > this.config.palmRadiusPx) return [];
    if (this.contacts.has(sample.id)) return [];
    this.contacts.set(sample.id, { x: sample.x, y: sample.y });
    if (this.dead || this.pair || this.contacts.size !== 2) return [];

    const [first, second] = [...this.contacts.keys()] as [number, number];
    this.pair = [first, second];
    const [a, b] = [this.contacts.get(first)!, this.contacts.get(second)!];
    this.startDistance = Math.hypot(a.x - b.x, a.y - b.y);
    this.lastMidpoint = CameraGesture.midpoint(a, b);
    this.lastEffective = CameraGesture.effectiveDistance(this.startDistance, this.startDistance, this.config.slopPx, this.config.minBasePx);
    return [{ type: 'start', midpoint: this.lastMidpoint, distance: this.startDistance }];
  }

  move(sample: PinchSample): CameraGestureIntent[] {
    const contact = this.contacts.get(sample.id);
    if (!contact) return [];
    contact.x = sample.x;
    contact.y = sample.y;
    if (!this.pair || !this.pair.includes(sample.id)) return [];

    const a = this.contacts.get(this.pair[0])!;
    const b = this.contacts.get(this.pair[1])!;
    const midpoint = CameraGesture.midpoint(a, b);
    const effective = CameraGesture.effectiveDistance(this.startDistance, Math.hypot(a.x - b.x, a.y - b.y), this.config.slopPx, this.config.minBasePx);
    const factor = effective / this.lastEffective;
    const moved = Math.hypot(midpoint.x - this.lastMidpoint.x, midpoint.y - this.lastMidpoint.y);
    if (moved < 0.01 && Math.abs(factor - 1) < 1e-6) return [];

    const step: PinchStep = { from: this.lastMidpoint, to: midpoint, factor };
    this.lastMidpoint = midpoint;
    this.lastEffective = effective;
    return [{ type: 'step', step }];
  }

  up(id: number): CameraGestureIntent[] {
    return this.release(id, 'finger lifted');
  }

  /** The browser took a finger away (`pointercancel`). */
  cancel(id: number): CameraGestureIntent[] {
    return this.release(id, 'pointercancel');
  }

  /** Drop every finger: the page was hidden or lost focus, or the layer is going away. */
  cancelAll(reason: string): CameraGestureIntent[] {
    const intents: CameraGestureIntent[] = this.pair ? [{ type: 'end', reason }] : [];
    this.contacts.clear();
    this.pair = null;
    this.dead = false;
    return intents;
  }

  private release(id: number, reason: string): CameraGestureIntent[] {
    if (!this.contacts.delete(id)) return [];
    let intents: CameraGestureIntent[] = [];
    if (this.pair?.includes(id)) {
      this.pair = null;
      this.dead = true;
      intents = [{ type: 'end', reason }];
    }
    if (this.contacts.size === 0) this.dead = false;
    return intents;
  }

  private static midpoint(a: CameraPoint, b: CameraPoint): CameraPoint {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
}
