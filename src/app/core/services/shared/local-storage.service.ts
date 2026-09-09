import { Injectable } from '@angular/core';
import { Storage } from '@ionic/storage-angular';

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
  }

}
