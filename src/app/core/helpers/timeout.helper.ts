/** Thrown by {@link TimeoutHelper.withTimeout} when the deadline passes before the work settles. */
export class TimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Timed out after ${timeoutMs} ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * A deadline for work that has no deadline of its own: persisting the emulator's disk,
 * starting a worker, anything that can hang rather than fail.
 *
 * Kept free of Angular and of any service so it can be driven with a fake clock.
 */
export class TimeoutHelper {

  /**
   * Resolve or reject exactly as `work` does, unless `timeoutMs` passes first, in which
   * case reject with a {@link TimeoutError}.
   *
   * This stops *waiting*; it cannot stop the work. A timed-out `work` keeps running and
   * whatever it eventually settles with is discarded — a late rejection is absorbed here
   * rather than surfacing as an unhandled one, because the caller already moved on.
   *
   * Takes a function rather than a promise so a synchronous throw from `work` (a missing
   * global, say) is a rejection like any other and the caller needs one `catch`, not two.
   * The function runs synchronously, before this returns.
   *
   * The timer is cleared the moment the race is decided, so a fast success leaves nothing
   * scheduled. `timeoutMs` must fit a 32-bit signed integer (about 24 days): `setTimeout`
   * treats anything larger as zero and would time out at once.
   */
  static async withTimeout<T>(work: () => PromiseLike<T> | T, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new TimeoutError(timeoutMs)), timeoutMs);
    });

    try {
      // A synchronous throw from `work()` lands in this `try`, so it rejects like any other.
      return await Promise.race([work(), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }
}
