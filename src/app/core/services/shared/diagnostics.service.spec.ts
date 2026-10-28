import { NgZone } from '@angular/core';
import { fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { DIAGNOSTICS, STORAGE_KEY } from '../../models/constants';
import { DiagnosticsTail } from '../../helpers/diagnostics-log.helper';
import { DiagnosticsService } from './diagnostics.service';
import { LocalStorageService } from './local-storage.service';
import { memoryStorage } from './diagnostics.testing';

type Storage = ReturnType<typeof memoryStorage>;

const build = (storage: Storage = memoryStorage()) =>
  new DiagnosticsService(new NgZone({ enableLongStackTrace: false }), storage as unknown as LocalStorageService);

/** Stop the service's window listeners and its timer, whatever state a spec left it in. */
const finish = (service: DiagnosticsService) => {
  void service.disable({ persist: false });
  flushMicrotasks();
};

/** The two browser stores the service touches outside Ionic Storage; every spec starts and ends without them. */
const wipeBrowserStores = () => {
  localStorage.removeItem(STORAGE_KEY.DIAGNOSTICS_LOG);
  sessionStorage.removeItem(DIAGNOSTICS.SESSION_KEY);
};

describe('DiagnosticsService', () => {
  let spare: DiagnosticsService[];

  beforeEach(() => {
    spare = [];
    wipeBrowserStores();
    spyOn(console, 'warn');
  });

  afterEach(async () => {
    for (const service of spare) await service.disable({ persist: false });
    wipeBrowserStores();
  });

  /** A service the afterEach will switch off, so a failing spec cannot leave listeners on the karma window. */
  const make = (storage?: Storage) => {
    const service = build(storage);
    spare.push(service);
    return service;
  };

  describe('while it is off, which is the default', () => {

    it('is off, empty, and not recording', fakeAsync(() => {
      const service = build();
      flushMicrotasks();

      expect(service.enabled).toBeFalse();
      expect(service.entries).toEqual([]);
      expect(service.entryCount).toBe(0);
      expect(service.sessionOnly).toBeFalse();
    }));

    it('never runs a data thunk', fakeAsync(() => {
      const service = build();
      const thunk = jasmine.createSpy('thunk').and.returnValue({ heavy: true });

      service.log('key', 'enqueue', thunk);
      service.log('pointer', 'move', thunk);

      expect(thunk).not.toHaveBeenCalled();
      expect(service.entryCount).toBe(0);
    }));

    it('has no listeners on the window and nothing on the clock', fakeAsync(() => {
      const adds = spyOn(window, 'addEventListener').and.callThrough();
      const docAdds = spyOn(document, 'addEventListener').and.callThrough();

      const service = build();
      flushMicrotasks();
      service.log('page', 'x');

      expect(adds).not.toHaveBeenCalled();
      expect(docAdds).not.toHaveBeenCalled();
      // fakeAsync fails the spec at the end if a timer is still scheduled.
    }));

    it('is a no-op even for a thunk that would throw', () => {
      const service = make();

      expect(() => service.log('error', 'x', () => { throw new Error('never run'); })).not.toThrow();
    });
  });

  describe('turned on', () => {

    it('records an entry with both clocks, the category, the message and the data', async () => {
      const service = make();
      await service.enable({ persist: false });
      const before = service.entryCount;

      service.log('key', 'enqueue', { job: 1, tasks: 3 });

      const entry = service.entries[before];
      expect(entry.cat).toBe('key');
      expect(entry.msg).toBe('enqueue');
      expect(entry.data).toBe('{"job":1,"tasks":3}');
      expect(entry.t).toBeGreaterThan(0);
      expect(Math.abs(entry.w - Date.now())).toBeLessThan(5000);
    });

    it('runs a data thunk exactly once, at the call', async () => {
      const service = make();
      await service.enable({ persist: false });
      const thunk = jasmine.createSpy('thunk').and.returnValue({ ms: 4 });

      service.log('save', 'persist ok', thunk);

      expect(thunk).toHaveBeenCalledTimes(1);
      expect(service.entries[service.entryCount - 1].data).toBe('{"ms":4}');
    });

    it('records an entry without data as just that', async () => {
      const service = make();
      await service.enable({ persist: false });

      service.log('page', 'resume');

      const entry = service.entries[service.entryCount - 1];
      expect(entry.data).toBeUndefined();
      expect('data' in entry).toBeFalse();
    });

    it('truncates data and message to their limits', async () => {
      const service = make();
      await service.enable({ persist: false });

      service.log('ocr', 'm'.repeat(1000), 'd'.repeat(10000));

      const entry = service.entries[service.entryCount - 1];
      expect(entry.msg.length).toBeLessThanOrEqual(DIAGNOSTICS.MESSAGE_MAX_CHARS);
      expect(entry.data?.length).toBeLessThanOrEqual(DIAGNOSTICS.DATA_MAX_CHARS);
    });

    it('survives a thunk that throws, and says so in the entry', async () => {
      const service = make();
      await service.enable({ persist: false });

      expect(() => service.log('key', 'x', () => { throw new RangeError('bad'); })).not.toThrow();

      expect(service.entries[service.entryCount - 1].data).toBe('[data threw RangeError: bad]');
    });

    it('survives data that is circular', async () => {
      const service = make();
      await service.enable({ persist: false });
      const loop: Record<string, unknown> = {};
      loop['me'] = loop;

      expect(() => service.log('key', 'x', loop)).not.toThrow();
    });

    it('stays bounded at its capacity, keeping the newest', async () => {
      const service = make();
      await service.enable({ persist: false });

      for (let n = 0; n < DIAGNOSTICS.CAPACITY + 50; n++) service.log('frame', `f${n}`);

      expect(service.entryCount).toBe(DIAGNOSTICS.CAPACITY);
      expect(service.entries[service.entryCount - 1].msg).toBe(`f${DIAGNOSTICS.CAPACITY + 49}`);
      expect(service.dropped).toBeGreaterThanOrEqual(50);
    });

    it('notes that it was switched on, and why', async () => {
      const service = make();
      await service.enable({ persist: false });

      expect(service.entries[0]).toEqual(jasmine.objectContaining({ cat: 'page', msg: 'diagnostics on', data: '{"reason":"url"}' }));
    });
  });

  describe('window capture', () => {

    it('records a page lifecycle event while on, and stops when off', async () => {
      const service = make();
      await service.enable({ persist: false });

      window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }));
      const during = service.entries.filter(e => e.msg === 'pageshow').length;
      await service.disable({ persist: false });
      window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }));

      expect(during).toBe(1);
      expect(service.entries.filter(e => e.msg === 'pageshow').length).toBe(1);
    });

    it('does not install a second set of listeners when switched on twice', async () => {
      const service = make();
      await service.enable({ persist: false });
      await service.enable({ persist: false });

      window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }));

      expect(service.entries.filter(e => e.msg === 'pageshow').length).toBe(1);
    });
  });

  describe('the choice', () => {

    it('is remembered when the person turns it on', async () => {
      const storage = memoryStorage();
      const service = make(storage);

      await service.enable();

      expect(storage.values.get(STORAGE_KEY.DIAGNOSTICS)).toBeTrue();
      expect(service.sessionOnly).toBeFalse();
    });

    it('is not remembered when it is the address that turned it on', async () => {
      const storage = memoryStorage();
      const service = make(storage);

      await service.enable({ persist: false });

      expect(storage.values.has(STORAGE_KEY.DIAGNOSTICS)).toBeFalse();
      expect(service.sessionOnly).toBeTrue();
    });

    it('comes back on when the stored choice says so', fakeAsync(() => {
      const service = build(memoryStorage({ [STORAGE_KEY.DIAGNOSTICS]: true }));
      spare.push(service);

      expect(service.enabled).toBeFalse();
      flushMicrotasks();

      expect(service.enabled).toBeTrue();
      expect(service.sessionOnly).toBeFalse();
      finish(service);
    }));

    it('stays off when the stored choice is off or absent', fakeAsync(() => {
      expect(build(memoryStorage({ [STORAGE_KEY.DIAGNOSTICS]: false })).enabled).toBeFalse();
      expect(build(memoryStorage()).enabled).toBeFalse();
      flushMicrotasks();
    }));

    it('does not let a late read of the stored choice undo what the person already chose', fakeAsync(() => {
      const service = build(memoryStorage({ [STORAGE_KEY.DIAGNOSTICS]: true }));
      spare.push(service);

      void service.disable({ persist: false });
      flushMicrotasks();

      expect(service.enabled).toBeFalse();
    }));

    it('forgets the choice and the stored tail when switched off', async () => {
      const storage = memoryStorage({ [STORAGE_KEY.DIAGNOSTICS]: true, [STORAGE_KEY.DIAGNOSTICS_LOG]: 'something' });
      const service = make(storage);
      await service.enable();

      await service.disable();

      expect(service.enabled).toBeFalse();
      expect(storage.values.get(STORAGE_KEY.DIAGNOSTICS)).toBeFalse();
      expect(storage.values.get(STORAGE_KEY.DIAGNOSTICS_LOG)).toBe('');
    });

    it('keeps what it recorded in memory after being switched off, so a report can still be taken', async () => {
      const service = make();
      await service.enable({ persist: false });
      service.log('key', 'kept');

      await service.disable({ persist: false });

      expect(service.entries.some(e => e.msg === 'kept')).toBeTrue();
    });
  });

  describe('urlRequest', () => {
    const ask = DiagnosticsService.urlRequest;

    it('reads ?diag=1 as on and ?diag=0 as off', () => {
      expect(ask('?diag=1', '')).toBe('on');
      expect(ask('?diag=0', '')).toBe('off');
      expect(ask('?diag=true', '')).toBe('on');
      expect(ask('?diag=off', '')).toBe('off');
      expect(ask('?DIAG=ON', '')).toBe('on');
    });

    it('finds it among other parameters', () => {
      expect(ask('?room=ELI-ABCD&diag=1&host=1', '')).toBe('on');
    });

    it('finds it in the hash too, where the router keeps its query', () => {
      expect(ask('', '#/game?diag=1')).toBe('on');
      expect(ask('', '#/game?host=1&diag=0')).toBe('off');
    });

    it('prefers the address proper to the hash', () => {
      expect(ask('?diag=0', '#/game?diag=1')).toBe('off');
    });

    it('asks for nothing when the parameter is missing, empty or something else', () => {
      expect(ask('', '')).toBeNull();
      expect(ask('?room=ELI-ABCD', '#/game')).toBeNull();
      expect(ask('?diag=', '')).toBeNull();
      expect(ask('?diag=maybe', '')).toBeNull();
      expect(ask('?undiag=1', '')).toBeNull();
    });
  });

  describe('keeping the tail for the next page', () => {

    it('writes the log every few seconds, only when there is something new', fakeAsync(() => {
      const storage = memoryStorage();
      const service = build(storage);
      spare.push(service);
      void service.enable({ persist: false });
      flushMicrotasks();
      service.log('page', 'pagehide');

      tick(DIAGNOSTICS.PERSIST_INTERVAL_MS);
      const first = storage.values.get(STORAGE_KEY.DIAGNOSTICS_LOG) as string;
      expect(DiagnosticsTail.parse(first)?.entries.map(e => e.msg)).toEqual(['diagnostics on', 'pagehide']);

      storage.values.set(STORAGE_KEY.DIAGNOSTICS_LOG, 'untouched');
      tick(DIAGNOSTICS.PERSIST_INTERVAL_MS);
      expect(storage.values.get(STORAGE_KEY.DIAGNOSTICS_LOG)).toBe('untouched');

      service.log('page', 'pageshow');
      tick(DIAGNOSTICS.PERSIST_INTERVAL_MS);
      expect(DiagnosticsTail.parse(storage.values.get(STORAGE_KEY.DIAGNOSTICS_LOG) as string)?.entries.length).toBe(3);
      finish(service);
    }));

    it('writes when the page goes hidden, without waiting for the interval', fakeAsync(() => {
      const storage = memoryStorage();
      const service = build(storage);
      spare.push(service);
      void service.enable({ persist: false });
      flushMicrotasks();
      service.log('page', 'about to go');

      window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: false }));
      flushMicrotasks();

      const stored = DiagnosticsTail.parse(storage.values.get(STORAGE_KEY.DIAGNOSTICS_LOG) as string);
      expect(stored?.entries.map(e => e.msg)).toContain('pagehide');
      finish(service);
    }));

    it('shows the previous page\'s tail as "previous", and does not overwrite it before it was read', fakeAsync(() => {
      const earlier = DiagnosticsTail.serialize(
        [{ t: 10, w: 1000, cat: 'page', msg: 'freeze' }, { t: 20, w: 2000, cat: 'page', msg: 'pagehide' }],
        3000, { maxEntries: 100, maxChars: 10000 });
      const storage = memoryStorage({ [STORAGE_KEY.DIAGNOSTICS_LOG]: earlier });
      const service = build(storage);
      spare.push(service);

      void service.enable({ persist: false });
      flushMicrotasks();

      expect(service.previous?.entries.map(e => e.msg)).toEqual(['freeze', 'pagehide']);
      expect(service.previous?.savedAt).toBe(3000);
      expect(service.entries.every(e => e.msg !== 'freeze')).toBeTrue();
      finish(service);
    }));

    it('does not write at all until the previous tail has been read', fakeAsync(() => {
      let release!: (value: unknown) => void;
      const storage = memoryStorage({ [STORAGE_KEY.DIAGNOSTICS_LOG]: 'old' });
      storage.get = () => new Promise(resolve => { release = resolve; });
      const writes = spyOn(storage, 'set').and.callThrough();
      const service = build(storage);
      spare.push(service);
      void service.enable({ persist: false });
      flushMicrotasks();

      tick(DIAGNOSTICS.PERSIST_INTERVAL_MS * 2);
      expect(writes).not.toHaveBeenCalled();

      release('old');
      flushMicrotasks();
      tick(DIAGNOSTICS.PERSIST_INTERVAL_MS);
      expect(writes).toHaveBeenCalled();
      finish(service);
    }));

    it('survives storage that fails', fakeAsync(() => {
      const storage = memoryStorage();
      storage.set = () => Promise.reject(new Error('quota'));
      storage.get = () => Promise.reject(new Error('blocked'));
      const service = build(storage);
      spare.push(service);

      void service.enable();
      flushMicrotasks();
      service.log('key', 'x');
      tick(DIAGNOSTICS.PERSIST_INTERVAL_MS);
      flushMicrotasks();

      expect(service.enabled).toBeTrue();
      finish(service);
    }));
  });

  describe('clearEntries', () => {

    it('empties this page, forgets the previous one and blanks the stored tail', async () => {
      const earlier = DiagnosticsTail.serialize([{ t: 1, w: 1, cat: 'page', msg: 'old' }], 5, { maxEntries: 10, maxChars: 1000 });
      const storage = memoryStorage({ [STORAGE_KEY.DIAGNOSTICS_LOG]: earlier });
      const service = make(storage);
      await service.enable({ persist: false });
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(service.previous).not.toBeNull();

      service.clearEntries();

      expect(service.previous).toBeNull();
      expect(service.entries.map(e => e.msg)).toEqual(['log cleared']);
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(storage.values.get(STORAGE_KEY.DIAGNOSTICS_LOG)).toBe('');
    });

    it('is not undone by a read of the stored tail that was still in flight', fakeAsync(() => {
      let release!: (value: unknown) => void;
      const storage = memoryStorage();
      storage.get = () => new Promise(resolve => { release = resolve; });
      const service = build(storage);
      spare.push(service);
      void service.enable({ persist: false });
      flushMicrotasks();

      service.clearEntries();
      release(DiagnosticsTail.serialize([{ t: 1, w: 1, cat: 'page', msg: 'old' }], 5, { maxEntries: 10, maxChars: 1000 }));
      flushMicrotasks();

      expect(service.previous).toBeNull();
      finish(service);
    }));
  });
  describe('what the address asked, remembered for the tab', () => {

    it('turns on for the session when an earlier load of the tab was asked to', fakeAsync(() => {
      sessionStorage.setItem(DIAGNOSTICS.SESSION_KEY, 'on');
      const storage = memoryStorage();

      const service = build(storage);
      spare.push(service);
      flushMicrotasks();

      expect(service.enabled).toBeTrue();
      expect(service.sessionOnly).toBeTrue();
      expect(storage.values.has(STORAGE_KEY.DIAGNOSTICS)).toBeFalse();
      finish(service);
    }));

    it('stays off for the session when it was asked to, whatever the stored choice says', fakeAsync(() => {
      sessionStorage.setItem(DIAGNOSTICS.SESSION_KEY, 'off');

      const service = build(memoryStorage({ [STORAGE_KEY.DIAGNOSTICS]: true }));
      spare.push(service);
      flushMicrotasks();

      expect(service.enabled).toBeFalse();
    }));

    it('ignores a value it does not understand', fakeAsync(() => {
      sessionStorage.setItem(DIAGNOSTICS.SESSION_KEY, 'perhaps');

      const service = build(memoryStorage({ [STORAGE_KEY.DIAGNOSTICS]: true }));
      spare.push(service);
      flushMicrotasks();

      expect(service.enabled).toBeTrue();
      finish(service);
    }));

    it('is overruled by the person turning the log on or off', async () => {
      sessionStorage.setItem(DIAGNOSTICS.SESSION_KEY, 'off');
      const service = make();

      await service.enable();
      expect(sessionStorage.getItem(DIAGNOSTICS.SESSION_KEY)).toBeNull();

      sessionStorage.setItem(DIAGNOSTICS.SESSION_KEY, 'on');
      await service.disable();
      expect(sessionStorage.getItem(DIAGNOSTICS.SESSION_KEY)).toBeNull();
    });

    it('reads 1/true/on and 0/false/off, in any case, and nothing else', () => {
      expect(DiagnosticsService.parseSwitch('1')).toBe('on');
      expect(DiagnosticsService.parseSwitch('True')).toBe('on');
      expect(DiagnosticsService.parseSwitch('OFF')).toBe('off');
      expect(DiagnosticsService.parseSwitch('0')).toBe('off');
      expect(DiagnosticsService.parseSwitch('2')).toBeNull();
      expect(DiagnosticsService.parseSwitch('')).toBeNull();
      expect(DiagnosticsService.parseSwitch(null)).toBeNull();
      expect(DiagnosticsService.parseSwitch(undefined)).toBeNull();
    });
  });

  describe('the second copy of the tail, for a page that is going away', () => {
    const localTail = () => DiagnosticsTail.parse(localStorage.getItem(STORAGE_KEY.DIAGNOSTICS_LOG));
    const tail = (msg: string, savedAt: number) =>
      DiagnosticsTail.serialize([{ t: 1, w: savedAt, cat: 'page', msg }], savedAt, { maxEntries: 10, maxChars: 1000 });

    it('is written at once when the page is hidden, because an IndexedDB write may not finish', fakeAsync(() => {
      const service = build();
      spare.push(service);
      void service.enable({ persist: false });
      flushMicrotasks();
      service.log('page', 'about to go');

      window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: false }));

      expect(localTail()?.entries.map(e => e.msg)).toEqual(['diagnostics on', 'about to go', 'pagehide']);
      finish(service);
    }));

    it('is not what the interval writes: that goes to Ionic Storage only', fakeAsync(() => {
      const service = build();
      spare.push(service);
      void service.enable({ persist: false });
      flushMicrotasks();

      tick(DIAGNOSTICS.PERSIST_INTERVAL_MS);

      expect(localStorage.getItem(STORAGE_KEY.DIAGNOSTICS_LOG)).toBeNull();
      finish(service);
    }));

    it('is written again when it has fallen behind the other copy', fakeAsync(() => {
      const service = build();
      spare.push(service);
      void service.enable({ persist: false });
      flushMicrotasks();
      service.log('page', 'one');
      tick(DIAGNOSTICS.PERSIST_INTERVAL_MS); // Ionic Storage has it, localStorage does not.

      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      delete (document as unknown as Record<string, unknown>)['visibilityState'];

      expect(localTail()?.entries.map(e => e.msg)).toContain('one');
      finish(service);
    }));

    it('is read when it is newer than the Ionic Storage copy, and the other way round', fakeAsync(() => {
      localStorage.setItem(STORAGE_KEY.DIAGNOSTICS_LOG, tail('from localStorage', 2000));
      const older = build(memoryStorage({ [STORAGE_KEY.DIAGNOSTICS_LOG]: tail('from IndexedDB', 1000) }));
      spare.push(older);
      void older.enable({ persist: false });
      flushMicrotasks();
      expect(older.previous?.entries[0].msg).toBe('from localStorage');
      finish(older);

      localStorage.setItem(STORAGE_KEY.DIAGNOSTICS_LOG, tail('from localStorage', 1000));
      const newer = build(memoryStorage({ [STORAGE_KEY.DIAGNOSTICS_LOG]: tail('from IndexedDB', 2000) }));
      spare.push(newer);
      void newer.enable({ persist: false });
      flushMicrotasks();
      expect(newer.previous?.entries[0].msg).toBe('from IndexedDB');
      finish(newer);
    }));

    it('still reads the copy that is there when the other store fails', fakeAsync(() => {
      localStorage.setItem(STORAGE_KEY.DIAGNOSTICS_LOG, tail('only localStorage', 1000));
      const storage = memoryStorage();
      storage.get = () => Promise.reject(new Error('blocked'));
      const service = build(storage);
      spare.push(service);

      void service.enable({ persist: false });
      flushMicrotasks();

      expect(service.previous?.entries[0].msg).toBe('only localStorage');
      finish(service);
    }));

    it('is removed with the rest by clearEntries and by switching the log off', async () => {
      const service = make();
      await service.enable({ persist: false });
      await new Promise(resolve => setTimeout(resolve, 0)); // the previous tail has been read: writing is allowed
      window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: false }));
      expect(localStorage.getItem(STORAGE_KEY.DIAGNOSTICS_LOG)).not.toBeNull();

      service.clearEntries();
      expect(localStorage.getItem(STORAGE_KEY.DIAGNOSTICS_LOG)).toBeNull();

      service.log('page', 'again');
      window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: false }));
      expect(localStorage.getItem(STORAGE_KEY.DIAGNOSTICS_LOG)).not.toBeNull();
      await service.disable({ persist: false });
      expect(localStorage.getItem(STORAGE_KEY.DIAGNOSTICS_LOG)).toBeNull();
    });
  });
});
