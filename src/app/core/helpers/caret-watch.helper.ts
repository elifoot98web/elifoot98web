import { FIELD_HINT } from '../models/constants';

/** The part of an `ImageData` the hint helpers read: RGBA bytes, row by row. */
export interface FrameLike {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/** Where the caret is, in guest pixels: the top of the bar, and how tall it is. */
export interface CaretBar {
  x: number;
  y: number;
  h: number;
}

export type CaretState = { active: false } | ({ active: true } & CaretBar);

/** Pure parts of the caret watcher: the cadence of the frames, and the shape of what changed. */
export class CaretWatchHelper {

  /** A gap between two frames is a blink's. */
  static isBlinkGap(gapMs: number): boolean {
    return gapMs >= FIELD_HINT.BLINK_MIN_MS && gapMs <= FIELD_HINT.BLINK_MAX_MS;
  }

  /**
   * Whether the frames that arrived (`times`, oldest first, ms on any clock) look like a caret
   * blinking at `now`: enough of the recent ones, nearly all spaced like a blink. A still screen
   * sends no frames at all, so a field that is not focused never gets here.
   */
  static looksLikeBlink(times: readonly number[], now: number): boolean {
    const recent = times.filter(time => now - time <= FIELD_HINT.BLINK_WINDOW_MS);
    if (recent.length < 3) return false;
    let blinks = 0;
    for (let i = 1; i < recent.length; i++) {
      if (CaretWatchHelper.isBlinkGap(recent[i] - recent[i - 1])) blinks++;
    }
    const gaps = recent.length - 1;
    return blinks >= FIELD_HINT.BLINK_MIN_GAPS && gaps - blinks <= FIELD_HINT.BLINK_MAX_STRAY_GAPS;
  }

  /**
   * The one thin vertical bar by which two frames differ, or `null`: the caret erased in one and
   * drawn in the other. Anything wider, shorter, taller or sparser than a bar (a ball moving, a
   * dialog opening, the mouse cursor travelling) is not a caret.
   *
   * Compares the words of both frames first (a frame is a few hundred thousand pixels and almost
   * all of them are equal), and gives up as soon as more pixels differ than a bar can hold.
   */
  static findBar(a: FrameLike, b: FrameLike): CaretBar | null {
    if (a.width !== b.width || a.height !== b.height) return null;
    const { width, height } = a;
    const pixels = width * height;
    const limit = FIELD_HINT.BAR_MAX_WIDTH * FIELD_HINT.BAR_MAX_HEIGHT;
    const words = a.data.byteOffset % 4 === 0 && b.data.byteOffset % 4 === 0;
    const wordsA = words ? new Uint32Array(a.data.buffer, a.data.byteOffset, pixels) : null;
    const wordsB = words ? new Uint32Array(b.data.buffer, b.data.byteOffset, pixels) : null;

    let minX = width, maxX = -1, minY = height, maxY = -1, changed = 0;
    for (let i = 0; i < pixels; i++) {
      if (wordsA && wordsB && wordsA[i] === wordsB[i]) continue;
      const o = i * 4;
      const difference = Math.abs(a.data[o] - b.data[o]) + Math.abs(a.data[o + 1] - b.data[o + 1]) + Math.abs(a.data[o + 2] - b.data[o + 2]);
      if (difference <= FIELD_HINT.PIXEL_DIFF) continue;
      if (++changed > limit) return null;
      const x = i % width;
      const y = (i - x) / width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    if (changed === 0) return null;
    const barWidth = maxX - minX + 1;
    const barHeight = maxY - minY + 1;
    if (barWidth > FIELD_HINT.BAR_MAX_WIDTH) return null;
    if (barHeight < FIELD_HINT.BAR_MIN_HEIGHT || barHeight > FIELD_HINT.BAR_MAX_HEIGHT) return null;
    if (changed < barHeight * FIELD_HINT.BAR_MIN_FILL) return null;
    return { x: minX, y: minY, h: barHeight };
  }
}

export interface CaretWatcherTimers {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface CaretWatcherDeps {
  /** Milliseconds on a monotonic clock. */
  now(): number;
  /**
   * The guest's frame as it is NOW. js-dos copies the frame synchronously when this is called, so
   * calling it from the frame event itself is what makes two calls two consecutive frames.
   */
  screenshot(): Promise<FrameLike>;
  timers: CaretWatcherTimers;
  onChange(state: CaretState): void;
  log?(message: string, data?: () => unknown): void;
}

/**
 * "Is a caret blinking in the guest?", from the frame events alone. js-dos fires `onFrame` only
 * when the framebuffer changed, so an idle screen is silent and a focused edit control produces
 * one frame per blink; the cadence is the cheap test, and a pair of consecutive frames that differ
 * by exactly one thin bar is the confirmation (and says where the field is).
 *
 * The two frames are taken AT frame events, the first when the cadence is first suspected and the
 * second at the next event: they are then the caret drawn and the caret erased by construction. The
 * prototype took them 290 ms apart, which lands both in the same half of the 530 ms blink about
 * half of the time and needs a retry for it.
 *
 * While there is no caret it holds nothing but the last few timestamps: no timer runs on a screen
 * that sends no frames. Once there is one it keeps one timer, which asks "has a frame come in the
 * last second?" lazily (it re-arms for the time that is left rather than restarting per frame).
 *
 * **Latency is 1.6 to 2.2 s** from a field taking the focus (the first blink, two more to suspect
 * it, one for the pair): it is a hint. It misses a field whose text is selected (no caret blinks
 * there) and cannot see which field. It is nothing a decision hangs on.
 */
export class CaretWatcher {
  private times: number[] = [];
  private phase: 'looking' | 'armed' | 'verifying' | 'active' = 'looking';
  private first: Promise<FrameLike | null> | null = null;
  private firstAt = 0;
  private cooldownUntil = Number.NEGATIVE_INFINITY;
  private lastFrameAt = 0;
  private lastBlinkAt = 0;
  private goneHandle: unknown = null;
  private current: CaretState = { active: false };
  private disposed = false;

  constructor(private readonly deps: CaretWatcherDeps) { }

  get state(): CaretState {
    return this.current;
  }

  /** The framebuffer changed. */
  onFrame(): void {
    if (this.disposed) return;
    const now = this.deps.now();
    const previous = this.times.length > 0 ? this.times[this.times.length - 1] : null;
    this.times.push(now);
    if (this.times.length > FIELD_HINT.FRAME_HISTORY) this.times.shift();
    this.lastFrameAt = now;

    switch (this.phase) {
      case 'looking':
        if (now >= this.cooldownUntil && CaretWatchHelper.looksLikeBlink(this.times, now)) this.arm(now);
        break;
      case 'armed':
        this.verify(now);
        break;
      case 'active':
        if (previous !== null && CaretWatchHelper.isBlinkGap(now - previous)) this.lastBlinkAt = now;
        else if (now - this.lastBlinkAt > FIELD_HINT.STALE_AFTER_MS) this.lose('no blink in a while');
        break;
      default:
        break;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearGone();
    this.first = null;
  }

  private arm(now: number): void {
    this.first = this.deps.screenshot().catch(() => null);
    this.firstAt = now;
    this.phase = 'armed';
  }

  private verify(now: number): void {
    const first = this.first;
    const gap = now - this.firstAt;
    this.first = null;
    // The pair must be one blink apart. A frame that came sooner is something else changing the
    // screen, and one that came later has a caret that stopped: either way the pair would not be.
    if (!first || !CaretWatchHelper.isBlinkGap(gap)) {
      this.phase = 'looking';
      this.cooldownUntil = now + FIELD_HINT.VERIFY_COOLDOWN_MS;
      return;
    }

    this.phase = 'verifying';
    const second = this.deps.screenshot().catch(() => null);
    void Promise.all([first, second]).then(([a, b]) => {
      if (this.disposed) return;
      const bar = a && b ? CaretWatchHelper.findBar(a, b) : null;
      if (bar) {
        this.deps.log?.('caret found', () => bar);
        this.phase = 'active';
        this.lastBlinkAt = this.deps.now();
        this.set({ active: true, ...bar });
        this.armGone();
      } else {
        this.deps.log?.('caret check found no bar');
        this.phase = 'looking';
        this.cooldownUntil = this.deps.now() + FIELD_HINT.VERIFY_COOLDOWN_MS;
      }
    });
  }

  private armGone(): void {
    if (this.goneHandle !== null || this.disposed) return;
    const left = FIELD_HINT.GONE_AFTER_MS - (this.deps.now() - this.lastFrameAt);
    this.goneHandle = this.deps.timers.setTimeout(() => {
      this.goneHandle = null;
      if (this.phase !== 'active') return;
      if (this.deps.now() - this.lastFrameAt >= FIELD_HINT.GONE_AFTER_MS) this.lose('no frames');
      else this.armGone();
    }, Math.max(1, left));
  }

  private lose(why: string): void {
    this.deps.log?.('caret lost', () => ({ why }));
    this.phase = 'looking';
    this.clearGone();
    this.set({ active: false });
  }

  private clearGone(): void {
    if (this.goneHandle === null) return;
    this.deps.timers.clearTimeout(this.goneHandle);
    this.goneHandle = null;
  }

  private set(state: CaretState): void {
    this.current = state;
    this.deps.onChange(state);
  }
}
