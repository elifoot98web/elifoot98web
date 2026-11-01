/**
 * The idle rule of EmulatorPowerService, as a state machine that owns no clock, no timer and no
 * emulator: every call carries the time, and what it returns is the thing to tell the emulator.
 * That is what lets a spec run a minute of idling in microseconds, and what keeps the one rule
 * that matters (when may the guest sleep) readable in one place.
 *
 * Three states, because "paused" is not one thing when the guest is asked to wake itself up:
 *
 * - `awake`: the guest runs. After `idleMs` with no frame and no input it may sleep, but only
 *   once the caller has asked the world one more question (see `look` below).
 * - `asleep`: `pause()` was sent. The policy `probe` resumes it every `sleepMs` for a short
 *   `probeMs`, so a guest that is computing without redrawing still advances; `hard` never does.
 * - `probing`: the guest runs for `probeMs` on trial. A frame in that window proves it was doing
 *   something visible and makes it `awake`; none, and it goes back to sleep.
 *
 * **The only question that cannot be answered synchronously is "is the game's save dialog up?"**
 * (a look at the screen, and the OCR behind it). So going to sleep is a handshake: `tick` returns
 * `look` once the idle time has passed, the caller asks, and `answer` decides: only a definite
 * `false` sleeps, and only if nothing happened while the look was out. `true` (the dialog is up) and
 * `null` (the look could not tell) both keep the guest awake and are asked again after
 * `lookRetryMs`, never sooner (a `null` that repeats is asked less and less often, see
 * `lookRetryMaxMs`): a guest that cannot be asked is a guest that is not put to sleep.
 *
 * Everything that is not time is a *blocker*, a reason the guest must not sleep at all (a room
 * is live, the page is hidden, the game has not been seen yet, a persist or a send is in
 * progress). A blocker also counts as activity, so the idle time restarts when it ends, and an
 * `asleep` guest is woken by one the moment it appears.
 */

export type PowerState = 'awake' | 'asleep' | 'probing';

/** What a sleeping guest does about guest-side work that never redraws: `probe` lets it run a little, `hard` does not. */
export type PowerPolicy = 'probe' | 'hard';

/** What to do to the emulator (or, for `look`, to ask before doing it). */
export type PowerCommand = 'none' | 'pause' | 'resume' | 'look';

export interface PowerStep {
  command: PowerCommand;
  /** The state before the step, so a caller can tell a wake from a probe without keeping its own copy. */
  from: PowerState;
  /** The state after the step, whether or not there is a command. */
  state: PowerState;
  /** For the log: what made this step do what it did. */
  why: string;
  /** Set when this step made the idle time grow (a stall was seen): the new idle time. */
  grewTo?: number;
}

export interface PowerConfig {
  /** No frame for this long, and the guest may sleep (see also `inputQuietMs`). */
  idleMs: number;
  /**
   * No input for this long, and the guest may sleep. At least `idleMs` in practice. This is the
   * guard against the one thing a frame counter cannot see: a computation. Elifoot spends seconds
   * with the picture untouched after a tap (measured on a desktop: 4.9 s, 9.3 s), and a guest put
   * to sleep in the middle of one is slowed by the probe's duty cycle for the rest of it.
   */
  inputQuietMs: number;
  /** A sleeping guest on the `probe` policy is resumed after this long asleep... */
  sleepMs: number;
  /** ...and put back to sleep after this long without a frame. */
  probeMs: number;
  policy: PowerPolicy;
  /** After a look that did not say "no dialog", the earliest the next one may be asked. */
  lookRetryMs: number;
  /**
   * A look that could not tell (`null`) says something about the page, not about the screen: auto-save is
   * off or the OCR is not there, and it will be the same a second from now. Each one in a row doubles the
   * wait up to this; a dialog that is up (`true`) is asked again at `lookRetryMs`, because it will be gone in a moment.
   */
  lookRetryMaxMs: number;
  /**
   * The most the idle time may grow to when a frame arrives from a guest this machine put to sleep
   * (see `frame`). 0 turns the growing off.
   */
  maxIdleMs: number;
  /**
   * How early a span may be counted as over. The caller checks on a timer, and a timer that fires
   * a hair early (the clock is coarsened) would otherwise cost a probe a whole extra tick: 249.6 ms
   * is not 250, and the probe would run to 500.
   */
  slackMs: number;
}

/** Why the guest must stay awake whatever the clock says; `null` when nothing does. */
export type PowerBlocker = string | null;

export class IdlePowerMachine {
  private current: PowerState = 'awake';
  /** `current` as the public call in progress found it. */
  private before: PowerState = 'awake';
  private lastFrameAt: number;
  private lastInputAt: number;
  private sleptAt = 0;
  private probedAt = 0;
  /** When the look that is out was asked, or `null` when none is. */
  private lookAskedAt: number | null = null;
  private lookRetryAt = Number.NEGATIVE_INFINITY;
  /** Looks in a row that could not tell. Only a definite answer ends the run: it is a property of the page, not of the activity. */
  private unreadable = 0;
  private longest = 0;

  constructor(private config: PowerConfig, now: number) {
    this.lastFrameAt = now;
    this.lastInputAt = now;
  }

  get state(): PowerState {
    return this.current;
  }

  /** True while a `pause()` is in force (a probe is the guest running). */
  get paused(): boolean {
    return this.current === 'asleep';
  }

  /**
   * The longest stretch between two frames that the guest spent awake, in ms. It is what the idle
   * time has to stay above, and the one number a device can give back to tune it: a gap that ended
   * with the guest asleep is not counted (the probe's duty cycle stretched it).
   */
  get longestFrameGapMs(): number {
    return this.longest;
  }

  /** The most recent moment something happened: the idle time counts from here. */
  get activeAt(): number {
    return Math.max(this.lastFrameAt, this.lastInputAt);
  }

  configure(config: Partial<PowerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * The guest drew a frame. This runs at the display rate during an animation, so the common
   * case is two assignments.
   */
  frame(now: number): PowerStep {
    this.before = this.current;
    const stretch = now - this.lastFrameAt;
    if (this.current === 'awake') this.longest = Math.max(this.longest, stretch);
    this.lastFrameAt = now;
    if (this.current === 'awake') return this.step('none', 'frame');

    const wasAsleep = this.current === 'asleep';
    this.current = 'awake';
    // The guest drew something nobody asked for while it was supposed to be asleep: it was working.
    // That is the stall this rule exists to avoid, seen for the first time on this device, and the
    // quiet stretch that just ended (inflated by the duty cycle, which errs the safe way) is the
    // newest evidence of how long this guest stays quiet while it works. The idle time grows to
    // twice that, so the same stretch is not cut again. It never shrinks, and has a ceiling.
    const grew = this.learn(stretch);
    // (A frame already in flight when the pause went out would be read the same way; it costs one
    // growth and is bounded by the ceiling.)
    // Telling a guest that is supposed to be paused to run is harmless if it already does, and the
    // only safe reading if it does not.
    const step = wasAsleep ? this.step('resume', 'frame while asleep') : this.step('none', 'frame during a probe');
    return grew === null ? step : { ...step, grewTo: grew };
  }

  /** Something wants the guest: the player, or a flow that is about to talk to it. Idempotent. */
  input(now: number): PowerStep {
    this.before = this.current;
    this.lastInputAt = now;
    if (this.current === 'awake') return this.step('none', 'input');
    const wasAsleep = this.current === 'asleep';
    this.current = 'awake';
    // The silence up to now was the machine's own doing, and not how long the guest stays quiet when it
    // runs: the first frame after this wake must not be read as a gap that long (see `longestFrameGapMs`).
    this.lastFrameAt = now;
    return wasAsleep ? this.step('resume', 'input') : this.step('none', 'input during a probe');
  }

  /**
   * The page is visible again. js-dos resumes the emulator itself on `visibilitychange` (it pauses
   * it when hidden), so whatever this machine believed about a sleeping guest is stale: it is awake,
   * and the idle time starts over. No command: js-dos already sent it.
   */
  visible(now: number): PowerStep {
    this.before = this.current;
    this.current = 'awake';
    this.lastFrameAt = now;
    this.lastInputAt = now;
    this.lookAskedAt = null;
    return this.step('none', 'page visible');
  }

  /** One look at the clock. `blocker` is the first reason the guest must not sleep, or `null`. */
  tick(now: number, blocker: PowerBlocker): PowerStep {
    this.before = this.current;
    if (blocker !== null) {
      // The blocker is activity: the idle time starts when it ends, not when the last frame was.
      this.lastInputAt = now;
      this.lookAskedAt = null;
      if (this.current === 'asleep') {
        this.current = 'awake';
        this.lastFrameAt = now;
        return this.step('resume', blocker);
      }
      this.current = 'awake';
      return this.step('none', blocker);
    }

    switch (this.current) {
      case 'awake':
        if (!this.quiet(now)) return this.step('none', 'active');
        if (this.lookAskedAt !== null) return this.step('none', 'look out');
        if (now < this.lookRetryAt) return this.step('none', 'look held off');
        this.lookAskedAt = now;
        return this.step('look', 'idle');
      case 'asleep':
        if (this.config.policy !== 'probe' || !this.over(now, this.sleptAt, this.config.sleepMs)) return this.step('none', 'asleep');
        this.current = 'probing';
        this.probedAt = now;
        return this.step('resume', 'probe');
      case 'probing':
        if (!this.over(now, this.probedAt, this.config.probeMs)) return this.step('none', 'probing');
        this.current = 'asleep';
        this.sleptAt = now;
        return this.step('pause', 'probe saw no frame');
    }
  }

  /**
   * The answer to a `look`: `false` is "the save dialog is not up", `true` is "it is", `null` is
   * "could not tell". Only `false` puts the guest to sleep, and only if nothing happened since the
   * look was asked (a frame or an input during it makes the answer about a screen that has moved)
   * and nothing blocks it now (a look takes time, and a room or a persist can begin meanwhile).
   */
  answer(now: number, verdict: boolean | null, blocker: PowerBlocker): PowerStep {
    this.before = this.current;
    const askedAt = this.lookAskedAt;
    this.lookAskedAt = null;
    if (askedAt === null || this.current !== 'awake') return this.step('none', 'stale answer');
    if (blocker !== null) {
      this.lastInputAt = now;
      return this.step('none', blocker);
    }
    if (verdict === null) {
      const { lookRetryMs, lookRetryMaxMs } = this.config;
      this.lookRetryAt = now + Math.min(Math.max(lookRetryMs, lookRetryMaxMs), lookRetryMs * 2 ** this.unreadable);
      this.unreadable++;
      return this.step('none', 'save dialog unreadable');
    }
    this.unreadable = 0;
    if (verdict === true) {
      this.lookRetryAt = now + this.config.lookRetryMs;
      return this.step('none', 'save dialog up');
    }
    if (this.activeAt >= askedAt) return this.step('none', 'activity during the look');
    this.current = 'asleep';
    this.sleptAt = now;
    return this.step('pause', 'idle');
  }

  /** Give the guest back: the command to leave it running, and the machine back to `awake`. */
  settle(now: number): PowerStep {
    this.before = this.current;
    const wasAsleep = this.current === 'asleep';
    this.current = 'awake';
    this.lastFrameAt = now;
    this.lastInputAt = now;
    this.lookAskedAt = null;
    return wasAsleep ? this.step('resume', 'stopped') : this.step('none', 'stopped');
  }

  /** Grow the idle time to cover a quiet stretch of `stretch` ms that ended with the guest at work. Returns the new idle time, or null if it did not change. */
  private learn(stretch: number): number | null {
    const { idleMs, maxIdleMs } = this.config;
    const wanted = Math.min(maxIdleMs, stretch * 2);
    if (maxIdleMs <= 0 || wanted <= idleMs) return null;
    this.config = { ...this.config, idleMs: wanted, inputQuietMs: Math.max(this.config.inputQuietMs, wanted) };
    return wanted;
  }

  /** Long enough without a frame, and long enough without input. */
  private quiet(now: number): boolean {
    return this.over(now, this.lastFrameAt, this.config.idleMs) && this.over(now, this.lastInputAt, this.config.inputQuietMs);
  }

  private over(now: number, since: number, span: number): boolean {
    return now - since >= span - this.config.slackMs;
  }

  private step(command: PowerCommand, why: string): PowerStep {
    return { command, from: this.before, state: this.current, why };
  }
}

/** The pure parts of reading the setting and of deciding what blocks sleep. */
export class EmulatorPowerHelper {
  /**
   * The stored choice, or the default for a player who never made one. Stored as an explicit
   * boolean either way, so changing the default later changes it only for the people who never
   * touched the switch.
   */
  static enabled(stored: unknown, byDefault: boolean): boolean {
    return typeof stored === 'boolean' ? stored : byDefault;
  }

  /**
   * The first reason the guest may not sleep right now, in the order that is cheapest to read and
   * most worth knowing. `null` when nothing stands in the way.
   */
  static blocker(state: {
    hosting: boolean;
    gameDetected: boolean;
    holds: number;
    busy: boolean;
  }): PowerBlocker {
    // A hidden page is not in this list on purpose: js-dos pauses the emulator when the page is
    // hidden and resumes it when it is visible again, so while it is hidden the service neither
    // pauses nor resumes anything (a probe would run the emulator in the background) and asks the
    // machine nothing; `visible()` is what puts the machine right afterwards.
    // v1 is conservative: a host's stream is the guest's picture, and what a paused guest does to
    // the encoder and to a spectator who joins meanwhile has not been looked at.
    if (state.hosting) return 'hosting';
    // Before the game's own screen is up the guest is booting, and DOS, Windows and the game
    // each spend long stretches loading without drawing anything.
    if (!state.gameDetected) return 'game not detected';
    if (state.holds > 0) return 'held awake';
    if (state.busy) return 'keys or touch in progress';
    return null;
  }
}
