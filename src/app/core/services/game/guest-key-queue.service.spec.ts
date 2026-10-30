import { NgZone } from '@angular/core';
import { fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { EMULATOR_CONTROL_CONFIG } from '../../models/constants';
import { EmulatorKeyCode } from '../../models/game';
import { DosCI } from '../../typings/jsdos';
import { GuestKeyQueueService, KeyQueueError, KeySendResult } from './guest-key-queue.service';
import { silentDiagnostics } from '../shared/diagnostics.testing';
import { silentPower } from './emulator-power.testing';

const K = EmulatorKeyCode;
const GAP = EMULATOR_CONTROL_CONFIG.KEY_PACING_MS;

interface KeyEvent {
  key: number;
  pressed: boolean;
  /** The fake clock when the event left, in ms from the start of the spec. */
  at: number;
}

interface FakeEmulator {
  dosCI: DosCI;
  events: KeyEvent[];
  readMemory: jasmine.Spy;
  /** Keys currently down in the guest, by the events seen so far. */
  held: () => number[];
  /** The BIOS flags byte as the guest would report it. */
  flags: { value: number };
}

interface FakeEmulatorOptions {
  capsLockOn?: boolean;
  /** Throw from sendKeyEvent on the nth call (1-based), once. */
  failOnCall?: number;
  /** Replace readMemory, e.g. with one that rejects or never answers. */
  readMemory?: () => Promise<Uint8Array>;
}

/**
 * A stand-in for js-dos's command interface that records every raw key event with the fake
 * clock. Pressing CapsLock toggles bit 0x40 of the flags byte, as the real guest does.
 */
function fakeEmulator(start: number, options: FakeEmulatorOptions = {}): FakeEmulator {
  const events: KeyEvent[] = [];
  const flags = { value: options.capsLockOn ? EMULATOR_CONTROL_CONFIG.BIOS_CAPS_LOCK_FLAG : 0 };
  let calls = 0;

  const readMemory = jasmine.createSpy('readMemory').and.callFake(
    options.readMemory ?? (async () => Uint8Array.of(flags.value))
  );

  const dosCI = {
    sendKeyEvent: (key: number, pressed: boolean) => {
      calls++;
      if (calls === options.failOnCall) throw new Error('emulator went away');
      events.push({ key, pressed, at: Date.now() - start });
      if (key === K.KBD_capslock && pressed) flags.value ^= EMULATOR_CONTROL_CONFIG.BIOS_CAPS_LOCK_FLAG;
    },
    readMemory,
  } as unknown as DosCI;

  const held = () => {
    const down = new Set<number>();
    for (const event of events) event.pressed ? down.add(event.key) : down.delete(event.key);
    return [...down];
  };

  return { dosCI, events, readMemory, held, flags };
}

const newQueue = () => new GuestKeyQueueService(new NgZone({ enableLongStackTrace: false }), silentDiagnostics(), silentPower());

/** Capture how a promise ended without letting the assertion depend on microtask order. */
function outcome<T>(promise: Promise<T>) {
  const result: { state: 'pending' | 'resolved' | 'rejected'; value?: T; error?: unknown } = { state: 'pending' };
  promise.then(
    value => { result.state = 'resolved'; result.value = value; },
    error => { result.state = 'rejected'; result.error = error; }
  );
  return result;
}

/**
 * fakeAsync, but without its default of draining whatever timers are left when the body ends.
 * Drained, a consumer that never went back to sleep or a deadline that was never cleared would
 * pass unnoticed; undrained, fakeAsync fails the spec with "1 timer(s) still in the queue".
 */
const strict = (body: () => void) => fakeAsync(body, { flush: false });

/** The letters, digits and punctuation that went down, in order: what the guest would have typed. */
const typed = (events: KeyEvent[]) =>
  events
    .filter(e => e.pressed && e.key !== K.KBD_leftshift && e.key !== K.KBD_leftalt)
    .map(e => e.key);

describe('GuestKeyQueueService', () => {

  it('is paced above the 8 ms at which 384 characters were measured to survive', () => {
    // The spacing specs below compare against the constant itself, so on their own they would
    // pass for any value. This is the floor the constant has to stay above.
    expect(EMULATOR_CONTROL_CONFIG.KEY_PACING_MS).toBeGreaterThanOrEqual(8);
  });

  describe('activity$', () => {

    it('announces every submission that is accepted, before a key goes out', strict(() => {
      const emulator = fakeEmulator(Date.now());
      const queue = newQueue();
      const seen: number[] = [];
      queue.activity$.subscribe(() => seen.push(emulator.events.length));

      queue.chord(emulator.dosCI, [K.KBD_a]);
      const afterFirst = emulator.events.length;
      queue.text(emulator.dosCI, 'ab');
      tick(20 * GAP);

      expect(seen.length).toBe(2);
      // The first is announced before its own key leaves; the second while the first is being sent.
      expect(seen[0]).toBe(0);
      expect(seen[1]).toBe(afterFirst);
    }));

    it('says nothing for a submission that is refused or empty', strict(() => {
      const queue = newQueue();
      let announced = 0;
      queue.activity$.subscribe(() => announced++);
      const refused = outcome(queue.chord(null, [K.KBD_a]));
      queue.text(fakeEmulator(Date.now()).dosCI, '');
      flushMicrotasks();

      expect(refused.state).toBe('rejected');
      expect(announced).toBe(0);
    }));
  });

  describe('waking the guest', () => {

    /** `woken` holds, for each wake, how many key events had already left when it happened. */
    function queueWithPower(emulator?: FakeEmulator) {
      const power = silentPower();
      const woken: number[] = [];
      spyOn(power, 'wake').and.callFake(() => { woken.push(emulator?.events.length ?? 0); });
      const queue = new GuestKeyQueueService(new NgZone({ enableLongStackTrace: false }), silentDiagnostics(), power);
      return { queue, woken };
    }

    it('wakes before the first key leaves, in the call that submits it', strict(() => {
      const emulator = fakeEmulator(Date.now());
      const { queue, woken } = queueWithPower(emulator);

      queue.chord(emulator.dosCI, [K.KBD_a]);

      // The submission's wake, then the first task's: neither after a key.
      expect(woken).toEqual([0, 0]);
      expect(emulator.events.length).toBe(1);
      tick(20 * GAP);
    }));

    it('wakes again for every task, so a long text never lets the guest fall asleep under it', strict(() => {
      const emulator = fakeEmulator(Date.now());
      const { queue, woken } = queueWithPower(emulator);

      queue.text(emulator.dosCI, 'abcd');
      tick(100 * GAP);

      // One for the submission, one for each of the four tasks.
      expect(woken.length).toBe(5);
      expect(typed(emulator.events).length).toBe(4);
    }));

    it('does not wake for a submission that is refused or empty: nothing goes to the guest', strict(() => {
      const { queue, woken } = queueWithPower();

      const refused = outcome(queue.chord(null, [K.KBD_a]));
      queue.text(fakeEmulator(Date.now()).dosCI, '');
      flushMicrotasks();

      expect(refused.state).toBe('rejected');
      expect(woken).toEqual([]);
    }));
  });

  describe('one key', () => {

    it('presses, waits a gap, releases, waits a gap, and only then resolves', strict(() => {
      const emulator = fakeEmulator(Date.now());
      const queue = newQueue();
      const result = outcome(queue.chord(emulator.dosCI, [K.KBD_a]));

      tick(0);
      expect(emulator.events).toEqual([{ key: K.KBD_a, pressed: true, at: 0 }]);

      tick(GAP - 1);
      expect(emulator.events.length).toBe(1);

      tick(1);
      expect(emulator.events[1]).toEqual({ key: K.KBD_a, pressed: false, at: GAP });
      expect(result.state).toBe('pending');

      tick(GAP);
      expect(result.state).toBe('resolved');
      expect(result.value).toEqual({ completed: 1, total: 1, cancelled: false });
    }));

    it('presses a chord together, modifier first, and releases it in reverse', strict(() => {
      const emulator = fakeEmulator(Date.now());
      const queue = newQueue();
      queue.chord(emulator.dosCI, [K.KBD_leftshift, K.KBD_a]);

      tick(2 * GAP);
      expect(emulator.events).toEqual([
        { key: K.KBD_leftshift, pressed: true, at: 0 },
        { key: K.KBD_a, pressed: true, at: 0 },
        { key: K.KBD_a, pressed: false, at: GAP },
        { key: K.KBD_leftshift, pressed: false, at: GAP },
      ]);
    }));

    it('types an Alt code as Alt down, the four zero-padded keypad digits, Alt up', strict(() => {
      const emulator = fakeEmulator(Date.now());
      const queue = newQueue();
      const result = outcome(queue.altCode(emulator.dosCI, 227));

      tick(10 * GAP);
      expect(emulator.events.map(e => `${e.key}${e.pressed ? 'v' : '^'}`)).toEqual([
        `${K.KBD_leftalt}v`,
        `${K.KBD_kp0}v`, `${K.KBD_kp0}^`,
        `${K.KBD_kp2}v`, `${K.KBD_kp2}^`,
        `${K.KBD_kp2}v`, `${K.KBD_kp2}^`,
        `${K.KBD_kp7}v`, `${K.KBD_kp7}^`,
        `${K.KBD_leftalt}^`,
      ]);
      expect(result.state).toBe('resolved');
    }));

    it('pads a short Alt code to four digits', strict(() => {
      const emulator = fakeEmulator(Date.now());
      const queue = newQueue();
      queue.altCode(emulator.dosCI, 63);

      tick(10 * GAP);
      const digits = emulator.events.filter(e => e.pressed && e.key >= K.KBD_kp0 && e.key <= K.KBD_kp9).map(e => e.key - K.KBD_kp0);
      expect(digits).toEqual([0, 0, 6, 3]);
    }));
  });

  describe('spacing', () => {

    it('never lets two groups of events closer than the pacing gap, and never bursts past the limit', strict(() => {
      const emulator = fakeEmulator(Date.now());
      const queue = newQueue();
      const result = outcome(queue.text(emulator.dosCI, 'João André Açores, D\'Alessandro (nº 10)!'));

      tick(60 * 1000);
      expect(result.state).toBe('resolved');

      const groups = new Map<number, number>();
      for (const event of emulator.events) groups.set(event.at, (groups.get(event.at) ?? 0) + 1);
      const times = [...groups.keys()].sort((a, b) => a - b);
      expect(times.length).toBeGreaterThan(50);
      for (let i = 1; i < times.length; i++) {
        expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(GAP);
      }
      for (const size of groups.values()) {
        expect(size).toBeLessThanOrEqual(EMULATOR_CONTROL_CONFIG.MAX_SYNC_KEY_EVENTS);
        expect(size).toBeLessThanOrEqual(2); // Shift + a letter is the widest chord this text needs
      }
    }));

    it('leaves nothing held in the guest after a long text', strict(() => {
      const emulator = fakeEmulator(Date.now());
      const queue = newQueue();
      queue.text(emulator.dosCI, 'Ção ÁÉÍ Shift+Alt, ' + 'x'.repeat(40));

      tick(60 * 1000);
      expect(emulator.held()).toEqual([]);
    }));

    it('sends 500 characters at the production pacing, in order, and goes back to sleep', strict(() => {
      const emulator = fakeEmulator(Date.now());
      const queue = newQueue();
      const text = 'abcdefghij'.repeat(50);
      const result = outcome(queue.text(emulator.dosCI, text));

      tick(500 * 2 * GAP);
      expect(result.state).toBe('resolved');
      expect(typed(emulator.events).length).toBe(500);
      expect(typed(emulator.events).slice(0, 10)).toEqual([K.KBD_a, K.KBD_b, K.KBD_c, K.KBD_d, K.KBD_e, K.KBD_f, K.KBD_g, K.KBD_h, K.KBD_i, K.KBD_j]);
      expect(queue.pending).toBe(0);
    }));
  });

  describe('one consumer', () => {

    it('sends submissions in the order they were made, never interleaved', strict(() => {
      const emulator = fakeEmulator(Date.now());
      const queue = newQueue();
      const order: string[] = [];
      queue.text(emulator.dosCI, 'abc').then(() => order.push('text 1'));
      queue.chord(emulator.dosCI, [K.KBD_enter]).then(() => order.push('enter'));
      queue.text(emulator.dosCI, 'xyz').then(() => order.push('text 2'));

      // Submitted mid-send, as a deck key tapped during typing would be.
      tick(GAP * 3);
      queue.chord(emulator.dosCI, [K.KBD_down]).then(() => order.push('down'));

      tick(60 * 1000);
      expect(order).toEqual(['text 1', 'enter', 'text 2', 'down']);
      expect(typed(emulator.events)).toEqual([K.KBD_a, K.KBD_b, K.KBD_c, K.KBD_enter, K.KBD_x, K.KBD_y, K.KBD_z, K.KBD_down]);
    }));

    it('has at most one task\'s keys down at any moment', strict(() => {
      const emulator = fakeEmulator(Date.now());
      const queue = newQueue();
      queue.text(emulator.dosCI, 'Ação');
      queue.chord(emulator.dosCI, [K.KBD_leftshift, K.KBD_tab]);
      queue.text(emulator.dosCI, 'Zé');

      tick(60 * 1000);
      const down = new Set<number>();
      let mostAtOnce = 0;
      for (const event of emulator.events) {
        event.pressed ? down.add(event.key) : down.delete(event.key);
        mostAtOnce = Math.max(mostAtOnce, down.size);
      }
      // An Alt code holds Alt and one keypad digit; a chord holds two keys.
      expect(mostAtOnce).toBeLessThanOrEqual(2);
    }));

    it('reports how many tasks are waiting, the one in flight included', strict(() => {
      const emulator = fakeEmulator(Date.now());
      const queue = newQueue();
      expect(queue.pending).toBe(0);

      queue.chord(emulator.dosCI, [K.KBD_a]);
      queue.chord(emulator.dosCI, [K.KBD_b]);
      queue.chord(emulator.dosCI, [K.KBD_c]);
      expect(queue.pending).toBe(3);

      tick(0);
      expect(queue.pending).toBe(3);
      tick(2 * GAP);
      expect(queue.pending).toBe(2);
      tick(4 * GAP);
      expect(queue.pending).toBe(0);
    }));

    it('starts again after it has gone idle', strict(() => {
      const emulator = fakeEmulator(Date.now());
      const queue = newQueue();
      const first = outcome(queue.chord(emulator.dosCI, [K.KBD_a]));
      tick(2 * GAP);
      expect(first.state).toBe('resolved');

      const second = outcome(queue.chord(emulator.dosCI, [K.KBD_b]));
      tick(2 * GAP);
      expect(second.state).toBe('resolved');
      expect(typed(emulator.events)).toEqual([K.KBD_a, K.KBD_b]);
    }));

    it('takes work submitted from inside a progress callback', strict(() => {
      const emulator = fakeEmulator(Date.now());
      const queue = newQueue();
      let followUp: Promise<KeySendResult> | undefined;
      queue.text(emulator.dosCI, 'a', {
        onProgress: () => { followUp ??= queue.chord(emulator.dosCI, [K.KBD_enter]); },
      });

      tick(60 * 1000);
      expect(typed(emulator.events)).toEqual([K.KBD_a, K.KBD_enter]);
      expect(followUp).toBeDefined();
    }));
  });

  describe('progress', () => {

    it('reports each character the guest has seen in full', strict(() => {
      const emulator = fakeEmulator(Date.now());
      const queue = newQueue();
      const seen: Array<[number, number]> = [];
      queue.text(emulator.dosCI, 'abc', { onProgress: (done, total) => seen.push([done, total]) });

      tick(60 * 1000);
      expect(seen).toEqual([[1, 3], [2, 3], [3, 3]]);
    }));

    it('keeps typing when the progress callback throws', strict(() => {
      const emulator = fakeEmulator(Date.now());
      const queue = newQueue();
      spyOn(console, 'error');
      const result = outcome(queue.text(emulator.dosCI, 'abc', { onProgress: () => { throw new Error('toast is gone'); } }));

      tick(60 * 1000);
      expect(result.state).toBe('resolved');
      expect(typed(emulator.events).length).toBe(3);
    }));

    it('resolves with the number of code points that had to become "?"', strict(() => {
      const emulator = fakeEmulator(Date.now());
      const queue = newQueue();
      const result = outcome(queue.text(emulator.dosCI, 'a€b⚽'));

      tick(60 * 1000);
      expect(result.value).toEqual({ completed: 4, total: 4, cancelled: false, substituted: 2 });
    }));
  });

  describe('cancel', () => {

    it('drops every task that has not started, and the submission resolves as cancelled', strict(() => {
      const emulator = fakeEmulator(Date.now());
      const queue = newQueue();
      const result = outcome(queue.text(emulator.dosCI, 'abcdefghij'));

      // Three characters out, the fourth half way through.
      tick(3 * 2 * GAP + GAP);
      const dropped = queue.cancel();
      expect(dropped).toBe(6);
      expect(result.state).toBe('pending'); // the fourth character is still finishing

      tick(60 * 1000);
      expect(result.state).toBe('resolved');
      expect(result.value).toEqual({ completed: 4, total: 10, cancelled: true, substituted: 0 });
      expect(typed(emulator.events)).toEqual([K.KBD_a, K.KBD_b, K.KBD_c, K.KBD_d]);
      expect(queue.pending).toBe(0);
    }));

    it('finishes the task in flight, so no key is left held', strict(() => {
      const emulator = fakeEmulator(Date.now());
      const queue = newQueue();
      queue.text(emulator.dosCI, 'ãããã');

      tick(3 * GAP); // inside the first Alt code, Alt held
      expect(emulator.held().length).toBeGreaterThan(0);
      queue.cancel();

      tick(60 * 1000);
      expect(emulator.held()).toEqual([]);
      const digits = emulator.events.filter(e => e.pressed && e.key >= K.KBD_kp0 && e.key <= K.KBD_kp9).length;
      expect(digits).toBe(4); // one whole Alt code, not a fragment
    }));

    it('settles a submission that had not started at all', strict(() => {
      const emulator = fakeEmulator(Date.now());
      const queue = newQueue();
      queue.chord(emulator.dosCI, [K.KBD_a]);
      const waiting = outcome(queue.text(emulator.dosCI, 'xyz'));

      tick(GAP);
      queue.cancel();
      flushMicrotasks();
      expect(waiting.state).toBe('resolved'); // without waiting for a timer: nothing of it is in flight
      expect(waiting.value).toEqual({ completed: 0, total: 3, cancelled: true, substituted: 0 });

      tick(60 * 1000);
      expect(typed(emulator.events)).toEqual([K.KBD_a]);
    }));

    it('cancels every submission, not only the one a dialog started', strict(() => {
      const emulator = fakeEmulator(Date.now());
      const queue = newQueue();
      queue.text(emulator.dosCI, 'abc');
      const tap = outcome(queue.chord(emulator.dosCI, [K.KBD_enter]));

      tick(GAP);
      queue.cancel();
      tick(60 * 1000);
      expect(tap.value).toEqual({ completed: 0, total: 1, cancelled: true });
      expect(typed(emulator.events)).toEqual([K.KBD_a]);
    }));

    it('does nothing when there is nothing to cancel', strict(() => {
      expect(newQueue().cancel()).toBe(0);
    }));

    it('lets a new submission through afterwards', strict(() => {
      const emulator = fakeEmulator(Date.now());
      const queue = newQueue();
      queue.text(emulator.dosCI, 'abc');
      tick(GAP);
      queue.cancel();
      const again = outcome(queue.text(emulator.dosCI, 'xy'));

      tick(60 * 1000);
      expect(again.value).toEqual({ completed: 2, total: 2, cancelled: false, substituted: 0 });
      expect(typed(emulator.events)).toEqual([K.KBD_a, K.KBD_x, K.KBD_y]);
    }));
  });

  describe('failure', () => {

    it('rejects visibly when there is no emulator, and never schedules anything', strict(() => {
      spyOn(console, 'error');
      const queue = newQueue();
      const results = [
        outcome(queue.chord(null, [K.KBD_a])),
        outcome(queue.chord(undefined, [K.KBD_a])),
        outcome(queue.altCode(null, 227)),
        outcome(queue.text(undefined, 'abc')),
        outcome(queue.chord({} as unknown as DosCI, [K.KBD_a])),
      ];

      tick(0);
      for (const result of results) {
        expect(result.state).toBe('rejected');
        expect(result.error).toBeInstanceOf(KeyQueueError);
        expect((result.error as KeyQueueError).code).toBe('no-emulator');
        expect((result.error as KeyQueueError).message).toContain('não está pronto');
      }
      expect(console.error).toHaveBeenCalled();
      expect(queue.pending).toBe(0);
    }));

    it('has nothing to fail on for an empty text, with or without an emulator', strict(() => {
      const queue = newQueue();
      const result = outcome(queue.text(null, ''));

      tick(0);
      expect(result.state).toBe('resolved');
      expect(result.value).toEqual({ completed: 0, total: 0, cancelled: false, substituted: 0 });
    }));

    it('refuses tasks that are malformed rather than sending a broken sequence', strict(() => {
      const emulator = fakeEmulator(Date.now());
      const queue = newQueue();
      const tooLong = Array(EMULATOR_CONTROL_CONFIG.MAX_SYNC_KEY_EVENTS + 1).fill(K.KBD_a);
      const results = [
        outcome(queue.chord(emulator.dosCI, [])),
        outcome(queue.chord(emulator.dosCI, tooLong)),
        outcome(queue.chord(emulator.dosCI, [0])),
        outcome(queue.chord(emulator.dosCI, [NaN])),
        outcome(queue.altCode(emulator.dosCI, 0)),
        outcome(queue.altCode(emulator.dosCI, 256)),
        outcome(queue.altCode(emulator.dosCI, 1.5)),
      ];

      tick(0);
      for (const result of results) {
        expect(result.state).toBe('rejected');
        expect((result.error as KeyQueueError).code).toBe('invalid-task');
      }
      expect(emulator.events).toEqual([]);
    }));

    it('accepts a chord as long as the burst limit', strict(() => {
      const emulator = fakeEmulator(Date.now());
      const queue = newQueue();
      const longest = Array.from({ length: EMULATOR_CONTROL_CONFIG.MAX_SYNC_KEY_EVENTS }, (_, i) => K.KBD_a + i);
      const result = outcome(queue.chord(emulator.dosCI, longest));

      tick(2 * GAP);
      expect(result.state).toBe('resolved');
      expect(emulator.events.filter(e => e.at === 0).length).toBe(EMULATOR_CONTROL_CONFIG.MAX_SYNC_KEY_EVENTS);
    }));

    it('rejects the submission whose key the emulator refused, and lets go of what it held', strict(() => {
      spyOn(console, 'error');
      // Call 1 is Alt down; call 2 (the first keypad digit) throws.
      const emulator = fakeEmulator(Date.now(), { failOnCall: 2 });
      const queue = newQueue();
      const result = outcome(queue.altCode(emulator.dosCI, 227));

      tick(60 * 1000);
      expect(result.state).toBe('rejected');
      expect((result.error as KeyQueueError).code).toBe('send-failed');
      expect(emulator.held()).toEqual([]);
    }));

    it('drops the rest of a failed submission but carries on with the others', strict(() => {
      spyOn(console, 'error');
      // Call 3 is the second character's press. The third call is the one that throws.
      const emulator = fakeEmulator(Date.now(), { failOnCall: 3 });
      const queue = newQueue();
      const doomed = outcome(queue.text(emulator.dosCI, 'abcdef'));
      const survivor = outcome(queue.chord(emulator.dosCI, [K.KBD_enter]));

      tick(60 * 1000);
      expect(doomed.state).toBe('rejected');
      expect(survivor.state).toBe('resolved');
      expect(typed(emulator.events)).toEqual([K.KBD_a, K.KBD_enter]);
      expect(queue.pending).toBe(0);
    }));
  });

  describe('faulted', () => {

    const COOLDOWN = EMULATOR_CONTROL_CONFIG.KEY_FAULT_COOLDOWN_MS;

    it('is false until a send fails in the emulator', strict(() => {
      const emulator = fakeEmulator(Date.now());
      const queue = newQueue();
      const seen: boolean[] = [];
      queue.faulted$.subscribe(value => seen.push(value));

      queue.chord(emulator.dosCI, [K.KBD_a]);
      tick(60 * 1000);

      expect(queue.faulted).toBeFalse();
      expect(seen).toEqual([false]);
    }));

    it('is true from the failed send, and says so to whoever is listening', strict(() => {
      spyOn(console, 'error');
      const emulator = fakeEmulator(Date.now(), { failOnCall: 1 });
      const queue = newQueue();
      const seen: boolean[] = [];
      queue.faulted$.subscribe(value => seen.push(value));
      outcome(queue.chord(emulator.dosCI, [K.KBD_a]));

      tick(2 * GAP);

      expect(queue.faulted).toBeTrue();
      expect(seen).toEqual([false, true]);
      tick(COOLDOWN);
    }));

    it('clears by itself after the cooldown, because nothing else can tell the deck the emulator is back', strict(() => {
      spyOn(console, 'error');
      const emulator = fakeEmulator(Date.now(), { failOnCall: 1 });
      const queue = newQueue();
      outcome(queue.chord(emulator.dosCI, [K.KBD_a]));
      tick(2 * GAP);
      expect(queue.faulted).toBeTrue();

      // The cooldown runs from the failed send, which went out at the start of the spec.
      tick(COOLDOWN - 2 * GAP - 1);
      expect(queue.faulted).toBeTrue();
      tick(2);
      expect(queue.faulted).toBeFalse();
    }));

    it('clears at once when a submission goes out whole', strict(() => {
      spyOn(console, 'error');
      const emulator = fakeEmulator(Date.now(), { failOnCall: 1 });
      const queue = newQueue();
      outcome(queue.chord(emulator.dosCI, [K.KBD_a]));
      tick(2 * GAP);
      expect(queue.faulted).toBeTrue();

      queue.chord(emulator.dosCI, [K.KBD_b]);
      tick(4 * GAP);

      expect(queue.faulted).toBeFalse();
    }));

    it('is a fresh cooldown for each failure, not the first one\'s remainder', strict(() => {
      spyOn(console, 'error');
      const emulator = fakeEmulator(Date.now(), { failOnCall: 1 });
      const queue = newQueue();
      outcome(queue.chord(emulator.dosCI, [K.KBD_a]));
      tick(COOLDOWN - GAP);
      expect(queue.faulted).toBeTrue();

      // A second failure just before the first one ends: the clock starts again.
      const broken = fakeEmulator(Date.now(), { failOnCall: 1 });
      outcome(queue.chord(broken.dosCI, [K.KBD_b]));
      tick(4 * GAP);
      expect(queue.faulted).toBeTrue();
      tick(COOLDOWN - 4 * GAP - 1);
      expect(queue.faulted).toBeTrue();
      tick(2);
      expect(queue.faulted).toBeFalse();
    }));

    it('is not a fault when the caller was refused: no emulator, or a malformed task', strict(() => {
      spyOn(console, 'error');
      const queue = newQueue();
      outcome(queue.chord(null, [K.KBD_a]));
      outcome(queue.chord(fakeEmulator(Date.now()).dosCI, []));
      tick(60 * 1000);

      expect(queue.faulted).toBeFalse();
    }));

    it('is not a fault when a submission is cancelled', strict(() => {
      const emulator = fakeEmulator(Date.now());
      const queue = newQueue();
      queue.text(emulator.dosCI, 'abcdef');
      queue.cancel();
      tick(60 * 1000);

      expect(queue.faulted).toBeFalse();
    }));

    it('leaves no timer behind when the service is destroyed in the middle of one', strict(() => {
      spyOn(console, 'error');
      const emulator = fakeEmulator(Date.now(), { failOnCall: 1 });
      const queue = newQueue();
      outcome(queue.chord(emulator.dosCI, [K.KBD_a]));
      tick(2 * GAP);
      expect(queue.faulted).toBeTrue();

      queue.ngOnDestroy();

      expect(queue.faulted).toBeFalse();
    }));
  });

  describe('CapsLock guard', () => {

    const CAPS_ADDRESS = EMULATOR_CONTROL_CONFIG.BIOS_KEYBOARD_FLAGS_ADDRESS;

    it('reads the BIOS flags byte once before a text that types letters', strict(() => {
      const emulator = fakeEmulator(Date.now());
      const queue = newQueue();
      queue.text(emulator.dosCI, 'Zé');

      tick(60 * 1000);
      expect(emulator.readMemory).toHaveBeenCalledTimes(1);
      expect(emulator.readMemory).toHaveBeenCalledWith(CAPS_ADDRESS, 1);
      // Z, then é as Alt+0233.
      expect(typed(emulator.events)).toEqual([K.KBD_z, K.KBD_kp0, K.KBD_kp2, K.KBD_kp3, K.KBD_kp3]);
    }));

    it('does not touch CapsLock when it is already off', strict(() => {
      const emulator = fakeEmulator(Date.now());
      const queue = newQueue();
      queue.text(emulator.dosCI, 'abc');

      tick(60 * 1000);
      expect(emulator.events.some(e => e.key === K.KBD_capslock)).toBe(false);
    }));

    it('taps CapsLock off before typing letters when the guest has it on', strict(() => {
      spyOn(console, 'warn');
      const emulator = fakeEmulator(Date.now(), { capsLockOn: true });
      const queue = newQueue();
      queue.text(emulator.dosCI, 'ab');

      tick(60 * 1000);
      expect(emulator.events.slice(0, 2)).toEqual([
        { key: K.KBD_capslock, pressed: true, at: 0 },
        { key: K.KBD_capslock, pressed: false, at: GAP },
      ]);
      expect(emulator.flags.value & EMULATOR_CONTROL_CONFIG.BIOS_CAPS_LOCK_FLAG).toBe(0);
      expect(typed(emulator.events).filter(key => key !== K.KBD_capslock)).toEqual([K.KBD_a, K.KBD_b]);
      // Once per submission, not once per character.
      expect(emulator.events.filter(e => e.key === K.KBD_capslock && e.pressed).length).toBe(1);
    }));

    it('leaves CapsLock alone for text with no letters in it, and does not even look', strict(() => {
      const emulator = fakeEmulator(Date.now(), { capsLockOn: true });
      const queue = newQueue();
      queue.text(emulator.dosCI, '123 ãç!');

      tick(60 * 1000);
      expect(emulator.readMemory).not.toHaveBeenCalled();
      expect(emulator.events.some(e => e.key === K.KBD_capslock)).toBe(false);
    }));

    it('does not look before a plain key tap', strict(() => {
      const emulator = fakeEmulator(Date.now(), { capsLockOn: true });
      const queue = newQueue();
      queue.chord(emulator.dosCI, [K.KBD_a]);

      tick(60 * 1000);
      expect(emulator.readMemory).not.toHaveBeenCalled();
    }));

    it('types anyway when the read fails', strict(() => {
      spyOn(console, 'warn');
      const emulator = fakeEmulator(Date.now(), { readMemory: () => Promise.reject(new Error('Already performing memory read')) });
      const queue = newQueue();
      const result = outcome(queue.text(emulator.dosCI, 'ab'));

      tick(60 * 1000);
      expect(result.state).toBe('resolved');
      expect(typed(emulator.events)).toEqual([K.KBD_a, K.KBD_b]);
      expect(console.warn).toHaveBeenCalled();
    }));

    it('types anyway when the read never answers, after the deadline', strict(() => {
      spyOn(console, 'warn');
      const emulator = fakeEmulator(Date.now(), { readMemory: () => new Promise<Uint8Array>(() => { /* never settles */ }) });
      const queue = newQueue();
      const result = outcome(queue.text(emulator.dosCI, 'ab'));

      tick(EMULATOR_CONTROL_CONFIG.KEYBOARD_STATE_TIMEOUT_MS - 1);
      expect(emulator.events).toEqual([]);

      tick(60 * 1000);
      expect(result.state).toBe('resolved');
      expect(typed(emulator.events)).toEqual([K.KBD_a, K.KBD_b]);
    }));

    it('types anyway when CapsLock is still on after the tap', strict(() => {
      spyOn(console, 'warn');
      const emulator = fakeEmulator(Date.now(), { readMemory: async () => Uint8Array.of(EMULATOR_CONTROL_CONFIG.BIOS_CAPS_LOCK_FLAG) });
      const queue = newQueue();
      const result = outcome(queue.text(emulator.dosCI, 'a'));

      tick(60 * 1000);
      expect(result.state).toBe('resolved');
      expect(emulator.events.filter(e => e.key === K.KBD_capslock && e.pressed).length).toBe(1); // no tap loop
      expect(typed(emulator.events)).toEqual([K.KBD_capslock, K.KBD_a]);
    }));

    it('skips the first character if cancelled while the guard was reading', strict(() => {
      let answer!: (bytes: Uint8Array) => void;
      const emulator = fakeEmulator(Date.now(), { readMemory: () => new Promise<Uint8Array>(resolve => { answer = resolve; }) });
      const queue = newQueue();
      const result = outcome(queue.text(emulator.dosCI, 'abc'));

      tick(GAP);
      queue.cancel();
      answer(Uint8Array.of(0));
      tick(60 * 1000);

      expect(result.value).toEqual({ completed: 0, total: 3, cancelled: true, substituted: 0 });
      expect(emulator.events).toEqual([]);
    }));
  });
  describe('the diagnostics log', () => {
    type Logged = [category: string, message: string, data: Record<string, number | boolean | string> | undefined];

    /**
     * A log that is on. Like the real one it reads a data thunk at the call, so a value that
     * changes later (the task in flight) is seen as it was; the thunks as they came are kept in
     * `raw` for the spec that checks they are thunks.
     */
    function recorder() {
      const calls: Logged[] = [];
      const raw: unknown[] = [];
      const diagnostics = {
        enabled: true,
        log: (cat: string, msg: string, data?: unknown) => {
          raw.push(data);
          calls.push([cat, msg, (typeof data === 'function' ? (data as () => unknown)() : data) as Logged[2]]);
        },
      };
      const queue = new GuestKeyQueueService(new NgZone({ enableLongStackTrace: false }), diagnostics as never, silentPower());
      const messages = () => calls.map(([, msg]) => msg);
      const dataOf = (msg: string) => calls.find(([, m]) => m === msg)?.[2];
      return { queue, calls, raw, messages, dataOf };
    }

    it('notes a key being queued, started and flushed, all under "key"', strict(() => {
      const emulator = fakeEmulator(Date.now());
      const { queue, calls, messages, dataOf } = recorder();

      queue.chord(emulator.dosCI, [K.KBD_f5]);
      tick(60 * 1000);

      expect(messages()).toEqual(['enqueue', 'start', 'flush']);
      expect(calls.every(([cat]) => cat === 'key')).toBeTrue();
      expect(dataOf('enqueue')).toEqual({ job: 1, tasks: 1, altCodes: 0, depth: 1 });
      expect(dataOf('flush')).toEqual(jasmine.objectContaining({ job: 1, completed: 1, total: 1, cancelled: false }));
    }));

    it('says how long the pacing says the keys should take, so a phone\'s stretch can be read off', strict(() => {
      const emulator = fakeEmulator(Date.now());
      const { queue, calls } = recorder();

      // A chord is two gaps, an Alt code ten.
      queue.chord(emulator.dosCI, [K.KBD_a]);
      queue.altCode(emulator.dosCI, 233);
      tick(60 * 1000);

      const expectedMs = calls.filter(([, msg]) => msg === 'flush').map(([, , data]) => data?.['expectedMs']);
      expect(expectedMs).toEqual([2 * GAP, 10 * GAP]);
    }));

    it('notes a cancel with how much it dropped, and the flush that follows as cancelled', strict(() => {
      const emulator = fakeEmulator(Date.now());
      const { queue, messages, calls } = recorder();
      queue.text(emulator.dosCI, 'abcde');
      tick(0);

      const dropped = queue.cancel();
      tick(60 * 1000);

      expect(dropped).toBeGreaterThan(0);
      expect(calls.find(([, msg]) => msg === 'cancel')?.[2]).toEqual({ dropped, jobs: 1, taskInFlight: true });
      expect(messages()).toContain('flush');
      expect(calls.find(([, msg]) => msg === 'flush')?.[2]?.['cancelled']).toBeTrue();
    }));

    it('notes a send that was refused', strict(() => {
      spyOn(console, 'error');
      const { queue, dataOf } = recorder();

      const refused = outcome(queue.chord(null, [K.KBD_a]));
      tick(0);

      expect(refused.state).toBe('rejected');
      expect(dataOf('refused')).toEqual({ reason: 'no-emulator', tasks: 1 });
    }));

    it('notes a send that failed', strict(() => {
      spyOn(console, 'error');
      const emulator = fakeEmulator(Date.now(), { failOnCall: 1 });
      const { queue, messages } = recorder();

      const result = outcome(queue.chord(emulator.dosCI, [K.KBD_a]));
      tick(60 * 1000);

      expect(result.state).toBe('rejected');
      expect(messages()).toContain('fail');
    }));

    it('hands over data as a function, so a log that is off never builds it', strict(() => {
      const emulator = fakeEmulator(Date.now());
      const { queue, raw } = recorder();

      queue.text(emulator.dosCI, 'ab');
      tick(60 * 1000);

      const withData = raw.filter(data => data !== undefined);
      expect(withData.length).toBeGreaterThan(0);
      expect(withData.every(data => typeof data === 'function')).toBeTrue();
    }));
  });
});
