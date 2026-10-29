import { NgZone } from '@angular/core';
import { fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { AUTO_SAVER } from '../../models/constants';
import { DosCI } from '../../typings/jsdos';
import { AutoSaverOptions, AutoSaverService } from './auto-saver.service';
import { silentDiagnostics } from '../shared/diagnostics.testing';

const TICK = AUTO_SAVER.DEFAULT_TICK_INTERVAL_MS;
const POLL = AUTO_SAVER.DEFAULT_GAME_SAVING_DETECTED_TIMEOUT_MS;
const [BACKOFF_1, BACKOFF_2, BACKOFF_3] = AUTO_SAVER.RETRY_BACKOFF_MS;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/**
 * A spy implementation that answers with each outcome in turn, the last one for ever. The
 * promises are made when the call happens: a rejection built up front has no handler yet and
 * would be reported as unhandled.
 */
function outcomes(...results: ('ok' | 'fail')[]) {
  let call = 0;
  return () => {
    const result = results[Math.min(call++, results.length - 1)];
    return result === 'fail' ? Promise.reject(new Error('IndexedDB closed')) : Promise.resolve();
  };
}

/**
 * fakeAsync without its default of draining the clock at the end, so that a timer the service
 * leaves behind fails the spec. Every spec ends with stop() for the same reason.
 */
const strict = (body: () => void) => fakeAsync(body, { flush: false });

interface Fixture {
  service: AutoSaverService;
  dosCI: DosCI;
  /**
   * What each look at the screen answers; the last entry repeats. 'unknown' is a look OCR could
   * not read, which the emulator service reports as `null`.
   */
  looks: (boolean | 'unknown' | 'throw' | 'hang')[];
  isGameSaving: jasmine.Spy;
  startOcr: jasmine.Spy;
  stopOcr: jasmine.Spy;
  /** Drive the OCR availability the emulator service would report. */
  ocrUnavailable: BehaviorSubject<boolean>;
  saveGame: jasmine.Spy;
  /** What the auto-saver told the status service about the game's own save, in order. */
  writing: boolean[];
  loader: { present: jasmine.Spy; dismiss: jasmine.Spy };
  createLoader: jasmine.Spy;
  toast: { present: jasmine.Spy };
  createToast: jasmine.Spy;
  /** The order calls reached the fakes in, e.g. ['look:true', 'look:false', 'save']. */
  events: string[];
}

function fixture(diagnostics: unknown = silentDiagnostics()): Fixture {
  const events: string[] = [];
  const looks: Fixture['looks'] = [false];
  let lookIndex = 0;

  const isGameSaving = jasmine.createSpy('isGameSaving').and.callFake(() => {
    const answer = looks[Math.min(lookIndex++, looks.length - 1)];
    events.push(`look:${answer}`);
    if (answer === 'throw') return Promise.reject(new Error('screenshot failed'));
    if (answer === 'hang') return new Promise<boolean>(() => undefined);
    return Promise.resolve(answer === 'unknown' ? null : answer);
  });
  const startOcr = jasmine.createSpy('startOcr');
  const stopOcr = jasmine.createSpy('stopOcr');
  const ocrUnavailable = new BehaviorSubject<boolean>(false);

  const saveGame = jasmine.createSpy('saveGame').and.callFake(() => {
    events.push('save');
    return Promise.resolve();
  });

  const loader = {
    present: jasmine.createSpy('present').and.callFake(() => { events.push('present'); return Promise.resolve(); }),
    dismiss: jasmine.createSpy('dismiss').and.callFake(() => { events.push('dismiss'); return Promise.resolve(); }),
  };
  const createLoader = jasmine.createSpy('loading.create').and.resolveTo(loader);
  const toast = { present: jasmine.createSpy('toast.present').and.resolveTo(undefined) };
  const createToast = jasmine.createSpy('toast.create').and.resolveTo(toast);

  const writing: boolean[] = [];
  const service = new AutoSaverService(
    { saveGame } as never,
    { isGameSaving, startOcr, stopOcr, ocrUnavailable$: ocrUnavailable.asObservable() } as never,
    { create: createLoader } as never,
    { create: createToast } as never,
    new NgZone({ enableLongStackTrace: false }),
    diagnostics as never,
    { setGameWriting: (value: boolean) => writing.push(value) } as never
  );

  return {
    service, dosCI: {} as DosCI, looks, isGameSaving, startOcr, stopOcr, ocrUnavailable,
    saveGame, writing, loader, createLoader, toast, createToast, events,
  };
}

function start(f: Fixture, options?: AutoSaverOptions) {
  f.service.start(f.dosCI, options);
  flushMicrotasks();
}

describe('AutoSaverService', () => {
  let errorLog: jasmine.Spy;

  beforeEach(() => {
    // The loop logs every look; the failures are asserted on through the error spy.
    spyOn(console, 'log');
    spyOn(console, 'warn');
    errorLog = spyOn(console, 'error');
  });

  describe('the loop', () => {
    it('starts OCR, looks at once and then every tick', strict(() => {
      const f = fixture();

      start(f);
      expect(f.startOcr).toHaveBeenCalledTimes(1);
      expect(f.isGameSaving).toHaveBeenCalledTimes(1);

      tick(TICK);
      expect(f.isGameSaving).toHaveBeenCalledTimes(2);
      tick(TICK);
      expect(f.isGameSaving).toHaveBeenCalledTimes(3);

      f.service.stop();
    }));

    it('says whether it is running, which is what keeps the OCR worker alive', strict(() => {
      const f = fixture();
      expect(f.service.running).toBeFalse();

      start(f);
      expect(f.service.running).toBeTrue();

      f.service.stop();
      expect(f.service.running).toBeFalse();
    }));

    it('refuses a second start while it is running', strict(() => {
      const f = fixture();

      start(f);
      start(f);
      tick(TICK);

      expect(f.startOcr).toHaveBeenCalledTimes(1);
      expect(f.isGameSaving).toHaveBeenCalledTimes(2);
      f.service.stop();
    }));

    it('stop ends the loop, stops OCR and leaves nothing on the clock', strict(() => {
      const f = fixture();

      start(f);
      f.service.stop();
      tick(10 * TICK);

      expect(f.isGameSaving).toHaveBeenCalledTimes(1);
      expect(f.stopOcr).toHaveBeenCalledTimes(1);
    }));

    it('can be started again after a stop, with one loop and not two', strict(() => {
      const f = fixture();

      start(f);
      f.service.stop();
      start(f);
      tick(TICK);

      expect(f.isGameSaving).toHaveBeenCalledTimes(3);
      f.service.stop();
    }));
  });

  describe('a tick that throws', () => {
    it('is retried after 5 s, 15 s and 60 s, and then every 60 s', strict(() => {
      const f = fixture();
      f.looks.length = 0;
      f.looks.push('throw');

      start(f);
      expect(f.isGameSaving).toHaveBeenCalledTimes(1);

      tick(BACKOFF_1 - 1);
      expect(f.isGameSaving).toHaveBeenCalledTimes(1);
      tick(1);
      expect(f.isGameSaving).toHaveBeenCalledTimes(2);

      tick(BACKOFF_2);
      expect(f.isGameSaving).toHaveBeenCalledTimes(3);

      tick(BACKOFF_3);
      expect(f.isGameSaving).toHaveBeenCalledTimes(4);

      tick(BACKOFF_3);
      expect(f.isGameSaving).toHaveBeenCalledTimes(5);

      expect(errorLog).toHaveBeenCalledTimes(5);
      f.service.stop();
    }));

    it('is not the end of auto-save: it goes back to the normal pace once a look works', strict(() => {
      const f = fixture();
      f.looks.length = 0;
      f.looks.push('throw', false);

      start(f);
      tick(BACKOFF_1);
      expect(f.isGameSaving).toHaveBeenCalledTimes(2);

      tick(TICK);
      expect(f.isGameSaving).toHaveBeenCalledTimes(3);
      tick(TICK);
      expect(f.isGameSaving).toHaveBeenCalledTimes(4);

      f.service.stop();
    }));

    it('restarts the backoff from 5 s after a success', strict(() => {
      const f = fixture();
      f.looks.length = 0;
      f.looks.push('throw', 'throw', false, 'throw');

      start(f);
      tick(BACKOFF_1);
      tick(BACKOFF_2);
      tick(TICK);
      expect(f.isGameSaving).toHaveBeenCalledTimes(4);

      // The fourth look throws again, and the wait is the first step once more, not the third.
      tick(BACKOFF_1 - 1);
      expect(f.isGameSaving).toHaveBeenCalledTimes(4);
      tick(1);
      expect(f.isGameSaving).toHaveBeenCalledTimes(5);

      f.service.stop();
    }));

    it('is a look that hangs for the heartbeat, and then it is retried like any other failure', strict(() => {
      const f = fixture();
      f.looks.length = 0;
      f.looks.push('hang', false);

      start(f);
      tick(AUTO_SAVER.HEARTBEAT_MS - 1);
      expect(errorLog).not.toHaveBeenCalled();

      tick(1);
      expect(errorLog).toHaveBeenCalledTimes(1);

      tick(BACKOFF_1);
      expect(f.isGameSaving).toHaveBeenCalledTimes(2);

      f.service.stop();
    }));

    it('is not affected by a tick left over from a run that was stopped', strict(() => {
      const f = fixture();
      f.looks.length = 0;
      f.looks.push(true, 'throw');

      // The first run sees the dialog and sleeps in the wait for it to close.
      start(f);
      f.service.stop();
      // The second run fails twice, 5 s apart.
      start(f);
      expect(errorLog).toHaveBeenCalledTimes(1);

      // The first run wakes up, finds it is stale and returns. That must not reset the second
      // run's count of failures: its third look is 15 s after the second, not 5 s.
      tick(POLL);
      tick(BACKOFF_1 - POLL);
      expect(f.isGameSaving).toHaveBeenCalledTimes(3);
      tick(BACKOFF_2 - 1);
      expect(f.isGameSaving).toHaveBeenCalledTimes(3);
      tick(1);
      expect(f.isGameSaving).toHaveBeenCalledTimes(4);

      f.service.stop();
    }));
  });

  describe('the game saves', () => {
    it('persists once, after the dialog is gone and not while it is up', strict(() => {
      const f = fixture();
      f.looks.length = 0;
      f.looks.push(true, true, false);

      start(f);
      expect(f.saveGame).not.toHaveBeenCalled();

      tick(POLL);
      expect(f.saveGame).not.toHaveBeenCalled();
      tick(POLL);

      expect(f.events).toEqual(['look:true', 'look:true', 'look:false', 'present', 'save', 'dismiss']);
      expect(f.saveGame).toHaveBeenCalledTimes(1);

      tick(10 * TICK);
      expect(f.saveGame).toHaveBeenCalledTimes(1);
      f.service.stop();
    }));

    it('tells the status service the game is writing from the moment the dialog is seen until it is gone', strict(() => {
      const f = fixture();
      f.looks.length = 0;
      f.looks.push(true, true, false);

      start(f);
      expect(f.writing).toEqual([true]);

      tick(POLL);
      expect(f.writing).toEqual([true]);

      tick(POLL);
      // False when the dialog is gone, before the persist (which is not the game writing).
      expect(f.writing).toEqual([true, false]);
      expect(f.saveGame).toHaveBeenCalledTimes(1);
      f.service.stop();
    }));

    it('does not claim the game is writing on a look OCR could not read, nor when nothing was seen', strict(() => {
      const f = fixture();
      f.looks.length = 0;
      f.looks.push('unknown', false);

      start(f);
      tick(10 * TICK);

      expect(f.writing.filter(value => value)).toEqual([]);
      f.service.stop();
    }));

    it('takes the claim back when it is stopped mid-save', strict(() => {
      const f = fixture();
      f.looks.length = 0;
      f.looks.push(true);

      start(f);
      expect(f.writing).toEqual([true]);
      f.service.stop();
      tick(POLL);

      expect(f.writing[f.writing.length - 1]).toBeFalse();
      expect(f.saveGame).not.toHaveBeenCalled();
    }));

    it('does not persist when the game did not save', strict(() => {
      const f = fixture();

      start(f);
      tick(10 * TICK);

      expect(f.saveGame).not.toHaveBeenCalled();
      expect(f.createLoader).not.toHaveBeenCalled();
      f.service.stop();
    }));

    it('dismisses the loader when the save fails, and persists again on the next tick', strict(() => {
      const f = fixture();
      f.looks.length = 0;
      f.looks.push(true, false);
      f.saveGame.and.callFake(outcomes('fail', 'ok'));

      start(f);
      tick(POLL);

      expect(f.saveGame).toHaveBeenCalledTimes(1);
      expect(f.loader.dismiss).toHaveBeenCalledTimes(1);
      expect(errorLog).toHaveBeenCalledTimes(1);

      // The dialog is long gone by now; the failed save is still owed.
      tick(BACKOFF_1);
      expect(f.saveGame).toHaveBeenCalledTimes(2);
      expect(f.loader.dismiss).toHaveBeenCalledTimes(2);

      tick(10 * TICK);
      expect(f.saveGame).toHaveBeenCalledTimes(2);
      f.service.stop();
    }));

    it('gives up on a save that keeps failing instead of flashing the loader for ever', strict(() => {
      const f = fixture();
      f.looks.length = 0;
      f.looks.push(true, false);
      f.saveGame.and.callFake(() => Promise.reject(new Error('IndexedDB gone')));

      start(f);
      tick(POLL);
      tick(BACKOFF_1);
      tick(BACKOFF_2);
      tick(BACKOFF_3);
      const attempts = f.saveGame.calls.count();

      tick(10 * BACKOFF_3);
      expect(f.saveGame).toHaveBeenCalledTimes(attempts);
      f.service.stop();
    }));

    it('dismisses the loader even when the save never answers, after the persist deadline', strict(() => {
      const f = fixture();
      f.looks.length = 0;
      f.looks.push(true, false);
      f.saveGame.and.callFake(() => new Promise<void>(() => undefined));

      start(f);
      tick(POLL);
      expect(f.loader.dismiss).not.toHaveBeenCalled();

      tick(AUTO_SAVER.PERSIST_TIMEOUT_MS);
      expect(f.loader.dismiss).toHaveBeenCalledTimes(1);

      f.service.stop();
      tick(AUTO_SAVER.PERSIST_TIMEOUT_MS);
    }));

    it('carries on when the loader never finishes animating (a hidden page)', strict(() => {
      const f = fixture();
      f.looks.length = 0;
      f.looks.push(true, false);
      f.loader.present.and.callFake(() => new Promise<void>(() => undefined));
      f.loader.dismiss.and.callFake(() => new Promise<void>(() => undefined));

      start(f);
      tick(POLL);
      expect(f.saveGame).not.toHaveBeenCalled();

      tick(AUTO_SAVER.OVERLAY_TIMEOUT_MS);
      expect(f.saveGame).toHaveBeenCalledTimes(1);

      // dismiss() gets its own two seconds before the tick moves on.
      tick(AUTO_SAVER.OVERLAY_TIMEOUT_MS);
      f.service.stop();
    }));

    it('keeps waiting through a look that fails, and does not persist mid-save', strict(() => {
      const f = fixture();
      f.looks.length = 0;
      f.looks.push(true, 'throw', true, false);

      start(f);
      tick(POLL);
      expect(f.saveGame).not.toHaveBeenCalled();
      tick(POLL);
      expect(f.saveGame).not.toHaveBeenCalled();
      tick(POLL);

      expect(f.saveGame).toHaveBeenCalledTimes(1);
      expect(f.events.indexOf('save')).toBeGreaterThan(f.events.lastIndexOf('look:true'));
      f.service.stop();
    }));

    it('keeps waiting through a look OCR could not read, and does not persist mid-save', strict(() => {
      const f = fixture();
      f.looks.length = 0;
      f.looks.push(true, 'unknown', 'unknown', true, false);

      start(f);
      tick(3 * POLL);
      expect(f.events).toEqual(['look:true', 'look:unknown', 'look:unknown', 'look:true']);
      expect(f.saveGame).not.toHaveBeenCalled();

      tick(POLL);
      expect(f.saveGame).toHaveBeenCalledTimes(1);
      expect(f.events.indexOf('save')).toBeGreaterThan(f.events.lastIndexOf('look:true'));
      expect(errorLog).not.toHaveBeenCalled();
      f.service.stop();
    }));

    it('persists after the ceiling when OCR never reads the dialog again', strict(() => {
      const f = fixture();
      f.looks.length = 0;
      f.looks.push(true, 'unknown');

      start(f);
      tick(AUTO_SAVER.MAX_WAITING_TIME_FOR_GAME_SAVE_DETECTED - POLL);
      expect(f.saveGame).not.toHaveBeenCalled();

      tick(2 * POLL);
      expect(f.saveGame).toHaveBeenCalledTimes(1);
      f.service.stop();
    }));

    it('takes a first look OCR could not read for no save at all', strict(() => {
      const f = fixture();
      f.looks.length = 0;
      f.looks.push('unknown');

      start(f);
      tick(10 * TICK);

      expect(f.saveGame).not.toHaveBeenCalled();
      expect(f.createLoader).not.toHaveBeenCalled();
      expect(errorLog).not.toHaveBeenCalled();
      f.service.stop();
    }));

    it('does not persist into a VM that was stopped while it waited', strict(() => {
      const f = fixture();
      f.looks.length = 0;
      f.looks.push(true, false);

      start(f);
      f.service.stop();
      tick(10 * POLL);

      expect(f.saveGame).not.toHaveBeenCalled();
      expect(f.createLoader).not.toHaveBeenCalled();
    }));
  });

  describe('hidden pages', () => {
    it('skips the ticks of a hidden page', strict(() => {
      const f = fixture();
      spyOnProperty(document, 'hidden', 'get').and.returnValue(true);

      start(f);
      tick(10 * TICK);

      expect(f.isGameSaving).not.toHaveBeenCalled();
      f.service.stop();
    }));

    it('looks again as soon as the page is visible', strict(() => {
      const f = fixture();
      const hidden = spyOnProperty(document, 'hidden', 'get').and.returnValue(true);

      start(f);
      tick(3 * TICK);
      expect(f.isGameSaving).not.toHaveBeenCalled();

      hidden.and.returnValue(false);
      tick(TICK);
      expect(f.isGameSaving).toHaveBeenCalledTimes(1);
      f.service.stop();
    }));

    it('keeps looking from a hidden page while hosting', strict(() => {
      const f = fixture();
      spyOnProperty(document, 'hidden', 'get').and.returnValue(true);

      start(f, { keepRunningWhileHidden: () => true });
      tick(TICK);

      expect(f.isGameSaving).toHaveBeenCalledTimes(2);
      f.service.stop();
    }));
  });

  describe('the periodic save', () => {
    it('saves on the interval, and a failing save does not stop it', strict(() => {
      const f = fixture();
      f.saveGame.and.callFake(outcomes('fail', 'ok'));

      f.service.startPeriodicSave(1000);
      tick(1000);
      expect(f.saveGame).toHaveBeenCalledTimes(1);
      expect(errorLog).toHaveBeenCalledTimes(1);

      tick(1000);
      tick(1000);
      expect(f.saveGame).toHaveBeenCalledTimes(3);

      f.service.stopPeriodicSave();
      tick(5000);
      expect(f.saveGame).toHaveBeenCalledTimes(3);
    }));

    it('does not start a second flush while one is still running', strict(() => {
      const f = fixture();
      const first = deferred<void>();
      let calls = 0;
      f.saveGame.and.callFake(() => (calls++ === 0 ? first.promise : Promise.resolve()));

      f.service.startPeriodicSave(1000);
      tick(1000);
      tick(1000);
      expect(f.saveGame).toHaveBeenCalledTimes(1);

      first.resolve();
      tick();
      expect(f.saveGame).toHaveBeenCalledTimes(2);

      f.service.stopPeriodicSave();
    }));
  });

  describe('when OCR is unavailable', () => {
    it('forces the periodic save and says so, once', strict(() => {
      const f = fixture();
      start(f);

      f.ocrUnavailable.next(true);
      flushMicrotasks();
      expect(f.createToast).toHaveBeenCalledTimes(1);
      expect(f.createToast.calls.mostRecent().args[0].message).toContain('Salvamento automático indisponível');
      expect(f.createToast.calls.mostRecent().args[0].message).toContain('5 minutos');
      expect(f.toast.present).toHaveBeenCalledTimes(1);

      tick(AUTO_SAVER.DEFAULT_PERIODIC_SAVE_INTERVAL_MS);
      expect(f.saveGame).toHaveBeenCalledTimes(1);

      // Flapping does not repeat the toast.
      f.ocrUnavailable.next(false);
      f.ocrUnavailable.next(true);
      flushMicrotasks();
      expect(f.createToast).toHaveBeenCalledTimes(1);

      f.service.stop();
    }));

    it('stops forcing it when OCR comes back', strict(() => {
      const f = fixture();
      start(f);

      f.ocrUnavailable.next(true);
      f.ocrUnavailable.next(false);
      tick(2 * AUTO_SAVER.DEFAULT_PERIODIC_SAVE_INTERVAL_MS);

      expect(f.saveGame).not.toHaveBeenCalled();
      f.service.stop();
    }));

    it('leaves a periodic save the user asked for alone when OCR comes back', strict(() => {
      const f = fixture();
      start(f);
      f.service.startPeriodicSave(1000);

      f.ocrUnavailable.next(true);
      f.ocrUnavailable.next(false);
      tick(1000);

      expect(f.saveGame).toHaveBeenCalledTimes(1);
      f.service.stopPeriodicSave();
      f.service.stop();
    }));

    it('stops forcing it when auto-save is stopped, and leaves nothing on the clock', strict(() => {
      const f = fixture();
      start(f);

      f.ocrUnavailable.next(true);
      flushMicrotasks();
      f.service.stop();
      tick(2 * AUTO_SAVER.DEFAULT_PERIODIC_SAVE_INTERVAL_MS);

      expect(f.saveGame).not.toHaveBeenCalled();
    }));

    it('ignores OCR news from a run that has ended', strict(() => {
      const f = fixture();
      start(f);
      f.service.stop();

      f.ocrUnavailable.next(true);
      flushMicrotasks();
      tick(2 * AUTO_SAVER.DEFAULT_PERIODIC_SAVE_INTERVAL_MS);

      expect(f.createToast).not.toHaveBeenCalled();
      expect(f.saveGame).not.toHaveBeenCalled();
    }));

    it('is announced again on the next run, because the user switched auto-save back on', strict(() => {
      const f = fixture();
      start(f);
      f.ocrUnavailable.next(true);
      flushMicrotasks();
      f.service.stop();
      f.ocrUnavailable.next(false);

      start(f);
      f.ocrUnavailable.next(true);
      flushMicrotasks();

      expect(f.createToast).toHaveBeenCalledTimes(2);
      f.service.stop();
    }));
  });
  describe('the diagnostics log', () => {
    /** A log that is on; thunks are read at the call, as the real one does. */
    function recorder() {
      const calls: Array<[string, string, Record<string, unknown> | undefined]> = [];
      const diagnostics = {
        enabled: true,
        log: (cat: string, msg: string, data?: unknown) =>
          calls.push([cat, msg, (typeof data === 'function' ? (data as () => unknown)() : data) as Record<string, unknown> | undefined]),
      };
      return { diagnostics, calls, messages: () => calls.map(([, msg]) => msg) };
    }

    it('notes the dialog, the wait for it to go, and the persist that follows, under "save"', strict(() => {
      const { diagnostics, calls, messages } = recorder();
      const f = fixture(diagnostics);
      f.looks.length = 0;
      f.looks.push(true, true, false);

      start(f);
      tick(2 * POLL);

      expect(messages()).toEqual(['auto-save start', 'save dialog seen', 'save dialog gone', 'persist ok']);
      expect(calls.every(([cat]) => cat === 'save')).toBeTrue();
      expect(calls.find(([, msg]) => msg === 'persist ok')?.[2]).toEqual(jasmine.objectContaining({ reason: 'after the game saved' }));
      f.service.stop();
    }));

    it('notes a persist that failed, with why it was asked for', strict(() => {
      const { diagnostics, calls } = recorder();
      const f = fixture(diagnostics);
      f.looks.length = 0;
      f.looks.push(true, false);
      f.saveGame.and.callFake(outcomes('fail', 'ok'));

      start(f);
      tick(POLL);
      tick(BACKOFF_1);

      const persists = calls.filter(([, msg]) => msg.startsWith('persist'));
      expect(persists.map(([, msg]) => msg)).toEqual(['persist failed', 'persist ok']);
      expect(persists[1][2]?.['reason']).toBe('owed from a failed one');
      f.service.stop();
    }));

    it('notes a tick that threw, with the wait before the next', strict(() => {
      const { diagnostics, calls } = recorder();
      const f = fixture(diagnostics);
      f.looks.length = 0;
      f.looks.push('throw', false);

      start(f);

      expect(calls.find(([, msg]) => msg === 'tick failed')?.[2]).toEqual(jasmine.objectContaining({ failures: 1, retryInMs: BACKOFF_1 }));
      f.service.stop();
    }));

    it('notes a hidden page pausing the ticks once, and again when they resume', strict(() => {
      const { diagnostics, messages } = recorder();
      const f = fixture(diagnostics);
      const hidden = spyOnProperty(document, 'hidden', 'get').and.returnValue(true);

      start(f);
      tick(5 * TICK);
      hidden.and.returnValue(false);
      tick(TICK);

      expect(messages().filter(msg => msg.startsWith('ticks '))).toEqual(['ticks paused: page hidden', 'ticks resumed: page visible']);
      f.service.stop();
    }));
  });
});
