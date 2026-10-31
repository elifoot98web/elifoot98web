/**
 * The wait before retrying something that keeps failing. Pure, so the schedule is the only thing
 * either caller has to get right.
 */
export class BackoffHelper {

  /**
   * How long to wait after the `failures`-th consecutive failure (1 for the first), or `null`
   * once the schedule has run out: the caller decides whether that means "stop" or "repeat the
   * last entry". Zero or fewer failures is not a failure and has no delay either.
   */
  static delayAfter(schedule: readonly number[], failures: number): number | null {
    if (!Number.isInteger(failures) || failures < 1 || failures > schedule.length) return null;
    return schedule[failures - 1];
  }

  /** Like {@link delayAfter}, but the last entry repeats for ever. Needs a non-empty schedule. */
  static delayRepeating(schedule: readonly number[], failures: number): number {
    return BackoffHelper.delayAfter(schedule, failures) ?? schedule[schedule.length - 1];
  }
}
