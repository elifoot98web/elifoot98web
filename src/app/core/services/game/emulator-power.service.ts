import { Injectable, NgZone } from '@angular/core';
import { EMULATOR_POWER } from '../../models/constants';
import { EmulatorPowerHelper, IdlePowerMachine, PowerConfig, PowerState, PowerStep } from '../../helpers/emulator-power.helper';
import { TimeoutHelper } from '../../helpers/timeout.helper';
import { DosCI } from '../../typings/jsdos';
import { DiagnosticsService } from '../shared/diagnostics.service';

/** What the service needs to know about the page it serves; it owns none of it. */
export interface EmulatorPowerOptions {
  /** A room is live. The service is conservative here (v1): a host's guest never sleeps. */
  isHosting: () => boolean;
  /** The boot has seen the game's own screen. Before that the guest is loading, and loading is quiet. */
  gameDetected: () => boolean;
  /**
   * Something is using the guest that the page can see and the service cannot: keys still queued, a
   * finger down. Every one of those also calls `wake()`, so this is the net under a path that forgot.
   */
  isBusy: () => boolean;
  /**
   * Is the game's own "A gravar o jogo…" dialog up: `true`, `false`, or `null` when the look could
   * not tell (no OCR, no auto-save, a failed read). Only `false` lets the guest sleep.
   */
  isGameSaving: () => Promise<boolean | null>;
}

/** What the service has done, for the harness and the specs. Times are the service's own clock, in ms. */
export interface EmulatorPowerStats {
  sleeps: number;
  probes: number;
  wakes: number;
  /** Looks that were asked and did not say "no dialog". */
  looksRefused: number;
  asleepMs: number;
  probingMs: number;
  awakeMs: number;
  /** The longest stretch without a frame that the guest spent awake (see IdlePowerMachine.longestFrameGapMs). */
  longestFrameGapMs: number;
  /** Frames that came from a guest that was asleep: it was working, and the idle time grew (see IdlePowerMachine.frame). */
  stalls: number;
}

/** What js-dos's frame listener reaches: the service of the moment, or nothing. */
interface FrameHook {
  target: EmulatorPowerService | null;
}

/**
 * Lets the emulator sleep while nothing is happening on the screen.
 *
 * DOSBox pins one core at ~100% even on a menu that never changes (measured on Apple silicon:
 * 101.8%, and `pause()` takes it to 1.5%; lowering `cycles` changes nothing), and a manager game
 * is mostly static menus, so on a phone that is the battery and the heat. This is the one place
 * that decides when to call `dosCI.pause()` and `resume()`; the rule itself is
 * {@link IdlePowerMachine}, which owns no timer and no emulator.
 *
 * **Anything that talks to the guest must call `wake()` (or `hold()`) first.** Input sent to a
 * paused guest is not lost (measured: 0 frames while paused, 7 after resume) but it piles up in
 * the worker and is applied in one go on resume, and that is not harmless: the guest sums mouse
 * motion that arrives close together and applies its gain to the sum (the pointer engine's whole
 * pacing exists because of it), and DOSBox's keyboard buffer drops what a burst overruns. Waking
 * first means the guest is already running when the first event lands, and the senders pace
 * themselves against a guest that is. The paths are: the key queue (`submit` and every task), the
 * touch layer (`GuestPointer`, before each send), the page's own capture-phase listeners (a finger,
 * a key, the wheel, a mouse button or a locked mouse), every persist (`hold`, in `SaveGameService`
 * and `PatchService`) and the Cheat 'O Matic (`hold`). The flows that rewrite the saved disk
 * (patches, imports, the resolution switch, a restart, leaving) stop the service with the other
 * safety nets before they start, and `exit()` resumes by itself. A path that was missed degrades to
 * "delayed until the next touch", not to "lost".
 *
 * **What it never does.** It never touches a hidden page (js-dos pauses the emulator when the page
 * hides and resumes it when it shows, and a probe would run it in the background; on return
 * `visible()` puts the machine right), a hosting browser, or a game it has not seen (the boot is
 * quiet for long stretches). It does not lower `cycles`, mute anything or change the stream.
 *
 * **Why a duty-cycle probe and not a hard pause.** `pause()` is a flag, not a counter, and it stops
 * the guest's own clock: work that never redraws (a long computation, a sound) would stand still
 * until a touch. The probe resumes the guest for ~250 ms every ~2.25 s and keeps it awake the moment
 * a frame arrives, so such work still advances, at about a ninth of its speed, for ~14.6% of a core
 * instead of ~1%. The policy is one constant (`EMULATOR_POWER.POLICY`).
 *
 * **Sleeping is a handshake.** After `IDLE_MS` of nothing the service asks the page whether the
 * game's save dialog is up (a screenshot and a cached verdict, ~0.1 ms when the strip has not
 * changed) and sleeps only on a definite "no": a static dialog is exactly what a slow save looks
 * like to a frame counter, and a guest asleep in the middle of a write is the truncated save the
 * auto-saver waits for the dialog to close to avoid. An unreadable look (auto-save off, OCR not
 * loaded) is not a "no", so the feature is inert on those pages. By the same reasoning the probe
 * does not look again when it puts the guest back to sleep: a dialog would have drawn a frame.
 *
 * It keeps the emulator between `start()` and `stop()` like the touch layer does, runs outside
 * Angular's zone (a timer every 250 ms and frame events at the display rate would otherwise cost a
 * change-detection pass each), and logs every state change to the diagnostics log under `power`.
 */
@Injectable({
  providedIn: 'root'
})
export class EmulatorPowerService {
  /** One frame listener per emulator, kept for the length of its life (js-dos cannot remove it). */
  private static readonly hooks = new WeakMap<object, FrameHook>();

  private ci: DosCI | null = null;
  private options: EmulatorPowerOptions | null = null;
  private machine: IdlePowerMachine | null = null;
  private config: PowerConfig = EmulatorPowerService.defaults();
  private timer: ReturnType<typeof setInterval> | undefined;
  /** Moved on by every start() and stop(): a look or a release from an earlier run finds out and does nothing. */
  private run = 0;
  private holds = 0;
  /** What this service registered as `globalThis.holdGuestAwake`, to tell its own from another's when it unregisters. */
  private holder: typeof globalThis.holdGuestAwake;
  /** The books: the state the time since `stateSince` is being spent in. The machine has already moved on when a step is applied. */
  private booked: PowerState = 'awake';
  private stateSince = 0;
  private sleepStartedAt = 0;
  private probesThisSleep = 0;
  private readonly counters: EmulatorPowerStats = { sleeps: 0, probes: 0, wakes: 0, looksRefused: 0, asleepMs: 0, probingMs: 0, awakeMs: 0, longestFrameGapMs: 0, stalls: 0 };
  /** The longest gap of the machines that came before this one (a toggle starts a new machine). */
  private longestBefore = 0;

  /**
   * Milliseconds on a monotonic clock. A spec under `fakeAsync` replaces it with `Date.now`, which
   * zone.js fakes and `performance.now` it does not.
   */
  clock: () => number = () => performance.now();

  constructor(private zone: NgZone, private diagnostics: DiagnosticsService) { }

  /** The defaults, from {@link EMULATOR_POWER}; the harness retunes a live service from here. */
  static defaults(): PowerConfig {
    return {
      idleMs: EMULATOR_POWER.IDLE_MS,
      inputQuietMs: EMULATOR_POWER.INPUT_QUIET_MS,
      sleepMs: EMULATOR_POWER.SLEEP_MS,
      probeMs: EMULATOR_POWER.PROBE_MS,
      policy: EMULATOR_POWER.POLICY,
      lookRetryMs: EMULATOR_POWER.LOOK_RETRY_MS,
      lookRetryMaxMs: EMULATOR_POWER.LOOK_RETRY_MAX_MS,
      maxIdleMs: EMULATOR_POWER.MAX_IDLE_MS,
      slackMs: EMULATOR_POWER.SLACK_MS,
    };
  }

  /** Whether the service is attached to an emulator. A stopped one ignores `wake()` and `hold()`. */
  get running(): boolean {
    return this.machine !== null;
  }

  /** What the machine believes the guest is doing, or `null` when the service is not running. */
  get state(): PowerState | null {
    return this.machine?.state ?? null;
  }

  get stats(): Readonly<EmulatorPowerStats> {
    const live = { ...this.counters };
    if (this.machine) live[EmulatorPowerService.timeKey(this.booked)] += this.clock() - this.stateSince;
    live.longestFrameGapMs = Math.round(Math.max(this.longestBefore, this.machine?.longestFrameGapMs ?? 0));
    return live;
  }

  /**
   * Begin watching an emulator. Idempotent for the same one (the options are refreshed); a
   * different one replaces it.
   */
  start(dosCI: DosCI, options: EmulatorPowerOptions): void {
    if (this.ci === dosCI && this.machine) {
      this.options = options;
      return;
    }
    this.stop();

    this.ci = dosCI;
    this.options = options;
    const now = this.clock();
    this.machine = new IdlePowerMachine(this.config, now);
    this.booked = 'awake';
    this.stateSince = now;
    this.probesThisSleep = 0;
    this.holds = 0;
    const run = ++this.run;

    this.zone.runOutsideAngular(() => {
      this.hookFrames(dosCI);
      // Capture phase on the document, so they run before the touch layer's listener on the
      // emulator's root stops the event; passive, because nothing here cancels anything.
      for (const type of EMULATOR_POWER.INPUT_EVENTS) document.addEventListener(type, this.onInput, { capture: true, passive: true });
      document.addEventListener('pointermove', this.onPointerMove, { capture: true, passive: true });
      document.addEventListener('visibilitychange', this.onVisibilityChange);
      this.timer = setInterval(() => this.tick(run), EMULATOR_POWER.TICK_MS);
    });
    // The door for everything that is not this service: see GuestAccessHelper and game.js.
    globalThis.holdGuestAwake = reason => this.hold(reason);
    this.holder = globalThis.holdGuestAwake;
    this.diagnostics.log('power', 'service started', () => ({ ...this.config }));
  }

  /** Give the guest back (a sleeping one is resumed) and let go of every listener and timer. */
  stop(): void {
    const machine = this.machine;
    const ci = this.ci;
    if (!machine || !ci) return;

    this.longestBefore = Math.max(this.longestBefore, machine.longestFrameGapMs);
    this.apply(machine.settle(this.clock()), 'stopped');
    // The interval the books are in now ends here too, not at the next state change.
    this.counters[EmulatorPowerService.timeKey(this.booked)] += this.clock() - this.stateSince;
    this.stateSince = this.clock();

    clearInterval(this.timer);
    this.timer = undefined;
    for (const type of EMULATOR_POWER.INPUT_EVENTS) document.removeEventListener(type, this.onInput, { capture: true });
    document.removeEventListener('pointermove', this.onPointerMove, { capture: true });
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    const hook = EmulatorPowerService.hooks.get(ci);
    if (hook) hook.target = null;
    // Only if it is still ours: a service started for another emulator has registered its own.
    if (globalThis.holdGuestAwake === this.holder) globalThis.holdGuestAwake = undefined;
    this.holder = undefined;

    this.run++;
    this.holds = 0;
    this.machine = null;
    this.ci = null;
    this.options = null;
    this.diagnostics.log('power', 'service stopped', () => ({ ...this.counters }));
  }

  /**
   * Somebody is about to use the guest: wake it if it sleeps, and start the idle time over. Cheap
   * enough for every key and every pointer event (two assignments when the guest is awake).
   */
  wake(reason = 'wake'): void {
    const machine = this.machine;
    const ci = this.ci;
    if (!machine || !ci) return;
    this.apply(machine.input(this.clock()), reason);
  }

  /**
   * Wake the guest and keep it awake until the returned function is called, for work that talks to
   * it for a while (a persist, a scan of its memory). Several holds stack; releasing is idempotent
   * and restarts the idle time. Without a running service this does nothing and costs nothing.
   */
  hold(reason: string): () => void {
    const machine = this.machine;
    if (!machine) return () => undefined;

    const run = this.run;
    this.holds++;
    this.wake(reason);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      // A release from an earlier run (the service was stopped and started again meanwhile) has
      // nothing to give back: the count it added to was reset with that run.
      if (run !== this.run || !this.machine) return;
      this.holds = Math.max(0, this.holds - 1);
      this.machine.input(this.clock());
    };
  }

  /** Change the rule on a live service (the harness sweeps these), and for the next start. */
  retune(config: Partial<PowerConfig>): void {
    this.config = { ...this.config, ...config };
    this.machine?.configure(config);
  }

  // ------------------------------------------------------------------------------------ events

  /** Registers js-dos's frame listener the first time this emulator is seen, and points it at this service. */
  private hookFrames(dosCI: DosCI): void {
    let hook = EmulatorPowerService.hooks.get(dosCI);
    if (!hook) {
      const created: FrameHook = { target: null };
      EmulatorPowerService.hooks.set(dosCI, created);
      dosCI.events().onFrame(() => created.target?.onFrame());
      hook = created;
    }
    hook.target = this;
  }

  private onFrame(): void {
    const machine = this.machine;
    const ci = this.ci;
    if (!machine || !ci) return;
    // The hot path: a frame while the guest is awake changes nothing else.
    const step = machine.frame(this.clock());
    if (step.state !== step.from || step.command !== 'none') this.apply(step, 'frame');
  }

  private onInput = (): void => {
    this.wake('input');
  };

  /**
   * A mouse that is only hovering sends the guest nothing (the bundle's `autolock` means js-dos
   * forwards a mouse only while it holds the pointer lock), so a move counts as input only with a
   * button down or the pointer locked. A finger is down for the length of its moves.
   */
  private onPointerMove = (event: Event): void => {
    if ((event as PointerEvent).buttons !== 0 || document.pointerLockElement) this.wake('input');
  };

  private onVisibilityChange = (): void => {
    const machine = this.machine;
    if (!machine) return;
    if (document.hidden) {
      this.diagnostics.log('power', 'page hidden: js-dos owns the emulator', () => ({ state: machine.state }));
      return;
    }
    // js-dos resumed the emulator when the page came back, so a guest this machine thought asleep
    // is running.
    this.apply(machine.visible(this.clock()), 'page visible');
  };

  // -------------------------------------------------------------------------------------- rule

  private tick(run: number): void {
    const machine = this.machine;
    if (run !== this.run || !machine || !this.ci) return;
    // js-dos pauses the emulator while the page is hidden and resumes it when it is shown. Neither
    // a pause nor, above all, a probe is ours to add: see visible().
    if (document.hidden) return;

    const now = this.clock();
    const step = machine.tick(now, this.blocker());
    if (step.command === 'look') {
      void this.look(run, now);
    } else {
      this.apply(step);
    }
  }

  /** The reason the guest must not sleep now, or null. A page callback that throws blocks: unknown is not idle. */
  private blocker(): string | null {
    const options = this.options;
    if (!options) return 'stopped';
    try {
      return EmulatorPowerHelper.blocker({
        hosting: options.isHosting(),
        gameDetected: options.gameDetected(),
        holds: this.holds,
        busy: options.isBusy(),
      });
    } catch (error) {
      this.diagnostics.log('power', 'a page callback threw', () => ({ error }));
      return 'page callback failed';
    }
  }

  /** The handshake: ask whether the game's save dialog is up, and let the machine decide. */
  private async look(run: number, askedAt: number): Promise<void> {
    const options = this.options;
    let verdict: boolean | null = null;
    try {
      verdict = options ? await TimeoutHelper.withTimeout(() => options.isGameSaving(), EMULATOR_POWER.LOOK_TIMEOUT_MS) : null;
    } catch (error) {
      this.diagnostics.log('power', 'the look at the save dialog failed', () => ({ error }));
    }

    const machine = this.machine;
    // Not the run that asked, or the page was hidden meanwhile: the answer is about a screen that
    // is no longer this one (and `visible()` has already put the machine right).
    if (run !== this.run || !machine || document.hidden) return;

    const step = machine.answer(this.clock(), verdict, this.blocker());
    if (verdict !== false && step.why !== 'stale answer') {
      this.counters.looksRefused++;
      this.diagnostics.log('power', 'not sleeping', () => ({ why: step.why, idleForMs: Math.round(this.clock() - askedAt) }));
    }
    this.apply(step);
  }

  /**
   * Carry out a step: tell the emulator, keep the books, write a change of state down. Every step
   * of the machine passes through here, including the ones with no command (a frame in a probe
   * wakes the guest without a word to the emulator).
   */
  private apply(step: PowerStep, reason?: string): void {
    const ci = this.ci;
    if (!ci) return;

    // While the page is hidden js-dos holds the emulator paused and will resume it itself, and
    // nothing here may undo that. The machine is put right by visible().
    if ((step.command === 'pause' || step.command === 'resume') && !document.hidden) {
      try {
        if (step.command === 'pause') ci.pause();
        else ci.resume();
      } catch (error) {
        // An emulator that cannot be paused or resumed is gone; the page will find out the usual way.
        this.diagnostics.log('power', `${step.command} failed`, () => ({ error }));
      }
    }

    if (step.grewTo !== undefined) this.learned(step.grewTo);
    if (step.state !== this.booked) this.transition(step, reason);
  }

  /**
   * The machine grew the idle time because a frame came from a guest it had put to sleep. Keep the
   * new time for the machines that follow (a toggle starts a new one), and say so.
   */
  private learned(idleMs: number): void {
    this.counters.stalls++;
    this.config = { ...this.config, idleMs, inputQuietMs: Math.max(this.config.inputQuietMs, idleMs) };
    this.diagnostics.log('power', 'stall: the guest was working while asleep; idle time raised', () => ({ idleMs, asleepForMs: Math.round(this.clock() - this.sleepStartedAt) }));
  }

  private transition(step: PowerStep, reason: string | undefined): void {
    const now = this.clock();
    this.counters[EmulatorPowerService.timeKey(this.booked)] += now - this.stateSince;
    this.booked = step.state;
    this.stateSince = now;

    if (step.state === 'asleep') {
      if (step.from === 'awake') {
        this.counters.sleeps++;
        this.sleepStartedAt = now;
        this.probesThisSleep = 0;
        this.diagnostics.log('power', 'asleep', () => ({ why: step.why, longestAwakeGapMs: Math.round(this.machine?.longestFrameGapMs ?? 0) }));
      } else if (this.probesThisSleep === 1) {
        // Only the first probe of a sleep is written down (this line and 'probe'): a still screen probes
        // every 2.25 s for as long as it lasts, ~530 lines in ten minutes, and each one makes the
        // diagnostics tail rewrite itself to IndexedDB and pushes the boot and 'asleep' lines out of
        // the ring. The count is in 'awake' and in 'service stopped'.
        this.diagnostics.log('power', 'asleep again', () => ({ probes: this.probesThisSleep }));
      }
    } else if (step.state === 'probing') {
      this.counters.probes++;
      this.probesThisSleep++;
      if (this.probesThisSleep === 1) this.diagnostics.log('power', 'probe', () => ({ n: this.probesThisSleep }));
    } else {
      this.counters.wakes++;
      const probes = this.probesThisSleep;
      this.probesThisSleep = 0;
      this.diagnostics.log('power', 'awake', () => ({
        // What woke it: the input's own name when it was one, otherwise the machine's reason.
        why: reason && step.why === 'input' ? reason : step.why,
        asleepForMs: Math.round(now - this.sleepStartedAt),
        probes,
      }));
    }
  }

  private static timeKey(state: PowerState): 'asleepMs' | 'probingMs' | 'awakeMs' {
    return state === 'asleep' ? 'asleepMs' : state === 'probing' ? 'probingMs' : 'awakeMs';
  }
}
