/**
 * The one door through which code that reads or writes the guest in bulk (a persist, a backup, a
 * scan of its memory) keeps it awake while it does (see EmulatorPowerService). The service
 * registers itself as `globalThis.holdGuestAwake` while it runs, because `saveGameFileSystem()`
 * lives in `game.js` and the update prompt in the main bundle calls it without being able to import
 * the service; everything in TypeScript that is not the service goes through here, so it neither
 * knows nor cares whether the feature is on.
 *
 * Without a service running (the setting is off, the game page is gone, a spec) it does nothing
 * and costs a property read.
 */
export class GuestAccessHelper {
  /**
   * Wake the guest and hold it awake until the returned function is called, which is safe to call
   * more than once. `reason` is for the diagnostics log.
   */
  static hold(reason: string): () => void {
    const hold = typeof globalThis.holdGuestAwake === 'function' ? globalThis.holdGuestAwake : null;
    if (!hold) return () => undefined;
    try {
      return hold(reason);
    } catch (error) {
      // A hold that cannot be taken must never stop the work it was for.
      console.warn('Could not hold the guest awake', error);
      return () => undefined;
    }
  }

  /** `hold`, `work`, release: for the work that is one awaited call. */
  static async whileAwake<T>(reason: string, work: () => PromiseLike<T> | T): Promise<T> {
    const release = GuestAccessHelper.hold(reason);
    try {
      return await work();
    } finally {
      release();
    }
  }
}
