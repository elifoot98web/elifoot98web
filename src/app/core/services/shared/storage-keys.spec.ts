import { Storage } from '@ionic/storage-angular';
import { JSDOS_STORAGE, STORAGE_KEY, STORAGE_KEY_HOMES, StorageHome } from '../../models/constants';
import { LocalStorageService } from './local-storage.service';

/**
 * "Apagar todos os dados" has to leave nothing of the app's behind. Every key in STORAGE_KEY is
 * written, to each place it says it lives, and the wipe must find it there. A key that is added
 * and never taught to the wipe fails here (or does not compile, if it was not given a home at all).
 *
 * Nothing survives the wipe. If a key ever must (a setting that outlives the data it describes),
 * that is a decision to make out loud: `clearAllData` has to learn to spare it, and this spec has
 * to name it and say why. Until then "every key is wiped" is the whole contract.
 *
 * The Ionic Storage here is the real one over the karma browser's IndexedDB, in a database of its
 * own, so that `clear()` is the real `clear()`.
 */
describe('STORAGE_KEY and the wipe', () => {
  const NAMES = Object.keys(STORAGE_KEY) as Array<keyof typeof STORAGE_KEY>;
  let storage: Storage;
  let service: LocalStorageService;

  beforeEach(async () => {
    storage = new Storage({ name: '__elifoot_spec_storage_keys' });
    await storage.create();
    service = new LocalStorageService(storage);
    for (const name of NAMES) localStorage.removeItem(STORAGE_KEY[name]);
  });

  afterEach(async () => {
    await storage.clear();
    for (const name of NAMES) localStorage.removeItem(STORAGE_KEY[name]);
  });

  it('keeps a home for every key, and no home for a key that does not exist', () => {
    expect(Object.keys(STORAGE_KEY_HOMES).sort()).toEqual([...NAMES].sort());
  });

  it('gives every key a value of its own: two names for one string would share a slot', () => {
    const values = NAMES.map(name => STORAGE_KEY[name]);

    expect(new Set(values).size).toBe(values.length);
  });

  it('keeps Ionic Storage as the home of every key, because that is where the app reads and writes them', () => {
    for (const name of NAMES) {
      expect(STORAGE_KEY_HOMES[name]).toContain('ionic' as StorageHome);
    }
  });

  it('removes every key from every place it lives', async () => {
    for (const name of NAMES) {
      const key = STORAGE_KEY[name];
      for (const home of STORAGE_KEY_HOMES[name]) {
        if (home === 'ionic') await service.set(key, `value of ${name}`);
        else localStorage.setItem(key, `value of ${name}`);
      }
    }

    await service.clearAllData();

    for (const name of NAMES) {
      const key = STORAGE_KEY[name];
      for (const home of STORAGE_KEY_HOMES[name]) {
        const left = home === 'ionic' ? await service.get(key) : localStorage.getItem(key);
        expect(left).withContext(`${name} in ${home}`).toBeNull();
      }
    }
  });

  it('removes the entries js-dos keeps for itself: the volume is the app\'s setting, and js-dos applies its copy first at the next boot', async () => {
    for (const key of Object.values(JSDOS_STORAGE)) localStorage.setItem(key, '0.4');

    await service.clearAllData();

    for (const key of Object.values(JSDOS_STORAGE)) expect(localStorage.getItem(key)).withContext(key).toBeNull();
  });

  it('leaves alone what is not the app\'s', async () => {
    localStorage.setItem('somebody else\'s key', 'kept');

    await service.clearAllData();

    expect(localStorage.getItem('somebody else\'s key')).toBe('kept');
    localStorage.removeItem('somebody else\'s key');
  });

  it('covers the keys the mobile work added, which is the audit this spec is the answer to', () => {
    for (const name of [
      'TOUCH_MODE', 'DIAGNOSTICS', 'DIAGNOSTICS_LOG', 'LAST_PERSISTED_AT', 'FIRST_PERSISTED_AT', 'LAST_BACKUP_AT', 'BACKUP_NUDGE_DISMISSED',
      'KEEP_AWAKE', 'GAME_VOLUME', 'GAME_MUTED', 'AUDIO_PLAYBACK', 'ROTATE_HINT_SHOWN', 'INSTALL_NUDGE_DISMISSED',
    ] as const) {
      expect(NAMES).toContain(name);
    }
  });
});
