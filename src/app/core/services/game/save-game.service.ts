import { Injectable } from '@angular/core';
import { BASE_SAVEGAME_DIR } from '../../models/constants';
import JSZip from 'jszip';
import { DiagnosticsService } from '../shared/diagnostics.service';

/** Where emulators-ui keeps the changed part of the virtual disk (see readStoredChanges). */
const JS_DOS_SAVES_DATABASE = 'js-dos-cache (emulators-ui-saves)';

@Injectable({
  providedIn: 'root'
})
export class SaveGameService {
  constructor(private diagnostics: DiagnosticsService) { }

  async saveGame(): Promise<void> {
    const began = performance.now()
    try {
      await saveGameFileSystem()
      this.diagnostics.log('save', 'layers.save ok', () => ({ ms: Math.round(performance.now() - began) }))
    } catch (error) {
      this.diagnostics.log('save', 'layers.save failed', () => ({ ms: Math.round(performance.now() - began), error }))
      throw error
    }
  }

  async downloadGameSaves(dosCI: any): Promise<boolean> {
    if(!dosCI) {
      console.warn('dosCI is not defined');
      return false
    }

    const rawChanges = await dosCI.persist()
    let zip = new JSZip()
    zip = await zip.loadAsync(rawChanges, { createFolders: true })
    
    let hasSaves = false
    let accumulatedPath = ''
    
    // remove non save game files
    const keptDirectories: string[] = BASE_SAVEGAME_DIR.split('/').filter(dir => !!dir).map((dir) => {
      accumulatedPath += dir + '/'
      return accumulatedPath
    })

    let filesToRemove = zip.filter((_, file) => {
      return !file.name.toLowerCase().includes(BASE_SAVEGAME_DIR) && !keptDirectories.includes(file.name.toLowerCase())
    })
    filesToRemove.forEach(file => {
      zip.remove(file.name)
    })

    // Preparing to move files to the root of the zip
    zip.forEach((_, file) => {
      if (file.name.toLowerCase().includes('.e98')) {
        hasSaves = true
        file.name = file.name.replace(BASE_SAVEGAME_DIR, '')
      }
    })

    if(!hasSaves){
      return false
    }

    let originalFiles = zip.files
    
    // Clearing file list
    zip.files = {}
    
    // Adding only save game files
    for(let filePath in originalFiles) {
      const file = originalFiles[filePath]
      if (file.name.toLowerCase().endsWith('.e98')) {
        zip.files[file.name] = file
      }
    }

    // generate zip file
    let content = await zip.generateAsync({ 
      type: 'uint8array', 
      compression: 'DEFLATE',
      compressionOptions: {
        level: 9
      }
    })
    
    // save zip file
    const dateTime = new Date()
    dateTime.toISOString()
    const dateTimeString = `${dateTime.getFullYear()}-${dateTime.getMonth()}-${dateTime.getDate()}_${dateTime.getHours()}-${dateTime.getMinutes()}-${dateTime.getSeconds()}`
    this.saveUint8ArrayAsFile(content, `saveGames_${dateTimeString}.zip`)
    return true
  }

  async downloadFullDiskChanges(dosCI: any): Promise<boolean> {
    if(!dosCI) {
      console.warn('dosCI is not defined');
      return false
    }

    const rawChanges = await dosCI.persist()
    let zip = new JSZip()
    zip = await zip.loadAsync(rawChanges, { createFolders: true })
    let hasChanges = zip && zip.files && Object.keys(zip.files).length > 0;
    if (!hasChanges) {
      console.log('No changes to save');
      return false;
    }
    
    // Save the zip file
    const dateTime = new Date()
    dateTime.toISOString()
    const dateTimeString = `${dateTime.getFullYear()}-${dateTime.getMonth()}-${dateTime.getDate()}_${dateTime.getHours()}-${dateTime.getMinutes()}-${dateTime.getSeconds()}`
    const zipContent = await zip.generateAsync({ type: 'uint8array' });
    this.saveUint8ArrayAsFile(zipContent, `fullDiskChanges_${dateTimeString}.zip`)
    return true; 
  }

  async clearAllData(dosCI: any): Promise<void> {
    // Clear all data from the game. With no emulator there is nothing to stop, but the databases
    // still have to go: the boot-failure dialog offers this wipe when the emulator never started,
    // and returning early here made that button reload the page with the broken disk intact.
    if(dosCI) {
      dosCI.pause()
      await dosCI.exit()
    } else {
      console.warn('dosCI is not defined; clearing the stored data without stopping an emulator');
    }

    // clear all data from indexedDB 
    const dbs = await indexedDB.databases();

    for (const db of dbs) {
      if(db.name?.startsWith('js-dos-cache')) {
        const name = db.name || ''
        await new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = () => {
            console.log(`Database ${db.name} deleted successfully`);
            resolve()
          };
          request.onerror = () => {
            console.error(`Error deleting database ${db.name}`);
            resolve()
          };
          request.onblocked = () => {
            console.warn(`Database ${db.name} deletion blocked`);
            resolve()
          };
        })
      }
    }
    console.log('All data cleared');
  }

  /**
   * The changes layer exactly as js-dos left it in IndexedDB, read WITHOUT an emulator. This is
   * what the boot-failure dialog offers before a wipe, when `dosCI` is null and
   * {@link downloadFullDiskChanges} cannot run.
   *
   * js-dos keeps it in the database "js-dos-cache (emulators-ui-saves)", store "files", under
   * "<bundle url>.changes", as the zip's ArrayBuffer: the same bytes `dosCI.persist()` returns.
   * Every database whose name starts with "js-dos-cache" is looked at rather than that one name,
   * the way {@link clearAllData} deletes them, so a renamed cache is still found. A browser
   * without `indexedDB.databases()` (Firefox before 126) cannot list them, so it is asked for
   * the one name js-dos uses. That name may not exist: the failure this is offered for includes
   * `js-dos.js` never loading, so nothing has created it. Opening a missing database creates it
   * at version 1 without its store, and js-dos would then open it at version 1 too, never run
   * its upgrade and fail every later save with NotFoundError, so {@link readChangesFrom} aborts
   * the upgrade instead.
   *
   * Resolves null when there is nothing to read, and never creates a database. A layer js-dos
   * could not load is not necessarily unreadable here, which is the point of asking before
   * wiping it.
   */
  async readStoredChanges(): Promise<Uint8Array | null> {
    if (typeof indexedDB === 'undefined') {
      return null
    }

    const names = typeof indexedDB.databases === 'function'
      ? (await indexedDB.databases()).map(info => info.name ?? '').filter(name => name.startsWith('js-dos-cache'))
      : [JS_DOS_SAVES_DATABASE]

    let best: Uint8Array | null = null
    for (const name of names) {
      const found = await this.readChangesFrom(name)
      if (found && (best == null || found.byteLength > best.byteLength)) {
        best = found
      }
    }
    return best
  }

  /** Download what {@link readStoredChanges} finds; false when there is nothing to download. */
  async downloadStoredChanges(): Promise<boolean> {
    const changes = await this.readStoredChanges()
    if (changes == null) {
      return false
    }
    this.saveUint8ArrayAsFile(changes, `fullDiskChanges_${this.fileTimestamp(new Date())}.zip`)
    return true
  }

  /** The largest ".changes" entry of one js-dos cache database, or null (also when it does not exist). */
  private readChangesFrom(databaseName: string): Promise<Uint8Array | null> {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open(databaseName)
      let missing = false
      // An upgrade here means the database did not exist and this open is about to create it.
      // Looking must not do that, so the creating transaction is aborted; the open then fails
      // with AbortError, which onerror below reads as "nothing stored".
      open.onupgradeneeded = () => {
        missing = true
        open.transaction?.abort()
      }
      open.onerror = () => {
        if (missing) {
          resolve(null)
          return
        }
        reject(open.error ?? new Error(`Can't open ${databaseName}`))
      }
      open.onblocked = () => reject(new Error(`Opening ${databaseName} is blocked`))
      open.onsuccess = () => {
        const db = open.result
        let largest: Uint8Array | null = null
        try {
          if (!db.objectStoreNames.contains('files')) {
            db.close()
            resolve(null)
            return
          }
          const cursor = db.transaction('files', 'readonly').objectStore('files').openCursor()
          cursor.onerror = () => {
            db.close()
            reject(cursor.error ?? new Error(`Can't read ${databaseName}`))
          }
          cursor.onsuccess = () => {
            const entry = cursor.result
            if (!entry) {
              db.close()
              resolve(largest)
              return
            }
            const value = entry.value
            if (String(entry.key).endsWith('.changes') && value instanceof ArrayBuffer
              && value.byteLength > (largest?.byteLength ?? 0)) {
              largest = new Uint8Array(value)
            }
            entry.continue()
          }
        } catch (error) {
          db.close()
          reject(error)
        }
      }
    })
  }

  /** yyyy-mm-dd_hh-mm-ss in local time; the older file names count months from 0. */
  private fileTimestamp(date: Date): string {
    const two = (value: number) => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}_`
      + `${two(date.getHours())}-${two(date.getMinutes())}-${two(date.getSeconds())}`
  }

  private saveUint8ArrayAsFile(uint8Array: Uint8Array, fileName: string): void {
    const blob = new Blob([uint8Array.buffer as ArrayBuffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
  
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
  
    document.body.appendChild(link);
    link.click();
  
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}
