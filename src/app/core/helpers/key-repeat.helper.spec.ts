import { fakeAsync, tick } from '@angular/core/testing';
import { DECK } from '../models/constants';
import { KeyRepeatOptions, KeyRepeatScheduler, KeyRepeatStop } from './key-repeat.helper';

const OPTIONS: KeyRepeatOptions = {
  delayMs: DECK.REPEAT_DELAY_MS,
  intervalMs: DECK.REPEAT_INTERVAL_MS,
  maxPending: DECK.REPEAT_MAX_PENDING,
  maxHoldMs: DECK.REPEAT_MAX_HOLD_MS,
};

interface Rig {
  scheduler: KeyRepeatScheduler;
  fired: () => number;
  /** The `repeats` argument of every press, in order. */
  counts: number[];
  stops: Array<{ reason: KeyRepeatStop; fired: number; skipped: number }>;
  /** What the key queue "holds" right now; the spec moves it. */
  queue: { pending: number };
}

/** Timers are zone.js's fake ones: the helper's defaults call the globals, which fakeAsync patches. */
function rig(options: Partial<KeyRepeatOptions> = {}): Rig {
  let count = 0;
  const counts: number[] = [];
  const queue = { pending: 0 };
  const stops: Rig['stops'] = [];
  const scheduler = new KeyRepeatScheduler(
    { ...OPTIONS, ...options },
    { fire: repeats => { count++; counts.push(repeats); }, pending: () => queue.pending },
    undefined,
    (reason, fired, skipped) => stops.push({ reason, fired, skipped }),
  );
  return { scheduler, fired: () => count, counts, stops, queue };
}

describe('KeyRepeatScheduler', () => {

  it('presses once at once, and waits out the delay before repeating', fakeAsync(() => {
    const { scheduler, fired } = rig();

    scheduler.start();
    expect(fired()).toBe(1);

    tick(OPTIONS.delayMs - 1);
    expect(fired()).toBe(1);

    scheduler.stop();
  }));

  it('tells each press how many repeats came before it, so the landing can be told from the rest', fakeAsync(() => {
    const { scheduler, counts } = rig();

    scheduler.start();
    tick(OPTIONS.delayMs + OPTIONS.intervalMs * 2);
    scheduler.stop();

    expect(counts).toEqual([0, 1, 2, 3]);
  }));

  it('starts the count over with the next hold', fakeAsync(() => {
    const { scheduler, counts } = rig();

    scheduler.start();
    tick(OPTIONS.delayMs);
    scheduler.stop();
    scheduler.start();
    scheduler.stop();

    expect(counts).toEqual([0, 1, 0]);
  }));

  it('repeats at the interval once the delay has passed', fakeAsync(() => {
    const { scheduler, fired } = rig();

    scheduler.start();
    tick(OPTIONS.delayMs);
    expect(fired()).toBe(2);

    tick(OPTIONS.intervalMs);
    expect(fired()).toBe(3);

    tick(OPTIONS.intervalMs * 4);
    expect(fired()).toBe(7);

    scheduler.stop();
  }));

  it('stops on release and leaves nothing scheduled', fakeAsync(() => {
    const { scheduler, fired, stops } = rig();

    scheduler.start();
    tick(OPTIONS.delayMs + OPTIONS.intervalMs * 2);
    const before = fired();
    scheduler.stop();

    expect(scheduler.running).toBeFalse();
    // The press itself, then the ticks at the delay, one interval later and two intervals later.
    expect(before).toBe(4);
    expect(stops).toEqual([{ reason: 'release', fired: 3, skipped: 0 }]);
    // Nothing is left to fire and nothing is left on the fake clock, however long it runs.
    tick(OPTIONS.maxHoldMs * 2);
    expect(fired()).toBe(before);
  }, { flush: false }));

  it('does not repeat at all for a tap shorter than the delay', fakeAsync(() => {
    const { scheduler, fired } = rig();

    scheduler.start();
    tick(OPTIONS.delayMs - 50);
    scheduler.stop();
    tick(OPTIONS.maxHoldMs);

    expect(fired()).toBe(1);
  }, { flush: false }));

  it('skips a tick while the key queue is backed up, instead of queueing behind it', fakeAsync(() => {
    const { scheduler, fired, queue, stops } = rig();

    scheduler.start();
    queue.pending = OPTIONS.maxPending;
    tick(OPTIONS.delayMs + OPTIONS.intervalMs * 3);
    expect(fired()).toBe(1);

    queue.pending = 0;
    tick(OPTIONS.intervalMs);
    expect(fired()).toBe(2);

    scheduler.stop();
    expect(stops[0].skipped).toBe(4);
  }));

  it('fires at one task below the limit and skips at the limit', fakeAsync(() => {
    const { scheduler, fired, queue } = rig();
    scheduler.start();

    queue.pending = OPTIONS.maxPending - 1;
    tick(OPTIONS.delayMs);
    expect(fired()).toBe(2);

    queue.pending = OPTIONS.maxPending;
    tick(OPTIONS.intervalMs);
    expect(fired()).toBe(2);

    scheduler.stop();
  }));

  it('ends a hold nobody released, after the limit', fakeAsync(() => {
    const { scheduler, stops } = rig();

    scheduler.start();
    tick(OPTIONS.maxHoldMs);

    expect(scheduler.running).toBeFalse();
    expect(stops.map(stop => stop.reason)).toEqual(['limit']);
  }, { flush: false }));

  it('starting again restarts the hold instead of running two timers', fakeAsync(() => {
    const { scheduler, fired, stops } = rig();

    scheduler.start();
    tick(OPTIONS.delayMs + OPTIONS.intervalMs);
    scheduler.start();
    expect(stops.map(stop => stop.reason)).toEqual(['restart']);
    const before = fired();

    // One repeater, not two: the delay, then two intervals, is three presses and not six.
    tick(OPTIONS.delayMs + OPTIONS.intervalMs * 2);
    expect(fired() - before).toBe(3);

    scheduler.stop();
  }));

  it('is idempotent to stop, before it starts and twice', fakeAsync(() => {
    const { scheduler, stops } = rig();

    scheduler.stop();
    scheduler.start();
    scheduler.stop();
    scheduler.stop();

    expect(stops.length).toBe(1);
  }, { flush: false }));

  it('stops for good when a press throws, and says so to the caller', fakeAsync(() => {
    const scheduler = new KeyRepeatScheduler(OPTIONS, {
      fire: () => { throw new Error('emulator went away'); },
      pending: () => 0,
    });

    expect(() => scheduler.start()).toThrowError('emulator went away');
    expect(scheduler.running).toBeFalse();
    tick(OPTIONS.maxHoldMs);
  }, { flush: false }));

  it('stops when a repeat throws, and does not try again', fakeAsync(() => {
    let calls = 0;
    const scheduler = new KeyRepeatScheduler(OPTIONS, {
      fire: () => { if (++calls === 2) throw new Error('emulator went away'); },
      pending: () => 0,
    });

    scheduler.start();
    expect(() => tick(OPTIONS.delayMs)).toThrowError('emulator went away');
    expect(scheduler.running).toBeFalse();
    tick(OPTIONS.maxHoldMs);
    expect(calls).toBe(2);
  }, { flush: false }));

  it('uses the timers it is handed, so the deck can keep them out of Angular\'s zone', () => {
    const scheduled: number[] = [];
    const cleared: unknown[] = [];
    const scheduler = new KeyRepeatScheduler(OPTIONS, { fire: () => undefined, pending: () => 0 }, {
      setTimeout: (_handler, ms) => { scheduled.push(ms); return scheduled.length; },
      clearTimeout: handle => { cleared.push(handle); },
    });

    scheduler.start();
    scheduler.stop();

    expect(scheduled).toEqual([OPTIONS.maxHoldMs, OPTIONS.delayMs]);
    expect(cleared.length).toBe(2);
  });
});
