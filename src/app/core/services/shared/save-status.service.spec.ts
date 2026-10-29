import { NgZone } from '@angular/core';
import { fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { SAVE_SAFETY, STORAGE_KEY } from '../../models/constants';
import { SaveStatusSnapshot } from '../../helpers/save-status.helper';
import { silentDiagnostics, memoryStorage, recordingDiagnostics } from './diagnostics.testing';
import { LocalStorageService } from './local-storage.service';
import { SaveStatusService, StorageManagerLike } from './save-status.service';

/** A status service whose `navigator.storage` is the one the spec hands it. */
class TestSaveStatusService extends SaveStatusService {
  manager: StorageManagerLike | undefined = undefined;
  protected override storageManager(): StorageManagerLike | undefined {
    return this.manager;
  }
}

const DAY = 24 * 60 * 60 * 1000;

function build(initial: Record<string, unknown> = {}) {
  const storage = memoryStorage(initial);
  const service = new TestSaveStatusService(
    storage as unknown as LocalStorageService,
    new NgZone({ enableLongStackTrace: false }),
    silentDiagnostics());
  const seen: SaveStatusSnapshot[] = [];
  service.snapshot$.subscribe(snapshot => seen.push(snapshot));
  return { service, storage, seen };
}

describe('SaveStatusService', () => {
  beforeEach(() => spyOn(console, 'warn'));

  describe('load', () => {
    it('restores what earlier visits stored', fakeAsync(() => {
      const { service } = build({
        [STORAGE_KEY.LAST_PERSISTED_AT]: 1_700_000_000_000,
        [STORAGE_KEY.FIRST_PERSISTED_AT]: 1_600_000_000_000,
        [STORAGE_KEY.LAST_BACKUP_AT]: 1_650_000_000_000,
      });

      service.load();
      flushMicrotasks();

      expect(service.snapshot.lastPersistedAt).toBe(1_700_000_000_000);
      expect(service.snapshot.firstPersistedAt).toBe(1_600_000_000_000);
      expect(service.snapshot.lastBackupAt).toBe(1_650_000_000_000);
    }));

    it('takes storage for what it is, one more input: junk is no time', fakeAsync(() => {
      const { service } = build({
        [STORAGE_KEY.LAST_PERSISTED_AT]: 'ontem',
        [STORAGE_KEY.FIRST_PERSISTED_AT]: -5,
        [STORAGE_KEY.LAST_BACKUP_AT]: NaN,
      });

      service.load();
      flushMicrotasks();

      expect(service.snapshot.lastPersistedAt).toBeNull();
      expect(service.snapshot.firstPersistedAt).toBeNull();
      expect(service.snapshot.lastBackupAt).toBeNull();
    }));

    it('reads once, however many ask', fakeAsync(() => {
      const { service, storage } = build();
      const get = spyOn(storage, 'get').and.callThrough();

      service.load();
      service.load();
      flushMicrotasks();

      expect(get).toHaveBeenCalledTimes(4);
    }));

    it('does not throw when storage is blocked: the chip just starts from nothing', fakeAsync(() => {
      const { service, storage } = build();
      spyOn(storage, 'get').and.returnValue(Promise.reject(new Error('SecurityError')));

      let failure: unknown = null;
      service.load().catch(error => { failure = error; });
      flushMicrotasks();

      expect(failure).toBeNull();
      expect(service.snapshot.lastPersistedAt).toBeNull();
    }));

    it('does not let a stale read overwrite a persist that finished first', fakeAsync(() => {
      const { service } = build({ [STORAGE_KEY.LAST_PERSISTED_AT]: 1_000 });

      service.persistSucceeded(service.persistStarted());
      const justNow = service.snapshot.lastPersistedAt!;
      service.load();
      flushMicrotasks();

      expect(service.snapshot.lastPersistedAt).toBe(justNow);
    }));
  });

  describe('dirty', () => {
    it('starts clean', () => {
      expect(build().service.dirty).toBeFalse();
    });

    it('is set by the first input, and says since when', fakeAsync(() => {
      const { service } = build();

      tick(1000);
      const before = Date.now();
      service.markDirty();

      expect(service.dirty).toBeTrue();
      expect(service.snapshot.dirtySince).toBe(before);
    }));

    it('announces the change once, not once per keystroke', () => {
      const { service, seen } = build();
      const initial = seen.length;

      for (let i = 0; i < 50; i++) service.markDirty();

      expect(seen.length - initial).toBe(1);
    });

    it('is written to the diagnostics log once per stretch of unsaved input, not once per keystroke', async () => {
      const diagnostics = await recordingDiagnostics();
      try {
        const service = new TestSaveStatusService(memoryStorage() as unknown as LocalStorageService, new NgZone({ enableLongStackTrace: false }), diagnostics);

        for (let i = 0; i < 20; i++) service.markDirty();
        service.persistSucceeded(service.persistStarted());
        service.markDirty();

        const lines = diagnostics.entries.filter(entry => entry.cat === 'save').map(entry => entry.msg);
        expect(lines.filter(line => line === 'status: unsaved input').length).toBe(2);
        expect(lines).toContain('status: persisted');
      } finally {
        await diagnostics.disable();
      }
    });

    it('is cleared by a persist that began after the last input', fakeAsync(() => {
      const { service } = build();
      service.markDirty();

      const token = service.persistStarted();
      service.persistSucceeded(token);

      expect(service.dirty).toBeFalse();
      expect(service.snapshot.dirtySince).toBeNull();
    }));

    it('is NOT cleared by a persist that began before an input that arrived while it ran', fakeAsync(() => {
      const { service } = build();
      service.markDirty();
      const token = service.persistStarted();
      tick(500);
      service.markDirty(); // not in what the persist is writing

      service.persistSucceeded(token);

      expect(service.dirty).toBeTrue();
      expect(service.snapshot.dirtySince).toBe(Date.now());
    }));

    it('stays dirty after a persist that failed', fakeAsync(() => {
      const { service } = build();
      service.markDirty();

      service.persistStarted();
      service.persistFailed();

      expect(service.dirty).toBeTrue();
      expect(service.snapshot.persistFailed).toBeTrue();
      expect(service.snapshot.persisting).toBeFalse();
    }));
  });

  describe('persists', () => {
    it('says it is persisting for as long as one is in flight, however many overlap', () => {
      const { service } = build();

      const a = service.persistStarted();
      const b = service.persistStarted();
      expect(service.snapshot.persisting).toBeTrue();
      service.persistSucceeded(a);
      expect(service.snapshot.persisting).toBeTrue();
      service.persistSucceeded(b);
      expect(service.snapshot.persisting).toBeFalse();
    });

    it('records when it worked, remembers the first time ever, and stores both', fakeAsync(() => {
      const { service, storage } = build();

      tick(5000);
      service.persistSucceeded(service.persistStarted());
      const first = service.snapshot.lastPersistedAt!;
      tick(60_000);
      service.persistSucceeded(service.persistStarted());

      expect(service.snapshot.firstPersistedAt).toBe(first);
      expect(service.snapshot.lastPersistedAt).toBe(first + 60_000);
      flushMicrotasks();
      expect(storage.values.get(STORAGE_KEY.FIRST_PERSISTED_AT)).toBe(first);
      expect(storage.values.get(STORAGE_KEY.LAST_PERSISTED_AT)).toBe(first + 60_000);
    }));

    it('clears the failure on the next success', () => {
      const { service } = build();
      service.persistStarted();
      service.persistFailed();

      service.persistSucceeded(service.persistStarted());

      expect(service.snapshot.persistFailed).toBeFalse();
    });

    it('stops writing to storage once frozen, which is what keeps a wipe final', fakeAsync(() => {
      const { service, storage } = build();
      service.freeze();

      service.persistSucceeded(service.persistStarted());
      service.recordBackup();
      service.dismissBackupNudge();
      flushMicrotasks();

      expect(storage.values.size).toBe(0);
      // The page itself still knows: only the store is left alone.
      expect(service.snapshot.lastPersistedAt).not.toBeNull();
    }));
  });

  describe('backups', () => {
    it('records when one left, and stores it', fakeAsync(() => {
      const { service, storage } = build();

      service.recordBackup();
      flushMicrotasks();

      expect(service.snapshot.lastBackupAt).toBe(Date.now());
      expect(storage.values.get(STORAGE_KEY.LAST_BACKUP_AT)).toBe(Date.now());
    }));

    it('is not nudging a player who has nothing saved', fakeAsync(() => {
      const { service } = build();
      let due: boolean | undefined;

      service.backupNudgeDue().then(value => due = value);
      flushMicrotasks();

      expect(due).toBeFalse();
    }));

    it('nudges after a week without a backup, counted from the first save', fakeAsync(() => {
      const { service } = build({ [STORAGE_KEY.FIRST_PERSISTED_AT]: Date.now() - 8 * DAY });
      let due: boolean | undefined;

      service.backupNudgeDue().then(value => due = value);
      flushMicrotasks();

      expect(due).toBeTrue();
    }));

    it('does not nudge a player who backed up lately', fakeAsync(() => {
      const { service } = build({
        [STORAGE_KEY.FIRST_PERSISTED_AT]: Date.now() - 30 * DAY,
        [STORAGE_KEY.LAST_BACKUP_AT]: Date.now() - 1 * DAY,
      });
      let due: boolean | undefined;

      service.backupNudgeDue().then(value => due = value);
      flushMicrotasks();

      expect(due).toBeFalse();
    }));

    it('never nudges again once it was answered, in this visit or the next', fakeAsync(() => {
      const first = build({ [STORAGE_KEY.FIRST_PERSISTED_AT]: Date.now() - 8 * DAY });
      first.service.dismissBackupNudge();
      flushMicrotasks();
      let due: boolean | undefined;

      first.service.backupNudgeDue().then(value => due = value);
      flushMicrotasks();
      expect(due).toBeFalse();

      // The next visit: a new service over the same store.
      const stored: Record<string, unknown> = {};
      first.storage.values.forEach((value, key) => { stored[key] = value; });
      const next = build(stored);
      next.service.backupNudgeDue().then(value => due = value);
      flushMicrotasks();
      expect(due).toBeFalse();
      expect(first.storage.values.get(STORAGE_KEY.BACKUP_NUDGE_DISMISSED)).toBeTrue();
    }));

    it('counts the week in the policy\'s own number', () => {
      expect(SAVE_SAFETY.BACKUP_NUDGE_AFTER_MS).toBe(7 * DAY);
    });
  });

  describe('leaving on purpose', () => {
    it('knows a deliberate reload from a close nobody chose', () => {
      const { service } = build();
      expect(service.exitAllowed).toBeFalse();

      service.allowExit();

      expect(service.exitAllowed).toBeTrue();
    });
  });

  describe('the game\'s own save', () => {
    it('is not writing until the auto-saver says it saw the dialog', () => {
      expect(build().service.gameWriting).toBeFalse();
    });

    it('is idle at once when it is not writing', fakeAsync(() => {
      const { service } = build();
      let idle: boolean | undefined;

      service.whenGameIdle(5000).then(value => idle = value);
      flushMicrotasks();

      expect(idle).toBeTrue();
    }));

    it('waits for the dialog to go, then says idle', fakeAsync(() => {
      const { service } = build();
      service.setGameWriting(true);
      let idle: boolean | undefined;

      service.whenGameIdle(5000, 250).then(value => idle = value);
      tick(1000);
      expect(idle).toBeUndefined();

      service.setGameWriting(false);
      tick(250);

      expect(idle).toBeTrue();
    }));

    it('gives up after the ceiling and says it is still writing, so a stuck dialog cannot hold an update', fakeAsync(() => {
      const { service } = build();
      service.setGameWriting(true);
      let idle: boolean | undefined;

      service.whenGameIdle(5000, 250).then(value => idle = value);
      tick(4750);
      expect(idle).toBeUndefined();
      tick(500);

      expect(idle).toBeFalse();
    }));
  });

  describe('durable storage', () => {
    it('asks the browser to keep the storage after the first save that worked, and only then', fakeAsync(() => {
      const { service } = build();
      const persist = jasmine.createSpy('persist').and.resolveTo(true);
      service.manager = { persist, persisted: () => Promise.resolve(false) };

      service.persistStarted();
      service.persistFailed();
      flushMicrotasks();
      expect(persist).not.toHaveBeenCalled();

      service.persistSucceeded(service.persistStarted());
      flushMicrotasks();

      expect(persist).toHaveBeenCalledTimes(1);
      expect(service.durable).toBeTrue();
    }));

    it('asks once per page, however many saves follow', fakeAsync(() => {
      const { service } = build();
      const persist = jasmine.createSpy('persist').and.resolveTo(false);
      service.manager = { persist };

      for (let i = 0; i < 3; i++) service.persistSucceeded(service.persistStarted());
      flushMicrotasks();

      expect(persist).toHaveBeenCalledTimes(1);
      expect(service.durable).toBeFalse();
    }));

    it('does not ask again when the browser already granted it', fakeAsync(() => {
      const { service } = build();
      const persist = jasmine.createSpy('persist').and.resolveTo(true);
      service.manager = { persist, persisted: () => Promise.resolve(true) };

      service.persistSucceeded(service.persistStarted());
      flushMicrotasks();

      expect(persist).not.toHaveBeenCalled();
      expect(service.durable).toBeTrue();
    }));

    it('is feature-detected: a browser without it is simply not asked', fakeAsync(() => {
      const { service } = build();
      service.manager = undefined;

      service.persistSucceeded(service.persistStarted());
      flushMicrotasks();

      expect(service.durable).toBeNull();

      service.manager = {};
      const second = build();
      second.service.manager = {};
      second.service.persistSucceeded(second.service.persistStarted());
      flushMicrotasks();
      expect(second.service.durable).toBeNull();
    }));

    it('survives a browser that throws when asked', fakeAsync(() => {
      const { service } = build();
      service.manager = { persist: () => Promise.reject(new Error('NotAllowedError')) };

      service.persistSucceeded(service.persistStarted());
      flushMicrotasks();

      expect(service.durable).toBeNull();
      expect(service.snapshot.persistFailed).toBeFalse();
    }));
  });
});
