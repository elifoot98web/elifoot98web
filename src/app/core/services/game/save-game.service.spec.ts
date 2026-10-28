import { SaveGameService } from './save-game.service';

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

  beforeEach(async () => {
    service = new SaveGameService();
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
