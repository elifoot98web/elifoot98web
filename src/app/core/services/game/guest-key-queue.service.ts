import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { BehaviorSubject, distinctUntilChanged, Observable, Subject } from 'rxjs';
import { TimeoutHelper } from '../../helpers/timeout.helper';
import { EMULATOR_CONTROL_CONFIG } from '../../models/constants';
import { EmulatorKeyCode, EmulatorKeyCodeHelper, KeyTask } from '../../models/game';
import { DosCI } from '../../typings/jsdos';
import { DiagnosticsService } from '../shared/diagnostics.service';
import { EmulatorPowerService } from './emulator-power.service';

/** How a submission ended when it did not fail. Cancelling is an outcome, not an error. */
export interface KeySendResult {
  /** Tasks the guest saw in full. */
  completed: number;
  total: number;
  /** Some of the submission was dropped by `cancel()` before it was sent. */
  cancelled: boolean;
}

export interface TextSendResult extends KeySendResult {
  /** Code points typed as "?" because the guest has no way to type them. */
  substituted: number;
}

export interface TextSendOptions {
  /** Called after each task the guest has seen in full. */
  onProgress?: (completed: number, total: number) => void;
}

export interface TaskSendOptions extends TextSendOptions {
  /**
   * Read the guest's CapsLock before the first task, and tap it off if it is on. By default that
   * is done for tasks that type letters; a sender that submits keystroke by keystroke (the live
   * type bar) decides for itself how often, because each read is a round trip to the emulator.
   */
  guardCapsLock?: boolean;
}

export type KeyQueueErrorCode =
  /** There is no emulator to send to: the game has not booted, or the caller lost it. */
  | 'no-emulator'
  /** The task itself is malformed. A bug in the caller, never a user's input. */
  | 'invalid-task'
  /** The emulator threw while a task was going out. */
  | 'send-failed';

/**
 * Carries a message meant to be shown as is (it is in Portuguese), so callers can hand it to
 * the generic error dialog.
 */
export class KeyQueueError extends Error {
  constructor(readonly code: KeyQueueErrorCode, message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'KeyQueueError';
  }
}

/** Milliseconds to a tenth, for the diagnostics log. */
const round1 = (ms: number) => Math.round(ms * 10) / 10;

/** The keypad digit keys, indexed by digit. */
const KEYPAD_DIGITS = [
  EmulatorKeyCode.KBD_kp0, EmulatorKeyCode.KBD_kp1, EmulatorKeyCode.KBD_kp2, EmulatorKeyCode.KBD_kp3,
  EmulatorKeyCode.KBD_kp4, EmulatorKeyCode.KBD_kp5, EmulatorKeyCode.KBD_kp6, EmulatorKeyCode.KBD_kp7,
  EmulatorKeyCode.KBD_kp8, EmulatorKeyCode.KBD_kp9,
];

/** A caller's request: one or more tasks that succeed, fail or get cancelled together. */
interface Job {
  /** Only to tell one submission from another in the diagnostics log. */
  id: number;
  dosCI: DosCI;
  total: number;
  completed: number;
  /** Tasks not yet finished, the one in flight included. The job settles when this hits zero. */
  remaining: number;
  /** `cancel()` dropped some of its tasks. */
  cancelled: boolean;
  settled: boolean;
  /** Read the guest's CapsLock before the first task, because the tasks type letters. */
  guardCapsLock: boolean;
  onProgress?: (completed: number, total: number) => void;
  resolve: (result: KeySendResult) => void;
  reject: (error: KeyQueueError) => void;
  // Timings for the diagnostics log (`performance.now()`, ms): when it was queued and when its
  // first task began (0 until then), and how long its tasks took against how long the pacing
  // says they should. The ratio is how much a device stretches the 10 ms gap.
  queuedAt: number;
  startedAt: number;
  sendMs: number;
  expectedMs: number;
  slowestMs: number;
}

interface Entry {
  job: Job;
  task: KeyTask;
}

/**
 * The only thing in the app that sends keys to the guest. Everything that types — a control deck
 * key, the text dialog, the live type bar — submits here, and a single consumer sends them one at a
 * time, so two senders can never overlap.
 *
 * Why it must be the only sender: `dosCI.simulateKeyPress` stamps its release 16 ms in the
 * future, so a second call closer than that loses its key and leaves the guest
 * keyboard dead until a reload (5 of 5 repros), which costs everything since the last save.
 * Nothing here calls it. A task is raw `sendKeyEvent` down and up with
 * `EMULATOR_CONTROL_CONFIG.KEY_PACING_MS` between each group, which cannot wedge and, with a
 * single consumer, cannot overlap.
 *
 * A task is atomic: once its first key is down it is carried through to the release, so
 * neither `cancel()` nor a failure can leave Alt or Shift held in the guest. What `cancel()`
 * drops is every task that has not started.
 *
 * The emulator is passed per call and kept only for the length of its job (the page owns it;
 * see the bridge section of CLAUDE.md). The consumer runs outside Angular's zone: it is a
 * timer firing about every 10 ms for as long as there is text to send, and each firing would
 * otherwise run a change-detection pass over the whole app.
 *
 * A hidden page's timers are throttled (to about one a second on a desktop, usually frozen on
 * a phone), so a send that is backgrounded crawls or pauses and finishes on return. A late
 * timer only ever widens the gap, which is the safe direction.
 *
 * With diagnostics on, each submission is noted in the log (`key`): queued, started, flushed or
 * cancelled or failed. The flush line carries how long the tasks took against how long the
 * pacing says they should, which is the one number the pacing has never had from a phone.
 *
 * Every submission wakes a sleeping guest first, and so does every task (EmulatorPowerService): keys
 * sent to a paused guest are queued, not lost, but they would all land in one burst when it resumed,
 * and DOSBox's keyboard buffer drops what a burst overruns.
 *
 * **It can say it is in trouble.** When the emulator itself throws while a task is going out (its
 * worker is gone), the queue is `faulted` for `KEY_FAULT_COOLDOWN_MS`, or until a submission goes
 * out whole, whichever comes first. The control deck greys its keys meanwhile, so a held arrow
 * does not raise the same error on every tick. A refusal (no emulator yet, a malformed task) is
 * the caller's doing and is not a fault.
 */
@Injectable({
  providedIn: 'root'
})
export class GuestKeyQueueService implements OnDestroy {
  private entries: Entry[] = [];
  private inFlight: Entry | null = null;
  private running = false;
  private lastJobId = 0;
  private readonly activitySubject = new Subject<void>();
  private readonly faultedSubject = new BehaviorSubject<boolean>(false);
  private faultTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Emits once for every submission that is accepted, before any key goes out. It is how the rest
   * of the app learns that something is typing into the guest without anything else being allowed
   * to send (SaveStatusService marks the game as having unsaved input from it, and the live type
   * bar learns that a key it did not send has moved the guest: it is emitted synchronously, inside
   * the call that submits, which is how the bar tells its own sends from the rest). A refused
   * submission is not activity.
   */
  readonly activity$: Observable<void> = this.activitySubject.asObservable();

  /** Whether the last send failed in the emulator, and not yet long enough ago (or well enough since) to try again. */
  readonly faulted$: Observable<boolean> = this.faultedSubject.pipe(distinctUntilChanged());

  constructor(private zone: NgZone, private diagnostics: DiagnosticsService, private power: EmulatorPowerService) { }

  get faulted(): boolean {
    return this.faultedSubject.value;
  }

  ngOnDestroy(): void {
    this.clearFault();
  }

  /** Tasks waiting to go out, the one being sent included. */
  get pending(): number {
    return this.entries.length + (this.inFlight ? 1 : 0);
  }

  /** Press `keys` together (modifiers first), release them in reverse. */
  chord(dosCI: DosCI | null | undefined, keys: readonly EmulatorKeyCode[]): Promise<KeySendResult> {
    return this.submit(dosCI, [{ kind: 'chord', keys: [...keys] }]);
  }

  /** Type one ANSI character as Alt+0nnn on the keypad. `code` is its Windows-1252 value, 1..255. */
  altCode(dosCI: DosCI | null | undefined, code: number): Promise<KeySendResult> {
    return this.submit(dosCI, [{ kind: 'altCode', code }]);
  }

  /**
   * Type a string, with accents, folded punctuation and "?" for what the guest cannot take
   * (see EmulatorKeyCodeHelper). Resolves when the last character is out or `cancel()` stopped
   * it; rejects if the emulator is missing or throws.
   */
  async text(dosCI: DosCI | null | undefined, text: string, options: TextSendOptions = {}): Promise<TextSendResult> {
    const plan = EmulatorKeyCodeHelper.planText(text);
    const result = await this.send(dosCI, plan.tasks, options);
    return { ...result, substituted: plan.substituted };
  }

  /**
   * Send tasks that were planned elsewhere, as ONE submission: they go out in order, behind
   * whatever is already queued, and succeed, fail or get cancelled together. This is how the live
   * type bar sends "N Backspaces and then this text" without a second sender or a second planner.
   */
  send(dosCI: DosCI | null | undefined, tasks: readonly KeyTask[], options: TaskSendOptions = {}): Promise<KeySendResult> {
    return this.submit(dosCI, tasks, {
      guardCapsLock: options.guardCapsLock ?? EmulatorKeyCodeHelper.typesLetters(tasks),
      onProgress: options.onProgress,
    });
  }

  /**
   * Drop every task that has not started and settle the submissions it belonged to as
   * cancelled. The task in flight finishes first, so no key is left held. Returns how many
   * tasks were dropped.
   */
  cancel(): number {
    const dropped = this.entries.splice(0);
    const touched = new Set<Job>();
    for (const { job } of dropped) {
      job.remaining--;
      job.cancelled = true;
      touched.add(job);
    }
    this.diagnostics.log('key', 'cancel', () => ({ dropped: dropped.length, jobs: touched.size, taskInFlight: this.inFlight !== null }));
    // A job whose task is in flight keeps `remaining` above zero, so it settles when that task
    // ends, with the true count of what was sent.
    touched.forEach(job => this.settleIfDone(job));
    return dropped.length;
  }

  private submit(
    dosCI: DosCI | null | undefined,
    tasks: readonly KeyTask[],
    options: { guardCapsLock?: boolean; onProgress?: Job['onProgress'] } = {}
  ): Promise<KeySendResult> {
    // Nothing to send is nothing that can fail, whether or not there is an emulator.
    if (tasks.length === 0) {
      return Promise.resolve({ completed: 0, total: 0, cancelled: false });
    }

    if (!dosCI || typeof dosCI.sendKeyEvent !== 'function') {
      // Fails where the caller can see it. Swallowing this would mean a tap on a button that
      // does nothing and says nothing.
      console.error('Key send refused: there is no emulator to send to.');
      this.diagnostics.log('key', 'refused', () => ({ reason: 'no-emulator', tasks: tasks.length }));
      return Promise.reject(new KeyQueueError('no-emulator', 'O jogo ainda não está pronto para receber teclas.'));
    }

    for (const task of tasks) {
      const problem = this.describeInvalidTask(task);
      if (problem) {
        this.diagnostics.log('key', 'refused', () => ({ reason: 'invalid-task', problem }));
        return Promise.reject(new KeyQueueError('invalid-task', `Tecla inválida: ${problem}.`));
      }
    }

    this.activitySubject.next();
    // Before the first key is queued, not when it goes out: the guest has to be running when the
    // first event lands (see EmulatorPowerService), and the resume takes a moment.
    this.power.wake('keys');
    return new Promise<KeySendResult>((resolve, reject) => {
      const job: Job = {
        id: ++this.lastJobId,
        dosCI,
        total: tasks.length,
        completed: 0,
        remaining: tasks.length,
        cancelled: false,
        settled: false,
        guardCapsLock: options.guardCapsLock ?? false,
        onProgress: options.onProgress,
        resolve,
        reject,
        queuedAt: performance.now(),
        startedAt: 0,
        sendMs: 0,
        expectedMs: 0,
        slowestMs: 0,
      };
      for (const task of tasks) this.entries.push({ job, task });
      this.diagnostics.log('key', 'enqueue', () => ({
        job: job.id,
        tasks: tasks.length,
        altCodes: tasks.filter(task => task.kind === 'altCode').length,
        depth: this.pending,
      }));
      this.start();
    });
  }

  private describeInvalidTask(task: KeyTask): string | null {
    if (task.kind === 'chord') {
      if (task.keys.length === 0) return 'combinação vazia';
      if (task.keys.length > EMULATOR_CONTROL_CONFIG.MAX_SYNC_KEY_EVENTS) return 'combinação longa demais';
      if (task.keys.some(key => !Number.isInteger(key) || key <= 0)) return 'código de tecla desconhecido';
      return null;
    }
    if (task.kind === 'altCode') {
      return Number.isInteger(task.code) && task.code >= 1 && task.code <= 255 ? null : 'código Alt fora de 1 a 255';
    }
    return 'tipo de tarefa desconhecido';
  }

  private start(): void {
    // Set before the first await, so a submission made while the consumer is awake joins its
    // loop instead of starting a second one.
    if (this.running) return;
    this.running = true;
    this.zone.runOutsideAngular(() => { void this.consume(); });
  }

  private async consume(): Promise<void> {
    try {
      // `entries` is re-read on every turn: cancel() and a failing job both replace its
      // contents while this is awaiting a task.
      for (let entry = this.entries.shift(); entry; entry = this.entries.shift()) {
        await this.run(entry);
      }
    } finally {
      // Nothing is awaited between the loop's last shift and here, so a submission can never
      // slip in between "nothing left" and "not running".
      this.running = false;
    }
  }

  private async run(entry: Entry): Promise<void> {
    const { job, task } = entry;
    this.inFlight = entry;
    try {
      if (job.startedAt === 0) {
        job.startedAt = performance.now();
        this.diagnostics.log('key', 'start', () => ({ job: job.id, waitedMs: round1(job.startedAt - job.queuedAt) }));
      }
      if (job.guardCapsLock && job.completed === 0) {
        await this.ensureCapsLockOff(job.dosCI);
      }
      // A cancel that landed while the guard was reading skips the first task as well.
      if (!job.cancelled) {
        // Every task, not only the first: a long text takes seconds, and the guest must not be put
        // to sleep with keys still going out to it. The service also counts keys still queued as a
        // blocker, but that is the net; waking before each task is the rule.
        this.power.wake('keys');
        const began = performance.now();
        await this.perform(job.dosCI, task);
        const took = performance.now() - began;
        job.sendMs += took;
        job.expectedMs += GuestKeyQueueService.pausesIn(task) * EMULATOR_CONTROL_CONFIG.KEY_PACING_MS;
        job.slowestMs = Math.max(job.slowestMs, took);
        job.completed++;
        this.reportProgress(job);
      }
    } catch (error) {
      this.fail(job, error);
    } finally {
      this.inFlight = null;
    }

    if (!job.settled) {
      job.remaining--;
      this.settleIfDone(job);
    }
  }

  /** Send one task, and on any failure let go of whatever it still holds. */
  private async perform(dosCI: DosCI, task: KeyTask): Promise<void> {
    const held: number[] = [];
    const press = (key: number) => { dosCI.sendKeyEvent(key, true); held.push(key); };
    const release = (key: number) => {
      dosCI.sendKeyEvent(key, false);
      const index = held.lastIndexOf(key);
      if (index >= 0) held.splice(index, 1);
    };

    try {
      if (task.kind === 'chord') {
        task.keys.forEach(press);
        await this.pause();
        [...task.keys].reverse().forEach(release);
        await this.pause();
        return;
      }

      press(EmulatorKeyCode.KBD_leftalt);
      await this.pause();
      for (const digit of String(task.code).padStart(4, '0')) {
        const key = KEYPAD_DIGITS[Number(digit)];
        press(key);
        await this.pause();
        release(key);
        await this.pause();
      }
      release(EmulatorKeyCode.KBD_leftalt);
      await this.pause();
    } catch (error) {
      for (const key of held.reverse()) {
        try { dosCI.sendKeyEvent(key, false); } catch { /* the emulator is gone; nothing is held anywhere */ }
      }
      throw error;
    }
  }

  /**
   * Letters come out inverted while the guest's CapsLock is on, and the host cannot see it:
   * a hardware keyboard on a desktop forwards the key to the guest. Reads the BIOS flags
   * byte and taps CapsLock once if it is set.
   *
   * Best effort by design — a guard that can fail typing is worse than the problem it guards
   * against — so a read that fails or times out is logged and the text goes out as it is.
   */
  private async ensureCapsLockOff(dosCI: DosCI): Promise<void> {
    if (typeof dosCI.readMemory !== 'function') return;

    try {
      const began = performance.now();
      const isOn = await this.isCapsLockOn(dosCI);
      this.diagnostics.log('key', 'capslock read', () => ({ on: isOn, ms: round1(performance.now() - began) }));
      if (!isOn) return;

      console.warn('The guest has CapsLock on; switching it off before typing.');
      await this.perform(dosCI, { kind: 'chord', keys: [EmulatorKeyCode.KBD_capslock] });
      if (await this.isCapsLockOn(dosCI)) {
        console.warn('The guest still has CapsLock on; letters will come out inverted.');
      }
    } catch (error) {
      this.diagnostics.log('key', 'capslock read failed', () => ({ error }));
      console.warn('Could not check the guest\'s CapsLock; typing anyway.', error);
    }
  }

  private async isCapsLockOn(dosCI: DosCI): Promise<boolean> {
    const flags = await TimeoutHelper.withTimeout(
      () => dosCI.readMemory(EMULATOR_CONTROL_CONFIG.BIOS_KEYBOARD_FLAGS_ADDRESS, 1),
      EMULATOR_CONTROL_CONFIG.KEYBOARD_STATE_TIMEOUT_MS
    );
    return (flags[0] & EMULATOR_CONTROL_CONFIG.BIOS_CAPS_LOCK_FLAG) !== 0;
  }

  /** How many `pause()`s `perform` makes for a task: the gaps the pacing is multiplied by. */
  private static pausesIn(task: KeyTask): number {
    // A chord: down, gap, up, gap. An Alt code: Alt down, four digits of (down, gap, up, gap), Alt up.
    return task.kind === 'chord' ? 2 : 10;
  }

  private pause(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, EMULATOR_CONTROL_CONFIG.KEY_PACING_MS));
  }

  private reportProgress(job: Job): void {
    try {
      job.onProgress?.(job.completed, job.total);
    } catch (error) {
      // A broken progress display must not stop the typing that it is displaying.
      console.error('Key send progress callback threw', error);
    }
  }

  private settleIfDone(job: Job): void {
    if (job.remaining > 0 || job.settled) return;
    job.settled = true;
    if (job.completed > 0 && !job.cancelled) this.clearFault();
    this.diagnostics.log('key', 'flush', () => ({
      job: job.id,
      completed: job.completed,
      total: job.total,
      cancelled: job.cancelled,
      totalMs: round1(performance.now() - job.queuedAt),
      sendMs: round1(job.sendMs),
      expectedMs: round1(job.expectedMs),
      slowestTaskMs: round1(job.slowestMs),
    }));
    job.resolve({ completed: job.completed, total: job.total, cancelled: job.cancelled });
  }

  /** Rejects the job and drops its queued tasks. Other jobs are untouched. */
  private fail(job: Job, error: unknown): void {
    console.error('Sending keys to the guest failed', error);
    this.diagnostics.log('key', 'fail', () => ({ job: job.id, completed: job.completed, total: job.total, error }));
    this.entries = this.entries.filter(entry => entry.job !== job);
    if (job.settled) return;
    job.settled = true;
    const failure = error instanceof KeyQueueError
      ? error
      : new KeyQueueError('send-failed', 'Não foi possível enviar as teclas para o jogo.', error);
    if (failure.code === 'send-failed') this.markFault();
    job.reject(failure);
  }

  private markFault(): void {
    if (this.faultTimer !== null) clearTimeout(this.faultTimer);
    this.faultedSubject.next(true);
    this.faultTimer = setTimeout(() => this.clearFault(), EMULATOR_CONTROL_CONFIG.KEY_FAULT_COOLDOWN_MS);
  }

  private clearFault(): void {
    if (this.faultTimer !== null) clearTimeout(this.faultTimer);
    this.faultTimer = null;
    this.faultedSubject.next(false);
  }
}
