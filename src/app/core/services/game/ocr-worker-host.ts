import { BehaviorSubject, Observable } from 'rxjs';
import { distinctUntilChanged } from 'rxjs/operators';
import { BackoffHelper } from '../../helpers/backoff.helper';
import { TimeoutHelper } from '../../helpers/timeout.helper';

/**
 * The part of a tesseract.js `Worker` the app uses. The real one is assignable to it, and a spec
 * can stand in for it without loading a 3.9 MB wasm core.
 */
export interface OcrWorker {
  recognize(image: string): Promise<{ data: { text: string } }>;
  terminate(): Promise<unknown>;
}

export interface OcrWorkerHostOptions {
  /** How long one start may take before it is called failed. */
  timeoutMs: number;
  /** Wait before the 2nd, 3rd... attempt; once it has run out the host gives up. */
  retryBackoffMs: readonly number[];
}

/**
 * Owns the one OCR worker: starts it, notices when it cannot start, retries a bounded number of
 * times, and tells whoever cares whether OCR is available.
 *
 * **It never makes a caller wait.** `createWorker()` can stay pending for ever (with the language
 * file unreachable it does, measured), so the old `await getWorker()` froze the auto-save loop
 * behind a download. Here a caller asks `ready`, gets the worker or `null` at once, and a `null`
 * means "not yet, or not at all" for the caller to decide. The start itself is the one
 * memoised promise: `warmUp()` while an attempt is in flight does nothing, so a tick that races
 * the download cannot start a second worker (the old code leaked one per race).
 *
 * **A failed start cannot be cleaned up, only outlived.** tesseract.js returns the `Worker` only
 * when it is fully initialised, so a start that stalls or rejects leaves a worker thread this
 * code has no handle on. What it can do is make sure that worker does no harm: if it finishes
 * after the deadline it is adopted when nothing better is ready, and terminated when something
 * is. And it bounds the damage by giving up after the schedule has run out, rather than
 * retrying for ever.
 *
 * `stop()` ends everything, including a start still in flight: whatever it eventually produces
 * is terminated, not adopted, because each start remembers the generation it began in.
 *
 * Free of Angular and of tesseract, so it is driven in specs with a fake clock. The timers are
 * created wherever `warmUp()` was first called; the owner calls it outside the Angular zone.
 */
export class OcrWorkerHost {
  private worker: OcrWorker | null = null;
  private attempting = false;
  private failures = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  private readonly unavailableSubject = new BehaviorSubject<boolean>(false);

  /**
   * True from the first failed start until a worker is ready or `stop()` is called. It starts
   * false: not having tried is not the same as having failed.
   */
  readonly unavailable$: Observable<boolean> = this.unavailableSubject.pipe(distinctUntilChanged());

  constructor(
    private readonly factory: () => Promise<OcrWorker>,
    private readonly options: OcrWorkerHostOptions
  ) { }

  /** The worker, or `null` while there is none. Never waits. */
  get ready(): OcrWorker | null {
    return this.worker;
  }

  /**
   * Make sure a start is under way unless there is a worker, a start in flight, a retry already
   * scheduled, or nothing left to retry. Safe to call as often as is convenient.
   */
  warmUp(): void {
    if (this.worker || this.attempting || this.retryTimer !== undefined) return;
    if (this.failures > this.options.retryBackoffMs.length) return;
    this.attempt();
  }

  /**
   * Terminate the worker, cancel any retry and forget the failures, so a later `warmUp()`
   * starts from scratch. A start still in flight is not cancelled (it cannot be) but its result
   * is thrown away when it lands.
   */
  stop(): void {
    this.generation++;
    this.clearRetry();
    const worker = this.worker;
    this.worker = null;
    this.attempting = false;
    this.failures = 0;
    this.unavailableSubject.next(false);
    if (worker) this.discard(worker);
  }

  private attempt(): void {
    const generation = this.generation;
    this.attempting = true;
    // Through a promise so that a factory that throws on the spot fails the attempt like one
    // that rejects, instead of throwing out of warmUp() into the caller.
    const creation = Promise.resolve().then(() => this.factory());

    TimeoutHelper.withTimeout(() => creation, this.options.timeoutMs).then(
      worker => this.adopt(worker, generation),
      error => {
        this.fail(error, generation);
        // A start that merely overran may still land; adopt() decides what becomes of it.
        creation.then(worker => this.adopt(worker, generation), () => undefined);
      }
    );
  }

  private adopt(worker: OcrWorker, generation: number): void {
    if (generation !== this.generation || this.worker) {
      // Stopped meanwhile, or an earlier start that overran its deadline already got there.
      this.discard(worker);
      return;
    }
    this.worker = worker;
    this.attempting = false;
    this.failures = 0;
    this.clearRetry();
    this.unavailableSubject.next(false);
  }

  private fail(error: unknown, generation: number): void {
    // A start from before a stop(), or one that failed after a rival got a worker up, has
    // nothing left to report.
    if (generation !== this.generation || this.worker) return;

    this.attempting = false;
    this.failures++;
    this.unavailableSubject.next(true);

    const delay = BackoffHelper.delayAfter(this.options.retryBackoffMs, this.failures);
    if (delay === null) {
      console.warn('OCR worker could not be started; giving up until auto-save is switched off and on again', error);
      return;
    }
    console.warn(`OCR worker could not be started (attempt ${this.failures}); retrying in ${delay / 1000} s`, error);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.warmUp();
    }, delay);
  }

  private clearRetry(): void {
    if (this.retryTimer === undefined) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }

  /** Terminate a worker nobody will use. A failure to do so is of no interest to anyone. */
  private discard(worker: OcrWorker): void {
    void Promise.resolve().then(() => worker.terminate()).catch(() => undefined);
  }
}
