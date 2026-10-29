import JSZip from 'jszip';
import { SaveGameService, SavesBackup } from './save-game.service';
import { silentDiagnostics } from '../shared/diagnostics.testing';
import { BASE_SAVEGAME_DIR } from '../../models/constants';
import { SaveBackupHelper } from '../../helpers/save-backup.helper';
import { DosCI } from '../../typings/jsdos';

/** What SaveGameService tells the status service, recorded in order. */
function fakeStatus() {
  const events: string[] = [];
  const status = {
    events,
    persistStarted: jasmine.createSpy('persistStarted').and.callFake(() => { events.push('started'); return { seq: 0 }; }),
    persistSucceeded: jasmine.createSpy('persistSucceeded').and.callFake(() => { events.push('succeeded'); }),
    persistFailed: jasmine.createSpy('persistFailed').and.callFake(() => { events.push('failed'); }),
    recordBackup: jasmine.createSpy('recordBackup').and.callFake(() => { events.push('backup'); }),
  };
  return status;
}

/** Every database this spec makes starts with this, and every one is removed afterwards. */
const SPEC_DB = (suffix: string) => `js-dos-cache (spec ${suffix})`;

function bytes(length: number, fill: number): ArrayBuffer {
  return new Uint8Array(length).fill(fill).buffer;
}

/** Make a database shaped like js-dos's, or one without its "files" store when `entries` is null. */
function createDatabase(name: string, entries: Record<string, unknown> | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(name, 1);
    open.onupgradeneeded = () => {
      if (entries == null) return;
      const store = open.result.createObjectStore('files');
      for (const [key, value] of Object.entries(entries)) {
        store.put(value, key);
      }
    };
    open.onsuccess = () => {
      open.result.close();
      resolve();
    };
    open.onerror = () => reject(open.error);
  });
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise(resolve => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
}

async function deleteAllJsDosDatabases(): Promise<void> {
  for (const info of await indexedDB.databases()) {
    if (info.name?.startsWith('js-dos-cache')) await deleteDatabase(info.name);
  }
}

describe('SaveGameService stored changes', () => {
  let service: SaveGameService;
  let status: ReturnType<typeof fakeStatus>;

  beforeEach(async () => {
    status = fakeStatus();
    service = new SaveGameService(silentDiagnostics(), status as never);
    await deleteAllJsDosDatabases();
  });

  afterEach(async () => {
    await deleteAllJsDosDatabases();
  });

  describe('readStoredChanges', () => {

    it('finds nothing when js-dos never stored anything', async () => {
      expect(await service.readStoredChanges()).toBeNull();
    });

    it('does not create a database just by looking', async () => {
      await service.readStoredChanges();
      const names = (await indexedDB.databases()).map(info => info.name);
      expect(names.filter(name => name?.startsWith('js-dos-cache'))).toEqual([]);
    });

    it('returns the bytes of the changes layer', async () => {
      await createDatabase(SPEC_DB('one'), { 'assets/elifoot/elifoot98.jsdos.changes': bytes(64, 7) });

      const found = await service.readStoredChanges();

      expect(found).not.toBeNull();
      expect(found!.byteLength).toBe(64);
      expect(Array.from(found!)).toEqual(Array.from(new Uint8Array(64).fill(7)));
    });

    it('ignores entries that are not a changes layer', async () => {
      await createDatabase(SPEC_DB('mixed'), {
        'assets/elifoot/elifoot98.jsdos': bytes(500, 1),
        'something.changes': 'not a buffer',
        'other.changes': bytes(10, 2),
      });

      const found = await service.readStoredChanges();

      expect(found!.byteLength).toBe(10);
    });

    it('takes the largest layer when several databases hold one', async () => {
      await createDatabase(SPEC_DB('small'), { 'a.changes': bytes(10, 1) });
      await createDatabase(SPEC_DB('large'), { 'b.changes': bytes(40, 2) });

      const found = await service.readStoredChanges();

      expect(found!.byteLength).toBe(40);
      expect(found![0]).toBe(2);
    });

    it('skips a database js-dos left without its store', async () => {
      await createDatabase(SPEC_DB('empty'), null);
      await createDatabase(SPEC_DB('full'), { 'a.changes': bytes(5, 3) });

      expect((await service.readStoredChanges())!.byteLength).toBe(5);
    });

    it('finds nothing in a store that holds no layer', async () => {
      await createDatabase(SPEC_DB('nolayer'), {});
      expect(await service.readStoredChanges()).toBeNull();
    });

    it('leaves databases that are not js-dos\'s alone', async () => {
      await createDatabase('some-other-app-db', { 'x.changes': bytes(99, 1) });
      try {
        expect(await service.readStoredChanges()).toBeNull();
      } finally {
        await deleteDatabase('some-other-app-db');
      }
    });
  });

  describe('readStoredChanges without indexedDB.databases() (Firefox before 126)', () => {
    const JS_DOS_DATABASE = 'js-dos-cache (emulators-ui-saves)';

    /** Hide the listing for one case: it lives on the prototype, so a shadow on the instance is enough. */
    async function withoutDatabaseListing<T>(body: () => Promise<T>): Promise<T> {
      Object.defineProperty(indexedDB, 'databases', { value: undefined, configurable: true });
      try {
        return await body();
      } finally {
        delete (indexedDB as any).databases;
      }
    }

    it('asks for the one name js-dos uses and finds its layer', async () => {
      await createDatabase(JS_DOS_DATABASE, { 'assets/elifoot/elifoot98.jsdos.changes': bytes(21, 4) });

      const found = await withoutDatabaseListing(() => service.readStoredChanges());

      expect(found!.byteLength).toBe(21);
    });

    it('does not create js-dos\'s database when js-dos.js never got to: a store-less one breaks every later save', async () => {
      const found = await withoutDatabaseListing(() => service.readStoredChanges());

      expect(found).toBeNull();
      const names = (await indexedDB.databases()).map(info => info.name);
      expect(names).not.toContain(JS_DOS_DATABASE);
    });
  });

  describe('downloadStoredChanges', () => {

    it('downloads what it reads, under a dated name', async () => {
      await createDatabase(SPEC_DB('dl'), { 'a.changes': bytes(12, 9) });
      const save = spyOn<any>(service, 'saveUint8ArrayAsFile');

      expect(await service.downloadStoredChanges()).toBeTrue();

      expect(save).toHaveBeenCalledTimes(1);
      const [content, fileName] = save.calls.mostRecent().args;
      expect((content as Uint8Array).byteLength).toBe(12);
      expect(fileName).toMatch(/^fullDiskChanges_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.zip$/);
    });

    it('downloads nothing, and says so, when there is nothing', async () => {
      const save = spyOn<any>(service, 'saveUint8ArrayAsFile');

      expect(await service.downloadStoredChanges()).toBeFalse();

      expect(save).not.toHaveBeenCalled();
      expect(status.recordBackup).not.toHaveBeenCalled();
    });

    it('counts as a backup, since it holds the saves', async () => {
      await createDatabase(SPEC_DB('dl2'), { 'a.changes': bytes(12, 9) });
      spyOn<any>(service, 'saveUint8ArrayAsFile');

      await service.downloadStoredChanges();

      expect(status.recordBackup).toHaveBeenCalledTimes(1);
    });

    it('is stamped by the same function as every other file this app writes', async () => {
      await createDatabase(SPEC_DB('dl3'), { 'a.changes': bytes(12, 9) });
      const save = spyOn<any>(service, 'saveUint8ArrayAsFile');
      spyOn(SaveBackupHelper, 'fileStamp').and.returnValue('STAMP');

      await service.downloadStoredChanges();

      expect(save.calls.mostRecent().args[1]).toBe('fullDiskChanges_STAMP.zip');
    });
  });

  describe('clearAllData without an emulator', () => {

    it('still removes the js-dos databases, which is what the boot-failure wipe needs', async () => {
      await createDatabase(SPEC_DB('wipe'), { 'a.changes': bytes(5, 1) });
      spyOn(console, 'warn');
      spyOn(console, 'log');

      await service.clearAllData(null);

      const names = (await indexedDB.databases()).map(info => info.name);
      expect(names.filter(name => name?.startsWith('js-dos-cache'))).toEqual([]);
    });
  });
});

describe('SaveGameService persists', () => {
  const globals = window as unknown as Record<string, unknown>;
  let status: ReturnType<typeof fakeStatus>;
  let service: SaveGameService;

  beforeEach(() => {
    status = fakeStatus();
    service = new SaveGameService(silentDiagnostics(), status as never);
  });

  afterEach(() => {
    delete globals['saveGameFileSystem'];
  });

  it('reports a flush to the status service, start and end', async () => {
    globals['saveGameFileSystem'] = () => Promise.resolve();

    await service.saveGame();

    expect(status.events).toEqual(['started', 'succeeded']);
  });

  it('reports a flush that failed, and fails the same way', async () => {
    const failure = new Error('IndexedDB closed');
    globals['saveGameFileSystem'] = () => Promise.reject(failure);

    await expectAsync(service.saveGame()).toBeRejectedWith(failure);

    expect(status.events).toEqual(['started', 'failed']);
  });

  it('runs one flush at a time: a second caller waits for the first', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    let calls = 0;
    globals['saveGameFileSystem'] = () => {
      const call = ++calls;
      order.push(`begin ${call}`);
      if (call === 1) {
        return new Promise<void>(resolve => { releaseFirst = () => { order.push('end 1'); resolve(); }; });
      }
      order.push(`end ${call}`);
      return Promise.resolve();
    };

    const first = service.saveGame();
    const second = service.saveGame();
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['begin 1']);

    releaseFirst();
    await Promise.all([first, second]);

    expect(order).toEqual(['begin 1', 'end 1', 'begin 2', 'end 2']);
  });

  it('goes on to the next flush after one that failed', async () => {
    let calls = 0;
    globals['saveGameFileSystem'] = () => (++calls === 1 ? Promise.reject(new Error('first')) : Promise.resolve());

    const first = service.saveGame().catch(() => 'failed');
    const second = service.saveGame();
    await Promise.all([first, second]);

    expect(calls).toBe(2);
  });
});

describe('SaveGameService backups', () => {
  let status: ReturnType<typeof fakeStatus>;
  let service: SaveGameService;

  /** A dosCI whose persist() returns a layer like js-dos's, holding the given saves. */
  function emulator(saves: Record<string, string>): DosCI {
    return {
      persist: async () => {
        const zip = new JSZip();
        zip.file('hdd.img', new Uint8Array([1]));
        for (const [name, content] of Object.entries(saves)) zip.file(BASE_SAVEGAME_DIR + name, content);
        return zip.generateAsync({ type: 'uint8array' });
      },
    } as unknown as DosCI;
  }

  beforeEach(() => {
    status = fakeStatus();
    service = new SaveGameService(silentDiagnostics(), status as never);
    spyOn(console, 'warn');
  });

  describe('prepareSavesBackup', () => {
    it('builds a dated zip of the saves', async () => {
      const backup = await service.prepareSavesBackup(emulator({ 'A.E98': 'um', 'B.E98': 'dois' }));

      expect(backup!.names.sort()).toEqual(['A.E98', 'B.E98']);
      expect(backup!.fileName).toMatch(/^elifoot98_saves_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.zip$/);
      const zip = await JSZip.loadAsync(backup!.bytes);
      expect(await zip.file('A.E98')!.async('string')).toBe('um');
    });

    it('is null when the game has no save, and when there is no emulator', async () => {
      expect(await service.prepareSavesBackup(emulator({}))).toBeNull();
      expect(await service.prepareSavesBackup(null)).toBeNull();
    });
  });

  describe('deliverBackup', () => {
    const backup: SavesBackup = { bytes: new Uint8Array([80, 75]), names: ['A.E98'], fileName: 'elifoot98_saves_x.zip' };
    const nav = navigator as unknown as { share?: unknown };
    let download: jasmine.Spy;

    beforeEach(() => {
      download = spyOn<any>(service, 'saveUint8ArrayAsFile');
    });

    afterEach(() => {
      delete nav.share;
    });

    it('downloads when asked to, and counts it as a backup', async () => {
      expect(await service.deliverBackup(backup, 'download')).toBe('downloaded');

      expect(download).toHaveBeenCalledWith(backup.bytes, backup.fileName);
      expect(status.recordBackup).toHaveBeenCalledTimes(1);
    });

    it('shares the file through the system sheet, and counts it', async () => {
      const share = jasmine.createSpy('share').and.resolveTo(undefined);
      nav.share = share;

      expect(await service.deliverBackup(backup, 'share')).toBe('shared');

      const [data] = share.calls.mostRecent().args;
      expect(data.files.length).toBe(1);
      expect(data.files[0].name).toBe(backup.fileName);
      expect(data.files[0].type).toBe('application/zip');
      expect(download).not.toHaveBeenCalled();
      expect(status.recordBackup).toHaveBeenCalledTimes(1);
    });

    it('calls share before anything is awaited: Safari wants it inside the tap', () => {
      const share = jasmine.createSpy('share').and.resolveTo(undefined);
      nav.share = share;

      void service.deliverBackup(backup, 'share');

      expect(share).toHaveBeenCalledTimes(1);
    });

    it('is not a backup when the player closed the sheet', async () => {
      nav.share = () => Promise.reject(new DOMException('closed', 'AbortError'));

      expect(await service.deliverBackup(backup, 'share')).toBe('cancelled');

      expect(download).not.toHaveBeenCalled();
      expect(status.recordBackup).not.toHaveBeenCalled();
    });

    it('downloads instead when the share fails for any other reason', async () => {
      nav.share = () => Promise.reject(new DOMException('no gesture', 'NotAllowedError'));

      expect(await service.deliverBackup(backup, 'share')).toBe('downloaded');

      expect(download).toHaveBeenCalledWith(backup.bytes, backup.fileName);
      expect(status.recordBackup).toHaveBeenCalledTimes(1);
    });
  });

  describe('downloadFullDiskChanges', () => {
    it('is stamped like the other downloads (the month from 1, zero padded) and counts as a backup', async () => {
      const save = spyOn<any>(service, 'saveUint8ArrayAsFile');
      const stamp = spyOn(SaveBackupHelper, 'fileStamp').and.returnValue('STAMP');

      expect(await service.downloadFullDiskChanges(emulator({ 'A.E98': 'x' }))).toBeTrue();

      expect(stamp).toHaveBeenCalledTimes(1);
      expect(save.calls.mostRecent().args[1]).toBe('fullDiskChanges_STAMP.zip');
      expect(status.recordBackup).toHaveBeenCalledTimes(1);
    });
  });
});

describe('SaveGameService messages', () => {
  it('says why a database cannot be opened in Portuguese, not in the browser\'s English', async () => {
    const service = new SaveGameService(silentDiagnostics(), fakeStatus() as never);
    spyOn(indexedDB, 'databases').and.resolveTo([{ name: 'js-dos-cache (spec blocked)', version: 1 }]);
    spyOn(indexedDB, 'open').and.callFake(() => {
      const request: Record<string, unknown> = {};
      // The browser answers a blocked open by calling onblocked.
      setTimeout(() => (request['onblocked'] as () => void)?.(), 0);
      return request as unknown as IDBOpenDBRequest;
    });

    const failure = await service.readStoredChanges().then(() => null, error => error as Error);

    expect(failure?.message).toBe('A abertura do armazenamento js-dos-cache (spec blocked) está bloqueada. Feche as outras abas do jogo e tente de novo.');
  });

  it('says it in Portuguese when the browser gives no reason for a failed open', async () => {
    const service = new SaveGameService(silentDiagnostics(), fakeStatus() as never);
    spyOn(indexedDB, 'databases').and.resolveTo([{ name: 'js-dos-cache (spec failed)', version: 1 }]);
    spyOn(indexedDB, 'open').and.callFake(() => {
      const request: Record<string, unknown> = { error: null };
      setTimeout(() => (request['onerror'] as () => void)?.(), 0);
      return request as unknown as IDBOpenDBRequest;
    });

    const failure = await service.readStoredChanges().then(() => null, error => error as Error);

    expect(failure?.message).toBe('Não foi possível abrir o armazenamento js-dos-cache (spec failed).');
  });
});
