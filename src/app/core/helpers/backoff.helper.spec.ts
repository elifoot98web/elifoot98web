import { BackoffHelper } from './backoff.helper';

describe('BackoffHelper', () => {
  const schedule = [5000, 15000, 60000];

  describe('delayAfter', () => {
    it('walks the schedule one failure at a time', () => {
      expect(BackoffHelper.delayAfter(schedule, 1)).toBe(5000);
      expect(BackoffHelper.delayAfter(schedule, 2)).toBe(15000);
      expect(BackoffHelper.delayAfter(schedule, 3)).toBe(60000);
    });

    it('is null once the schedule has run out', () => {
      expect(BackoffHelper.delayAfter(schedule, 4)).toBeNull();
      expect(BackoffHelper.delayAfter(schedule, 400)).toBeNull();
    });

    it('is null for no failure at all, and for a count that is not one', () => {
      expect(BackoffHelper.delayAfter(schedule, 0)).toBeNull();
      expect(BackoffHelper.delayAfter(schedule, -1)).toBeNull();
      expect(BackoffHelper.delayAfter(schedule, 1.5)).toBeNull();
      expect(BackoffHelper.delayAfter(schedule, NaN)).toBeNull();
    });

    it('is null for an empty schedule', () => {
      expect(BackoffHelper.delayAfter([], 1)).toBeNull();
    });
  });

  describe('delayRepeating', () => {
    it('follows the schedule and then repeats its last entry for ever', () => {
      expect(BackoffHelper.delayRepeating(schedule, 1)).toBe(5000);
      expect(BackoffHelper.delayRepeating(schedule, 3)).toBe(60000);
      expect(BackoffHelper.delayRepeating(schedule, 4)).toBe(60000);
      expect(BackoffHelper.delayRepeating(schedule, 1000)).toBe(60000);
    });
  });
});
