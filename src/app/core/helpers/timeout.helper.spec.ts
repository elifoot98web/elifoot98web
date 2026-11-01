import { fakeAsync, tick } from '@angular/core/testing';
import { TimeoutError, TimeoutHelper } from './timeout.helper';

/** A promise that settles when the test says so, standing in for work of unknown length. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

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
 * fakeAsync, but without its default of draining whatever timers are left when the body
 * ends. Drained, a deadline timer that was never cleared would pass unnoticed; undrained,
 * fakeAsync fails the spec with "1 timer(s) still in the queue". That makes "the timer is
 * cleared" a property of every spec below rather than of one that names it. Nothing here
 * waits on a real clock.
 */
const strict = (body: () => void) => fakeAsync(body, { flush: false });

describe('TimeoutHelper.withTimeout', () => {

  it('resolves with the work\'s value when it settles first', strict(() => {
    const work = deferred<string>();
    const result = outcome(TimeoutHelper.withTimeout(() => work.promise, 5000));

    tick(1000);
    expect(result.state).toBe('pending');

    work.resolve('saved');
    tick();
    expect(result.state).toBe('resolved');
    expect(result.value).toBe('saved');
  }));

  it('rejects with the work\'s own error, not a timeout, when it fails first', strict(() => {
    const failure = new Error('disk full');
    const work = deferred<void>();
    const result = outcome(TimeoutHelper.withTimeout(() => work.promise, 5000));

    work.reject(failure);
    tick();

    expect(result.state).toBe('rejected');
    expect(result.error).toBe(failure);
  }));

  it('rejects with a TimeoutError carrying the limit once the deadline passes', strict(() => {
    const work = deferred<void>();
    const result = outcome(TimeoutHelper.withTimeout(() => work.promise, 5000));

    tick(4999);
    expect(result.state).toBe('pending');

    tick(1);
    expect(result.state).toBe('rejected');
    expect(result.error).toBeInstanceOf(TimeoutError);
    expect((result.error as TimeoutError).timeoutMs).toBe(5000);
    expect((result.error as TimeoutError).name).toBe('TimeoutError');
  }));

  it('is not a timeout when the work settles on the last tick before the deadline', strict(() => {
    const work = deferred<number>();
    const result = outcome(TimeoutHelper.withTimeout(() => work.promise, 5000));

    tick(4999);
    work.resolve(7);
    tick();

    expect(result.state).toBe('resolved');
    expect(result.value).toBe(7);
  }));

  it('absorbs a rejection that arrives after the deadline', strict(() => {
    const work = deferred<void>();
    const result = outcome(TimeoutHelper.withTimeout(() => work.promise, 5000));

    tick(5000);
    expect(result.state).toBe('rejected');

    // fakeAsync reports an unhandled rejection as a failure, so reaching the end of the
    // spec is the assertion.
    work.reject(new Error('too late'));
    tick();
    expect(result.error).toBeInstanceOf(TimeoutError);
  }));

  it('keeps the first outcome when the work resolves after the deadline', strict(() => {
    const work = deferred<string>();
    const result = outcome(TimeoutHelper.withTimeout(() => work.promise, 5000));

    tick(5000);
    work.resolve('late');
    tick();

    expect(result.state).toBe('rejected');
    expect(result.error).toBeInstanceOf(TimeoutError);
  }));

  it('turns a synchronous throw into a rejection and schedules nothing', strict(() => {
    const failure = new ReferenceError('saveGameFileSystem is not defined');
    const result = outcome(TimeoutHelper.withTimeout(() => { throw failure; }, 5000));

    tick();

    expect(result.state).toBe('rejected');
    expect(result.error).toBe(failure);
  }));

  it('accepts work that returns a plain value', strict(() => {
    const result = outcome(TimeoutHelper.withTimeout(() => 42, 5000));

    tick();

    expect(result.state).toBe('resolved');
    expect(result.value).toBe(42);
  }));

  it('starts the work before it returns', strict(() => {
    let started = false;
    TimeoutHelper.withTimeout(() => { started = true; return Promise.resolve(); }, 5000);

    expect(started).toBe(true);
    tick();
  }));
});
