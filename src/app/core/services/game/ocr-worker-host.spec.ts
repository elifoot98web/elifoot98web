import { fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { OcrWorker, OcrWorkerHost } from './ocr-worker-host';

const TIMEOUT = 20_000;
const BACKOFF = [5_000, 15_000, 60_000];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function fakeWorker(name: string): OcrWorker & { name: string; terminate: jasmine.Spy } {
  return {
    name,
    recognize: jasmine.createSpy(`${name}.recognize`).and.resolveTo({ data: { text: '' } }),
    terminate: jasmine.createSpy(`${name}.terminate`).and.resolveTo(undefined),
  };
}

/** A factory whose every start is a promise the spec settles by hand, in the order asked. */
function controlledFactory() {
  const starts: ReturnType<typeof deferred<OcrWorker>>[] = [];
  const factory = jasmine.createSpy('createWorker').and.callFake(() => {
    const start = deferred<OcrWorker>();
    starts.push(start);
    return start.promise;
  });
  return { factory, starts };
}

const newHost = (factory: () => Promise<OcrWorker>) =>
  new OcrWorkerHost(factory, { timeoutMs: TIMEOUT, retryBackoffMs: BACKOFF });

/** Ask for a worker and let the microtask that calls the factory run. */
function warmUp(host: OcrWorkerHost) {
  host.warmUp();
  flushMicrotasks();
}

/**
 * fakeAsync without its default of draining what is left on the clock at the end: a timer the
 * host forgot to clear then fails the spec instead of being swept away. See timeout.helper.spec.
 */
const strict = (body: () => void) => fakeAsync(body, { flush: false });

describe('OcrWorkerHost', () => {
  beforeEach(() => {
    // The failure paths log by design; keep the run readable.
    spyOn(console, 'warn');
  });

  describe('starting', () => {
    it('makes one start however often it is asked, and does not wait for it', strict(() => {
      const { factory, starts } = controlledFactory();
      const host = newHost(factory);

      warmUp(host);
      warmUp(host);
      warmUp(host);

      expect(factory).toHaveBeenCalledTimes(1);
      expect(host.ready).toBeNull();

      starts[0].resolve(fakeWorker('a'));
      tick();
      warmUp(host);

      expect(factory).toHaveBeenCalledTimes(1);
    }));

    it('hands out the worker once it is up, and is not unavailable on the way', strict(() => {
      const { factory, starts } = controlledFactory();
      const host = newHost(factory);
      const states: boolean[] = [];
      host.unavailable$.subscribe(state => states.push(state));
      const worker = fakeWorker('a');

      warmUp(host);
      tick(1000);
      expect(host.ready).toBeNull();

      starts[0].resolve(worker);
      tick();

      expect(host.ready).toBe(worker);
      expect(states).toEqual([false]);
    }));

    it('has not tried yet, which is not the same as having failed', strict(() => {
      const host = newHost(controlledFactory().factory);
      const states: boolean[] = [];
      host.unavailable$.subscribe(state => states.push(state));

      expect(host.ready).toBeNull();
      expect(states).toEqual([false]);
    }));
  });

  describe('a start that fails', () => {
    it('is called failed at the deadline and not a moment before', strict(() => {
      const { factory } = controlledFactory();
      const host = newHost(factory);
      const states: boolean[] = [];
      host.unavailable$.subscribe(state => states.push(state));

      warmUp(host);
      tick(TIMEOUT - 1);
      expect(states).toEqual([false]);

      tick(1);
      expect(states).toEqual([false, true]);
      expect(host.ready).toBeNull();

      host.stop();
    }));

    it('is called failed at once when it rejects, and retried after 5 s', strict(() => {
      const { factory, starts } = controlledFactory();
      const host = newHost(factory);
      const states: boolean[] = [];
      host.unavailable$.subscribe(state => states.push(state));

      warmUp(host);
      starts[0].reject(new Error('core unreachable'));
      tick();
      expect(states).toEqual([false, true]);

      tick(4_999);
      expect(factory).toHaveBeenCalledTimes(1);
      tick(1);
      flushMicrotasks();
      expect(factory).toHaveBeenCalledTimes(2);

      host.stop();
      tick(TIMEOUT);
    }));

    it('counts a factory that throws on the spot as a failed start', strict(() => {
      const factory = jasmine.createSpy('createWorker').and.throwError('no Worker here');
      const host = newHost(factory);
      const states: boolean[] = [];
      host.unavailable$.subscribe(state => states.push(state));

      warmUp(host);
      tick();

      expect(states).toEqual([false, true]);
      host.stop();
    }));

    it('retries after 5 s, 15 s and 60 s, then gives up', strict(() => {
      const { factory } = controlledFactory();
      const host = newHost(factory);

      // Attempt 1 starts now and is abandoned at 20 s; the next one waits 5 s after that.
      warmUp(host);
      tick(TIMEOUT);
      tick(5_000);
      flushMicrotasks();
      expect(factory).toHaveBeenCalledTimes(2);

      tick(TIMEOUT);
      tick(15_000);
      flushMicrotasks();
      expect(factory).toHaveBeenCalledTimes(3);

      tick(TIMEOUT);
      tick(60_000);
      flushMicrotasks();
      expect(factory).toHaveBeenCalledTimes(4);

      // The fourth fails too, and there is nothing left to wait for.
      tick(TIMEOUT);
      tick(60 * 60_000);
      flushMicrotasks();
      expect(factory).toHaveBeenCalledTimes(4);

      warmUp(host);
      expect(factory).toHaveBeenCalledTimes(4);
    }));

    it('does not start another while it is waiting out a backoff', strict(() => {
      const { factory } = controlledFactory();
      const host = newHost(factory);

      warmUp(host);
      tick(TIMEOUT);
      warmUp(host);
      tick(2_000);
      warmUp(host);

      expect(factory).toHaveBeenCalledTimes(1);

      host.stop();
    }));

    it('is available again, and starts counting from zero, once a retry works', strict(() => {
      const { factory, starts } = controlledFactory();
      const host = newHost(factory);
      const states: boolean[] = [];
      host.unavailable$.subscribe(state => states.push(state));
      const worker = fakeWorker('a');

      warmUp(host);
      starts[0].reject(new Error('blocked'));
      tick(5_000);
      flushMicrotasks();
      starts[1].resolve(worker);
      tick();

      expect(host.ready).toBe(worker);
      expect(states).toEqual([false, true, false]);
    }));
  });

  describe('a start that lands after its deadline', () => {
    it('is adopted when nothing else is ready, and the retry is called off', strict(() => {
      const { factory, starts } = controlledFactory();
      const host = newHost(factory);
      const states: boolean[] = [];
      host.unavailable$.subscribe(state => states.push(state));
      const late = fakeWorker('late');

      warmUp(host);
      tick(TIMEOUT);
      expect(states).toEqual([false, true]);

      starts[0].resolve(late);
      tick();

      expect(host.ready).toBe(late);
      expect(states).toEqual([false, true, false]);
      expect(late.terminate).not.toHaveBeenCalled();

      tick(60_000);
      flushMicrotasks();
      expect(factory).toHaveBeenCalledTimes(1);
    }));

    it('is terminated when a later start already produced a worker', strict(() => {
      const { factory, starts } = controlledFactory();
      const host = newHost(factory);
      const late = fakeWorker('late');
      const second = fakeWorker('second');

      warmUp(host);
      tick(TIMEOUT);
      tick(5_000);
      flushMicrotasks();
      expect(factory).toHaveBeenCalledTimes(2);

      starts[1].resolve(second);
      tick();
      expect(host.ready).toBe(second);

      starts[0].resolve(late);
      tick();

      expect(host.ready).toBe(second);
      expect(late.terminate).toHaveBeenCalledTimes(1);
      expect(second.terminate).not.toHaveBeenCalled();
    }));

    it('has its eventual rejection absorbed, not left unhandled', strict(() => {
      const { factory, starts } = controlledFactory();
      const host = newHost(factory);

      warmUp(host);
      tick(TIMEOUT);
      starts[0].reject(new Error('too late to matter'));
      tick();

      // Reaching here without an unhandled rejection failing the spec is the assertion.
      expect(host.ready).toBeNull();
      host.stop();
    }));
  });

  describe('stop', () => {
    it('terminates the worker and forgets it', strict(() => {
      const { factory, starts } = controlledFactory();
      const host = newHost(factory);
      const worker = fakeWorker('a');

      warmUp(host);
      starts[0].resolve(worker);
      tick();

      host.stop();
      tick();

      expect(worker.terminate).toHaveBeenCalledTimes(1);
      expect(host.ready).toBeNull();
    }));

    it('cancels a retry that was waiting, so nothing is left on the clock', strict(() => {
      const { factory } = controlledFactory();
      const host = newHost(factory);

      warmUp(host);
      tick(TIMEOUT);
      host.stop();

      // The retry would have fired at 5 s; strict() fails the spec if its timer is still queued.
      tick(60_000);
      flushMicrotasks();
      expect(factory).toHaveBeenCalledTimes(1);
    }));

    it('terminates a start that was in flight when it lands instead of adopting it', strict(() => {
      const { factory, starts } = controlledFactory();
      const host = newHost(factory);
      const states: boolean[] = [];
      host.unavailable$.subscribe(state => states.push(state));
      const orphan = fakeWorker('orphan');

      warmUp(host);
      host.stop();
      starts[0].resolve(orphan);
      tick();

      expect(host.ready).toBeNull();
      expect(orphan.terminate).toHaveBeenCalledTimes(1);
      expect(states).toEqual([false]);
    }));

    it('does not let a stale deadline mark a fresh start as failed', strict(() => {
      const { factory } = controlledFactory();
      const host = newHost(factory);
      const states: boolean[] = [];
      host.unavailable$.subscribe(state => states.push(state));

      warmUp(host);
      tick(10_000);
      host.stop();
      warmUp(host);
      expect(factory).toHaveBeenCalledTimes(2);

      // The first start's deadline passes here; the second has 10 s to go.
      tick(10_000);
      expect(states).toEqual([false]);

      tick(10_000);
      expect(states).toEqual([false, true]);
      host.stop();
    }));

    it('lifts a giving up: the next warm-up starts from scratch', strict(() => {
      const { factory } = controlledFactory();
      const host = newHost(factory);

      warmUp(host);
      for (const wait of [5_000, 15_000, 60_000]) {
        tick(TIMEOUT);
        tick(wait);
        flushMicrotasks();
      }
      tick(TIMEOUT);
      expect(factory).toHaveBeenCalledTimes(4);
      warmUp(host);
      expect(factory).toHaveBeenCalledTimes(4);

      host.stop();
      warmUp(host);
      expect(factory).toHaveBeenCalledTimes(5);

      host.stop();
      tick(TIMEOUT);
    }));

    it('swallows a terminate() that fails', strict(() => {
      const { factory, starts } = controlledFactory();
      const host = newHost(factory);
      const worker = fakeWorker('a');
      worker.terminate.and.rejectWith(new Error('already gone'));

      warmUp(host);
      starts[0].resolve(worker);
      tick();
      host.stop();
      tick();

      expect(worker.terminate).toHaveBeenCalledTimes(1);
    }));
  });
});
