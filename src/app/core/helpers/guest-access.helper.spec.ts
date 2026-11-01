import { GuestAccessHelper } from './guest-access.helper';

describe('GuestAccessHelper', () => {
  afterEach(() => {
    globalThis.holdGuestAwake = undefined;
  });

  describe('hold', () => {
    it('does nothing when no service has registered the door', () => {
      const release = GuestAccessHelper.hold('persist');

      expect(() => release()).not.toThrow();
    });

    it('opens the registered door with the reason, and hands back its release', () => {
      const calls: string[] = [];
      globalThis.holdGuestAwake = reason => {
        calls.push(`hold ${reason}`);
        return () => calls.push('release');
      };

      const release = GuestAccessHelper.hold('persist');
      release();

      expect(calls).toEqual(['hold persist', 'release']);
    });

    it('does not let a door that throws stop the work it was for', () => {
      spyOn(console, 'warn');
      globalThis.holdGuestAwake = () => { throw new Error('service gone'); };

      const release = GuestAccessHelper.hold('persist');

      expect(() => release()).not.toThrow();
      expect(console.warn).toHaveBeenCalled();
    });
  });

  describe('whileAwake', () => {
    it('holds for the length of the work and releases when it succeeds', async () => {
      const calls: string[] = [];
      globalThis.holdGuestAwake = () => { calls.push('hold'); return () => calls.push('release'); };

      const result = await GuestAccessHelper.whileAwake('persist', async () => { calls.push('work'); return 42; });

      expect(result).toBe(42);
      expect(calls).toEqual(['hold', 'work', 'release']);
    });

    it('releases when the work fails, and passes the failure on', async () => {
      const calls: string[] = [];
      globalThis.holdGuestAwake = () => { calls.push('hold'); return () => calls.push('release'); };

      const failure = await GuestAccessHelper.whileAwake('persist', () => Promise.reject(new Error('disk'))).then(() => null, error => error as Error);

      expect(failure?.message).toBe('disk');
      expect(calls).toEqual(['hold', 'release']);
    });

    it('releases when the work throws before it returns a promise', async () => {
      const calls: string[] = [];
      globalThis.holdGuestAwake = () => { calls.push('hold'); return () => calls.push('release'); };

      const failure = await GuestAccessHelper.whileAwake('persist', () => { throw new Error('sync'); }).then(() => null, error => error as Error);

      expect(failure?.message).toBe('sync');
      expect(calls).toEqual(['hold', 'release']);
    });
  });
});
