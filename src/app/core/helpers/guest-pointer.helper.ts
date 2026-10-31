import { TOUCH_INPUT } from '../models/constants';
import { DosCI } from '../typings/jsdos';

/** A position in the guest's own pixels (the frame js-dos draws: 640x480 or 800x600). */
export interface GuestPoint {
  x: number;
  y: number;
}

/** One relative send: the units to hand `sendMouseRelativeMotion`, and where it should leave the cursor. */
export interface GuestChunk {
  dx: number;
  dy: number;
  /** The cursor's position after the send, clipped to the frame as the guest clips it. */
  to: GuestPoint;
}

export interface GuestFrame {
  width: number;
  height: number;
}

/**
 * The guest's relative-motion rules, as plain functions. Everything in here was measured against
 * the real Windows 3.1 guest with the RAM oracle (scripts/touch-harness) and none of it is
 * obvious:
 *
 * - Per axis, Windows moves the cursor 1 px per unit for an event of up to 2 units and 2 px per
 *   unit beyond that (its mouse acceleration, one threshold). The two axes do not influence each
 *   other: (1, 100) moves 1 and 200.
 * - The cursor is clipped to the frame, [0, width-1] x [0, height-1].
 * - A single positive event of 256 units or more wraps modulo 256, and -300 does something else
 *   again; only -255..255 is trustworthy.
 *
 * Kept free of Angular and of the emulator so the arithmetic can be tested on plain numbers.
 */
export class GuestPointerMath {

  /** How many guest pixels a relative event of `units` moves the cursor on one axis. */
  static applied(units: number): number {
    return Math.abs(units) <= 2 ? units : units * 2;
  }

  /**
   * Whether `(dx, dy)` may be handed to the emulator. A NaN poisons the guest's mouse until the
   * page reloads (the sprite stays at (0, 0) and later motion changes nothing, found in P4), a
   * fraction is not a mickey, and a big event wraps, so anything that is not a whole number in
   * range is refused rather than sent.
   */
  static isSendable(dx: number, dy: number, maxUnits: number = TOUCH_INPUT.MAX_SEND_UNITS): boolean {
    return Number.isInteger(dx) && Number.isInteger(dy) && Math.abs(dx) <= maxUnits && Math.abs(dy) <= maxUnits;
  }

  /**
   * The units that bring one axis closest to `delta` guest pixels in a single event of at most
   * `maxUnits`. Up to 2 px the unit count is the pixel count; beyond that it is half, rounded to
   * whichever neighbour leaves the smaller error. A send can only move 0, 1, 2, then 6, 8, 10...
   * pixels (3 units already move 6), so 3 px is 2 units and 1 px short, and 4 px is a tie between
   * 2 px and 6 px that takes a second send to finish. Zero for anything that is not a finite
   * number: a NaN must never become a send.
   */
  static unitsFor(delta: number, maxUnits: number = TOUCH_INPUT.MAX_CHUNK_UNITS): number {
    if (!Number.isFinite(delta)) return 0;
    const wanted = Math.round(delta);
    if (wanted === 0) return 0;

    const distance = Math.abs(wanted);
    if (distance <= 2) return wanted;

    const base = Math.min(maxUnits, Math.round(distance / 2));
    let best = base;
    let bestError = Number.POSITIVE_INFINITY;
    for (const candidate of [base - 1, base, base + 1]) {
      if (candidate < 1 || candidate > maxUnits) continue;
      const error = Math.abs(distance - GuestPointerMath.applied(candidate));
      if (error < bestError) {
        best = candidate;
        bestError = error;
      }
    }
    return Math.sign(wanted) * best;
  }

  /** `point` clipped into the frame, in whole pixels. */
  static clamp(point: GuestPoint, frame: GuestFrame): GuestPoint {
    return {
      x: Math.min(Math.max(Math.round(point.x), 0), frame.width - 1),
      y: Math.min(Math.max(Math.round(point.y), 0), frame.height - 1),
    };
  }

  /**
   * The next send on the way from `from` to `to`, both axes in one event, or `null` once the
   * cursor is within `tolerance` px on both. Stopping at a pixel away is deliberate: the model
   * tracks where the cursor really is (it adds exactly what the guest applies), so a pixel of
   * residual is a known 1 px offset, not an error that grows, and chasing it costs a send.
   */
  static nextChunk(
    from: GuestPoint,
    to: GuestPoint,
    frame: GuestFrame,
    maxUnits: number = TOUCH_INPUT.MAX_CHUNK_UNITS,
    tolerance = 1,
  ): GuestChunk | null {
    const errorX = to.x - from.x;
    const errorY = to.y - from.y;
    if (Math.abs(errorX) <= tolerance && Math.abs(errorY) <= tolerance) return null;

    const dx = GuestPointerMath.unitsFor(errorX, maxUnits);
    const dy = GuestPointerMath.unitsFor(errorY, maxUnits);
    if (dx === 0 && dy === 0) return null;

    return {
      dx,
      dy,
      to: GuestPointerMath.clamp(
        { x: from.x + GuestPointerMath.applied(dx), y: from.y + GuestPointerMath.applied(dy) },
        frame,
      ),
    };
  }
}

/** Where the engine writes down what it did; a thunk is only called when someone is listening. */
export type GuestPointerLogger = (message: string, data?: () => unknown) => void;

export interface GuestPointerOptions {
  /** The least time between two motion sends (and between the last one and a button event). */
  spacingMs: number;
  maxChunkUnits: number;
  homeSends: number;
  homeUnits: number;
  clickHoldMs: number;
  idleRehomeMs: number;
  rehomeAfterMoves: number;
  forcedRehomeSends: number;
  maxSendsPerMove: number;
  /** Milliseconds on a monotonic clock. `performance.now()` unless a spec injects its own. */
  now: () => number;
  log?: GuestPointerLogger;
  /**
   * Called before every send to the guest, a motion or a button. The layer uses it to wake a guest
   * that is asleep (EmulatorPowerService): the engine's timers keep sending after the finger has
   * gone (the cursor walking to its target, the idle re-home), and what reaches a paused guest is
   * applied in one go when it resumes, which is exactly what the one-send-per-frame rule exists to
   * prevent. A hook that throws is the caller's problem and does not stop the send.
   */
  beforeSend?: () => void;
}

type OpKind = 'move' | 'press' | 'release' | 'click' | 'home';

interface Op {
  kind: OpKind;
  /** Where a `move` is heading. Replaced while it is still queued or running: the latest wins. */
  target?: GuestPoint;
  /** Finished, or abandoned: nothing may be merged into it any more. */
  done: boolean;
  queuedAt: number;
  promise: Promise<void>;
  settle: () => void;
  /** What the op does, given the epoch it started under. */
  exec: (op: Op, epoch: number) => Promise<void>;
}

/**
 * Drives the guest's mouse from outside, blind: it never reads the cursor back. js-dos's own
 * absolute mode is unusable against this guest (150-350 px off, measured four ways: DOSBox keeps
 * its int33 range at 640x200 and Windows 3.1 consumes mickey deltas), and reading the position
 * out of guest RAM works but couples to addresses that may move. What does work is dead
 * reckoning on relative motion, because the guest's rules (see {@link GuestPointerMath}) are exact:
 * park the cursor in the top-left corner, where it clips to a position the model knows, then
 * add up what every send does.
 *
 * Load-bearing, each measured:
 *
 * - **One send per frame, never two in a tick.** The guest sums the units of sends that arrive close
 *   together and only then applies the gain: two 2-unit sends are 1x each, but summed they are 4
 *   units and move 8 px, not 4. Sends in one tick are summed outright and then the wrap applies to
 *   the sum (four 70-unit sends in one tick move 48 px, not 560). Measured with the oracle, pairs of
 *   2-unit sends were summed 40 of 40 times at 14 ms, 11 of 40 at 16 ms and 0 of 40 from 18 ms: the
 *   boundary is the frame, ~16.7 ms. The spacing is counted from the previous send's actual time,
 *   never from a schedule, so a late timer can only widen the gap.
 * - **Chunks of at most {@link GuestPointerOptions.maxChunkUnits}**, so even two chunks that are
 *   summed on a slow device stay under the 256 that wraps.
 * - **The model adds exactly what the guest applies, and clips as the guest does.**
 * - **A move is one op whose target can be replaced while it runs.** A finger produces moves far
 *   faster than the guest can take them, so a new target merges into the move at the tail of the
 *   queue instead of queuing a path nobody wants any more.
 * - **A button is released in every path.** `abort()` is synchronous and releases at once; an op
 *   that was in flight notices the new epoch and does nothing more, so a late timer can never press
 *   or release on behalf of a gesture that was cancelled.
 * - **Re-homing is rare, idle and in place.** It flings the cursor to the corner, and the cursor is
 *   part of the picture spectators watch. What it guards against is what the model cannot see: the
 *   guest drifts by a 2 px quantum that comes and goes and does not accumulate (measured), but a
 *   warp, a dropped message or a real mouse would not announce themselves. So it only runs after the
 *   options' idle time with more than `rehomeAfterMoves` moves since the last home (or when the
 *   frame size changes, or a real mouse moved the cursor behind our back), and the cursor goes back
 *   where it was. The return is an ordinary move, so a finger that lands meanwhile simply
 *   redirects it. The idle one never runs while a finger is down or a button is held: an aim-mode
 *   finger lining up a 6 px target is quiet to the engine. No home of any kind runs with the button
 *   down, because it would fling a scrollbar thumb or a window to the corner: the send budget waits for
 *   the release, and a press that outlives its position (the frame changed, or a real mouse moved
 *   the cursor) is released rather than homed.
 *
 * Everything is serialised on one queue, and the class depends on nothing but the `DosCI`
 * interface, so a spec drives it with a fake guest and a fake clock.
 */
export class GuestPointer {
  /** The defaults, from {@link TOUCH_INPUT}; a spec or the harness overrides what it needs. */
  static defaults(): GuestPointerOptions {
    return {
      spacingMs: TOUCH_INPUT.SEND_SPACING_MS,
      maxChunkUnits: TOUCH_INPUT.MAX_CHUNK_UNITS,
      homeSends: TOUCH_INPUT.HOME_SENDS,
      homeUnits: TOUCH_INPUT.HOME_UNITS,
      clickHoldMs: TOUCH_INPUT.CLICK_HOLD_MS,
      idleRehomeMs: TOUCH_INPUT.IDLE_REHOME_MS,
      rehomeAfterMoves: TOUCH_INPUT.REHOME_AFTER_MOVES,
      forcedRehomeSends: TOUCH_INPUT.FORCED_REHOME_SENDS,
      maxSendsPerMove: TOUCH_INPUT.MAX_SENDS_PER_MOVE,
      now: () => performance.now(),
    };
  }

  /** Running totals, for tests and the diagnostics log. */
  readonly stats = { sends: 0, homes: 0, moves: 0, clicks: 0, aborts: 0, refused: 0, minGapMs: Number.POSITIVE_INFINITY, maxGapMs: 0 };

  private readonly options: GuestPointerOptions;
  private estimate: GuestPoint | null = null;
  /** The frame the estimate was homed in: another size means another corner, and a new home. */
  private homedFrame: GuestFrame | null = null;
  private lastMotionAt = Number.NEGATIVE_INFINITY;
  private pressed = false;
  /** A finger is on the screen, whether or not it holds the button: set by the layer, read by the idle re-home. */
  private fingerDown = false;
  private ops: Op[] = [];
  private pumping = false;
  /** Bumped by every abort; an op that started under an older value must stop touching the guest. */
  private epoch = 0;
  private movesSinceHome = 0;
  private sendsSinceHome = 0;
  private lastActivityAt: number;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(private readonly ci: DosCI, options: Partial<GuestPointerOptions> = {}) {
    this.options = { ...GuestPointer.defaults(), ...options };
    this.lastActivityAt = this.options.now();
  }

  /** Where the model puts the cursor, or `null` when it does not know (not homed yet). */
  get position(): GuestPoint | null {
    return this.estimate ? { ...this.estimate } : null;
  }

  /** Whether the left button is down in the guest, as far as this class knows. */
  get buttonDown(): boolean {
    return this.pressed;
  }

  /** Ops waiting to run, the one in flight included. */
  get pending(): number {
    return this.ops.length;
  }

  /** Change the tuning of a live engine (the harness sweeps the spacing this way). */
  configure(options: Partial<GuestPointerOptions>): void {
    Object.assign(this.options, options);
  }

  /**
   * Walk the cursor to `point` (guest pixels). Fire and forget: the promise settles when the move
   * is over, or was dropped, and never rejects. Calling it again before it ends only changes where
   * it is heading.
   */
  moveTo(point: GuestPoint): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      this.stats.refused++;
      this.options.log?.('refused a move', () => point);
      return Promise.resolve();
    }

    this.noteActivity();
    const tail = this.ops[this.ops.length - 1];
    if (tail && tail.kind === 'move' && !tail.done) {
      tail.target = { x: point.x, y: point.y };
      return tail.promise;
    }
    return this.enqueue('move', (op, epoch) => this.runMove(op, epoch), { x: point.x, y: point.y }).promise;
  }

  /** Press the left button once the cursor has arrived. */
  press(): Promise<void> {
    return this.enqueueButton('press');
  }

  /** Release the left button once the cursor has arrived where the last move was heading. */
  release(): Promise<void> {
    return this.enqueueButton('release');
  }

  /** A full click: press, hold, release. The release is in a `finally`. */
  click(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.noteActivity();
    return this.enqueue('click', (op, epoch) => this.runClick(op, epoch)).promise;
  }

  /** Park the cursor in the corner now if the model does not know where it is. */
  prime(): Promise<void> {
    if (this.disposed || this.estimate) return Promise.resolve();
    this.noteActivity();
    return this.enqueue('home', async (_op, epoch) => { await this.runHome(epoch, 'prime'); }).promise;
  }

  /**
   * Stop everything, now and synchronously: drop what is queued, make anything in flight stand
   * down, and release the button if it is down. This is the path for a cancelled touch, a page
   * that is going away and a detach, none of which can wait for a timer.
   */
  abort(reason: string): void {
    this.epoch++;
    this.stats.aborts++;
    const dropped = this.ops.splice(0);
    for (const op of dropped) {
      op.done = true;
      op.settle();
    }
    const wasPressed = this.pressed;
    if (this.pressed) {
      try {
        this.sendButton(false);
      } catch (error) {
        this.options.log?.('release failed', () => ({ reason, error }));
      }
    }
    this.options.log?.('abort', () => ({ reason, dropped: dropped.length, wasPressed }));
  }

  /**
   * Forget where the cursor is. Something other than this class moved it (a real mouse, on a
   * device that has both), so the next move homes first.
   */
  invalidate(reason: string): void {
    if (!this.estimate) return;
    this.estimate = null;
    this.options.log?.('position forgotten', () => ({ reason }));
  }

  /**
   * Tell the engine whether a finger is on the screen. Only the idle re-home reads it: aim mode
   * holds a finger still with no button down and nothing queued, which is exactly what idle looks
   * like from in here.
   */
  setFingerDown(down: boolean): void {
    if (this.fingerDown === down) return;
    this.fingerDown = down;
    // The quiet time is counted from the lift, not from the last send before a long hold.
    if (!down && !this.disposed) this.noteActivity();
  }

  /** Abort, and never act again. */
  dispose(): void {
    if (this.disposed) return;
    this.abort('dispose');
    this.disposed = true;
    if (this.idleTimer !== undefined) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  // -------------------------------------------------------------------------------- the queue

  private enqueueButton(kind: 'press' | 'release'): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.noteActivity();
    return this.enqueue(kind, (_op, epoch) => this.runButton(kind, epoch)).promise;
  }

  private enqueue(kind: OpKind, exec: Op['exec'], target?: GuestPoint): Op {
    let settle!: () => void;
    const promise = new Promise<void>(resolve => { settle = resolve; });
    const op: Op = { kind, target, done: false, queuedAt: this.options.now(), promise, settle, exec };
    this.ops.push(op);
    this.pump();
    return op;
  }

  private pump(): void {
    if (this.pumping) return;
    this.pumping = true;
    void (async () => {
      try {
        while (this.ops.length > 0) {
          const op = this.ops[0];
          try {
            await op.exec(op, this.epoch);
          } catch (error) {
            // Most likely the emulator is gone. Nothing queued is worth sending to it, and a
            // button that went down must still come up.
            this.options.log?.('op failed', () => ({ kind: op.kind, error }));
            this.abort('error');
          } finally {
            op.done = true;
            if (this.ops[0] === op) this.ops.shift();
            op.settle();
          }
        }
      } finally {
        this.pumping = false;
        this.noteActivity();
      }
    })();
  }

  // ------------------------------------------------------------------------------------ the ops

  private async runMove(op: Op, epoch: number): Promise<void> {
    const began = this.options.now();
    const started = this.estimate ? { ...this.estimate } : null;
    let sends = 0;
    let units = 0;
    let minGap = Number.POSITIVE_INFINITY;
    let maxGap = 0;

    try {
      for (;;) {
        if (epoch !== this.epoch) return;
        const frame = this.frame();
        if (!frame) return;

        if (this.needsHome(frame)) {
          if (this.pressed) {
            // A home sends the cursor to the corner, which with the button down drags whatever is
            // under it there. The position is lost (the frame changed or a real mouse moved it), so
            // the press has nowhere to go: let it go.
            this.abort('position lost while pressed');
            return;
          }
          if (!(await this.runHome(epoch, this.homeReason(frame)))) return;
          continue;
        }

        let chunk = GuestPointerMath.nextChunk(this.estimate!, GuestPointerMath.clamp(op.target!, frame), frame, this.options.maxChunkUnits);
        if (!chunk || sends >= this.options.maxSendsPerMove) return;

        await this.waitForSpacing();
        if (epoch !== this.epoch) return;
        // The target may have been replaced while this waited, and the frame may have changed.
        const fresh = this.frame();
        if (!fresh || this.needsHome(fresh)) continue;
        chunk = GuestPointerMath.nextChunk(this.estimate!, GuestPointerMath.clamp(op.target!, fresh), fresh, this.options.maxChunkUnits);
        if (!chunk) return;

        const gap = this.sendMotion(chunk.dx, chunk.dy);
        if (gap === null) return;
        this.estimate = chunk.to;
        sends++;
        units += Math.abs(chunk.dx) + Math.abs(chunk.dy);
        if (Number.isFinite(gap)) {
          minGap = Math.min(minGap, gap);
          maxGap = Math.max(maxGap, gap);
        }
      }
    } finally {
      // Synchronous with the loop's exit: a moveTo() that lands after this starts a new op
      // instead of merging into one that will never look at its target again.
      op.done = true;
      if (sends > 0) {
        this.movesSinceHome++;
        this.stats.moves++;
        const target = op.target;
        this.options.log?.('move', () => ({
          from: started, to: this.estimate, wanted: target, sends, units,
          ms: Math.round((this.options.now() - began) * 10) / 10,
          minGapMs: Number.isFinite(minGap) ? Math.round(minGap * 10) / 10 : null,
          maxGapMs: Math.round(maxGap * 10) / 10,
        }));
      }
    }
  }

  /** Clip the cursor into the corner, the one position the model knows. False if it was cut short. */
  private async runHome(epoch: number, reason: string): Promise<boolean> {
    const began = this.options.now();
    // Unknown until it has finished: a home that is aborted half way leaves the cursor anywhere.
    this.estimate = null;
    for (let i = 0; i < this.options.homeSends; i++) {
      await this.waitForSpacing();
      if (epoch !== this.epoch) return false;
      if (this.sendMotion(this.options.homeUnits, this.options.homeUnits) === null) return false;
    }
    const frame = this.frame();
    if (!frame) return false;
    this.estimate = { x: 0, y: 0 };
    this.homedFrame = frame;
    this.movesSinceHome = 0;
    this.sendsSinceHome = 0;
    this.stats.homes++;
    this.options.log?.('home', () => ({ reason, sends: this.options.homeSends, ms: Math.round((this.options.now() - began) * 10) / 10 }));
    return true;
  }

  private async runButton(kind: 'press' | 'release', epoch: number): Promise<void> {
    await this.waitForSpacing();
    if (epoch !== this.epoch) return;
    this.sendButton(kind === 'press');
    this.options.log?.(kind, () => ({ at: this.estimate }));
  }

  private async runClick(op: Op, epoch: number): Promise<void> {
    await this.waitForSpacing();
    if (epoch !== this.epoch || this.pressed) return;
    this.sendButton(true);
    const pressedAt = this.options.now();
    try {
      await this.sleep(this.options.clickHoldMs);
    } finally {
      // Not when an abort already released it: a click that was cancelled must not release the
      // press of whatever came next.
      if (epoch === this.epoch) this.sendButton(false);
    }
    if (epoch !== this.epoch) return;
    this.stats.clicks++;
    this.options.log?.('click', () => ({
      at: this.estimate,
      waitedMs: Math.round((pressedAt - op.queuedAt) * 10) / 10,
      heldMs: Math.round((this.options.now() - pressedAt) * 10) / 10,
    }));
  }

  // -------------------------------------------------------------------------------- the guest

  /** The size of the frame the guest is drawing, or `null` before it has drawn one. */
  private frame(): GuestFrame | null {
    const width = this.ci.width();
    const height = this.ci.height();
    return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? { width, height } : null;
  }

  private sameFrame(frame: GuestFrame): boolean {
    return !!this.homedFrame && this.homedFrame.width === frame.width && this.homedFrame.height === frame.height;
  }

  private needsHome(frame: GuestFrame): boolean {
    return this.estimate === null
      || !this.sameFrame(frame)
      // The send budget is a safety net and can wait for the button to come up; the next move
      // after the release spends it.
      || (this.sendsSinceHome >= this.options.forcedRehomeSends && !this.pressed);
  }

  /** Why {@link needsHome} said yes, for the log. */
  private homeReason(frame: GuestFrame): string {
    if (this.estimate === null) return 'unknown position';
    return this.sameFrame(frame) ? 'send budget' : 'frame changed';
  }

  /**
   * Send one relative event, or refuse it. Returns the gap since the previous motion send, or
   * `null` when nothing was sent.
   */
  private sendMotion(dx: number, dy: number): number | null {
    if (!GuestPointerMath.isSendable(dx, dy)) {
      this.stats.refused++;
      this.options.log?.('refused a send', () => ({ dx, dy }));
      return null;
    }
    this.wake();
    this.ci.sendMouseRelativeMotion(dx, dy);
    const at = this.options.now();
    const gap = at - this.lastMotionAt;
    this.lastMotionAt = at;
    this.stats.sends++;
    this.sendsSinceHome++;
    if (Number.isFinite(gap)) {
      this.stats.minGapMs = Math.min(this.stats.minGapMs, gap);
      this.stats.maxGapMs = Math.max(this.stats.maxGapMs, gap);
    }
    return gap;
  }

  private sendButton(pressed: boolean): void {
    if (pressed === this.pressed) return;
    this.wake();
    if (pressed) {
      this.ci.sendMouseButton(0, true);
      this.pressed = true;
    } else {
      // Cleared first: if the emulator throws, the button is as released as it will ever be.
      this.pressed = false;
      this.ci.sendMouseButton(0, false);
    }
  }

  private wake(): void {
    try {
      this.options.beforeSend?.();
    } catch (error) {
      this.options.log?.('beforeSend threw', () => ({ error: String(error) }));
    }
  }

  /**
   * Wait until the spacing has passed since the last motion send. Counted from when that send
   * really happened, so a timer that fires late never makes the next gap shorter.
   */
  private async waitForSpacing(): Promise<void> {
    for (;;) {
      const remaining = this.lastMotionAt + this.options.spacingMs - this.options.now();
      if (remaining <= 0) return;
      await this.sleep(remaining);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ------------------------------------------------------------------------------ re-homing

  private noteActivity(): void {
    this.lastActivityAt = this.options.now();
    this.armIdleTimer(this.options.idleRehomeMs);
  }

  private armIdleTimer(afterMs: number): void {
    if (this.disposed || this.idleTimer !== undefined) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      this.onIdleTimer();
    }, afterMs);
  }

  private onIdleTimer(): void {
    if (this.disposed) return;
    const quietFor = this.options.now() - this.lastActivityAt;
    if (quietFor < this.options.idleRehomeMs) {
      this.armIdleTimer(this.options.idleRehomeMs - quietFor);
      return;
    }
    // Never mid-gesture: a button down, a finger down or work queued means someone is using it.
    if (this.pumping || this.ops.length > 0 || this.pressed || this.fingerDown) {
      this.armIdleTimer(this.options.idleRehomeMs);
      return;
    }
    if (this.estimate && this.movesSinceHome > this.options.rehomeAfterMoves) {
      this.rehomeInPlace();
    }
  }

  /**
   * Home, then walk back to where the cursor was. The return is an ordinary move at the tail of
   * the queue, so a touch that lands during the home retargets it instead of queueing behind it.
   */
  private rehomeInPlace(): void {
    const back = this.estimate ? { ...this.estimate } : null;
    if (!back) return;
    this.enqueue('home', async (_op, epoch) => { await this.runHome(epoch, 'idle'); });
    void this.moveTo(back);
  }
}
