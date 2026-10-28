import { Injectable } from '@angular/core';
import { Storage } from '@ionic/storage-angular';
import { STORAGE_KEY } from '../../models/constants';

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

  async clearAllData(): Promise<void> {
    await this.storage.clear()
    // Ionic Storage only knows its own store. The diagnostics log keeps a second copy of its tail
    // in localStorage (see DiagnosticsService), written synchronously because a page that is going
    // away cannot be trusted to finish an IndexedDB write, and "apagar todos os dados" has to
    // reach it too.
    try {
      localStorage.removeItem(STORAGE_KEY.DIAGNOSTICS_LOG)
    } catch {
      // Site data is blocked: there is nothing stored to remove.
    }
  }

}
