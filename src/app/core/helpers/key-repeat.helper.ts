/** The two timer calls the scheduler needs, so a test can hand in a clock and the deck can hand in one that runs outside the zone. */
export interface KeyRepeatTimers {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface KeyRepeatOptions {
  /** How long the key is held before it starts to repeat. */
  delayMs: number;
  /** The gap between repeats once it has started. */
  intervalMs: number;
  /** A tick is skipped (not queued) while the key queue already holds this many tasks. */
  maxPending: number;
  /** A hold that has not been released after this long was lost, and stops by itself. */
  maxHoldMs: number;
}

export interface KeyRepeatHooks {
  /** Press the key once. `repeats` is 0 for the press as the finger lands and 1, 2, ... for each repeat after it. */
  fire: (repeats: number) => void;
  /** How many tasks the key queue holds now, the one in flight included. */
  pending: () => number;
}

/**
 * Why a hold ended: the finger lifted (`release`), nobody released it (`limit`), it was pressed
 * again (`restart`), or the page ended it for a reason of its own (`cancel`: a blur, a panel
 * switched under the finger, an emulator that went away).
 */
export type KeyRepeatStop = 'release' | 'limit' | 'restart' | 'cancel';

const BROWSER_TIMERS: KeyRepeatTimers = {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * The hold-to-repeat of one deck key: press, wait `delayMs`, then press again every `intervalMs`
 * until the finger lifts. It knows nothing about keys, the DOM or Angular; the deck gives it the
 * press and the queue depth, and a clock when it needs one.
 *
 * Three rules, each there because the guest punishes the alternative:
 *
 * - **It never builds a backlog.** A tick that finds the key queue already holding `maxPending`
 *   tasks does nothing and waits for the next one. The queue spends about 20 ms on a chord and a
 *   slow phone more, so a repeat that queued regardless would go on typing after the finger had
 *   lifted, and an arrow that scrolls a list past the row the player meant is worse than a slow one.
 * - **It cannot run away.** Whatever the page does (a lost `pointerup`, a panel switched under the
 *   finger, a tab sent to the background), `stop()` is the only thing that must be called, and
 *   `maxHoldMs` is the net under it: a held key that nobody released ends by itself.
 * - **It is exact about its timers.** One timer is armed at a time, and `stop()` clears every one,
 *   so a stopped scheduler leaves nothing scheduled (the specs assert it).
 */
export class KeyRepeatScheduler {
  private tickHandle: unknown = null;
  private holdHandle: unknown = null;
  private isRunning = false;
  private skippedTicks = 0;
  private firedTicks = 0;

  constructor(
    private readonly options: KeyRepeatOptions,
    private readonly hooks: KeyRepeatHooks,
    private readonly timers: KeyRepeatTimers = BROWSER_TIMERS,
    private readonly onStop?: (reason: KeyRepeatStop, fired: number, skipped: number) => void,
  ) { }

  get running(): boolean {
    return this.isRunning;
  }

  /** Press the key now, and start repeating it if it is still held after the delay. */
  start(): void {
    if (this.isRunning) this.stop('restart');
    this.isRunning = true;
    this.skippedTicks = 0;
    this.firedTicks = 0;
    this.holdHandle = this.timers.setTimeout(() => this.stop('limit'), this.options.maxHoldMs);
    this.run(() => this.hooks.fire(0));
    if (this.isRunning) this.arm(this.options.delayMs);
  }

  /** The key was released (or the hold was lost). Idempotent. */
  stop(reason: KeyRepeatStop = 'release'): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.tickHandle !== null) this.timers.clearTimeout(this.tickHandle);
    if (this.holdHandle !== null) this.timers.clearTimeout(this.holdHandle);
    this.tickHandle = null;
    this.holdHandle = null;
    this.onStop?.(reason, this.firedTicks, this.skippedTicks);
  }

  private arm(ms: number): void {
    this.tickHandle = this.timers.setTimeout(() => this.tick(), ms);
  }

  private tick(): void {
    this.tickHandle = null;
    if (!this.isRunning) return;
    if (this.hooks.pending() >= this.options.maxPending) {
      this.skippedTicks++;
    } else {
      this.firedTicks++;
      this.run(() => this.hooks.fire(this.firedTicks));
    }
    if (this.isRunning) this.arm(this.options.intervalMs);
  }

  /** A press that throws ends the repeat: a runaway loop of failures is the one thing worse than a dead key. */
  private run(press: () => void): void {
    try {
      press();
    } catch (error) {
      this.stop('release');
      throw error;
    }
  }
}
