import { Injectable } from '@angular/core';
import { Storage } from '@ionic/storage-angular';
import { STORAGE_KEY, STORAGE_KEY_HOMES } from '../../models/constants';

@Injectable({
  providedIn: 'root'
})
export class LocalStorageService {

  constructor(private storage: Storage) {
    this.init()
  }

  private async init() {
    await this.storage.create()
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.storage.set(key, value)
  }

  async get<T>(key: string): Promise<T> {
    return await this.storage.get(key)
  }

  /**
   * Empty everything the app keeps. Ionic Storage goes wholesale (`storage.clear()`), so a key that
   * lives only there needs no mention. The rest is derived from STORAGE_KEY_HOMES: a key that is
   * also written to `localStorage` (the diagnostics log's second copy, written synchronously
   * because a page that is going away cannot be trusted to finish an IndexedDB write) is removed
   * from there too. Declaring the home in that table is what makes the wipe reach a key, and
   * storage-keys.spec.ts proves it for every one.
   */
  async clearAllData(): Promise<void> {
    await this.storage.clear()
    for (const name of Object.keys(STORAGE_KEY) as Array<keyof typeof STORAGE_KEY>) {
      if (!STORAGE_KEY_HOMES[name].includes('localStorage')) continue
      try {
        localStorage.removeItem(STORAGE_KEY[name])
      } catch {
        // Site data is blocked: there is nothing stored to remove.
      }
    }
  }

}
