import { Injectable } from '@angular/core';
import JSZip from 'jszip';
import { SaveBackupHelper } from '../../helpers/save-backup.helper';
import { DiagnosticsService } from '../shared/diagnostics.service';
import { SaveStatusService } from '../shared/save-status.service';

/** Where emulators-ui keeps the changed part of the virtual disk (see readStoredChanges). */
const JS_DOS_SAVES_DATABASE = 'js-dos-cache (emulators-ui-saves)';

/** The saves backup, built and not yet handed to the player. */
export interface SavesBackup {
  bytes: Uint8Array;
  /** The DOS names inside, upper case. */
  names: string[];
  fileName: string;
}

/** How a backup left the app. `cancelled` is a share sheet the player closed: nothing left. */
export type BackupDelivery = 'downloaded' | 'shared' | 'cancelled';

@Injectable({
  providedIn: 'root'
})
export class SaveGameService {
  /** The persist now running or queued last: the next one starts when it settles. */
  private persistTail: Promise<unknown> = Promise.resolve()

  constructor(private diagnostics: DiagnosticsService, private status: SaveStatusService) { }

  /**
   * Flush the emulator's changes to IndexedDB (`layers.save()`), one flush at a time. Every persist
   * in the app passes through here, from the auto-saver, the chip, a page going hidden and leaving
   * the game, and a second `layers.save()` started while the first is still reading the disk is
   * not something the emulator promises to cope with, so a caller that arrives meanwhile waits its
   * turn (the auto-saver serialises its own too; the two compose). It is also where
   * SaveStatusService hears about it, which is what the toolbar chip says.
   *
   * It has no deadline of its own: a flush that never settles holds the queue (and the chip's
   * "Salvando…") rather than let a second one start on top of it. Each caller bounds its own wait
   * instead (`SaveSafetyService.persist`, the auto-saver), so a stuck flush costs a failed save
   * the player can decide about, never a loader that stays.
   */
  saveGame(): Promise<void> {
    const run = this.persistTail.then(() => this.persistOnce(), () => this.persistOnce())
    this.persistTail = run.catch(() => undefined)
    return run
  }

  private async persistOnce(): Promise<void> {
    const began = performance.now()
    const token = this.status.persistStarted()
    try {
      await saveGameFileSystem()
      this.status.persistSucceeded(token)
      this.diagnostics.log('save', 'layers.save ok', () => ({ ms: Math.round(performance.now() - began) }))
    } catch (error) {
      this.status.persistFailed()
      this.diagnostics.log('save', 'layers.save failed', () => ({ ms: Math.round(performance.now() - began), error }))
      throw error
    }
  }

  /**
   * The saves backup of the running game, or null when it has no save. Built from what
   * `dosCI.persist()` returns (the live changed files, not what was last written to IndexedDB), as
   * a flat zip of `NAME.E98` that "Importar jogos salvos" reads back (SaveBackupHelper).
   */
  async prepareSavesBackup(dosCI: any): Promise<SavesBackup | null> {
    if(!dosCI) {
      console.warn('dosCI is not defined');
      return null
    }

    const built = await SaveBackupHelper.build(await dosCI.persist())
    if (!built) {
      return null
    }
    return { ...built, fileName: SaveBackupHelper.backupFileName(new Date()) }
  }

  /**
   * Hand the backup to the player: through the system share sheet (`how` = 'share', which the
   * caller only asks for where the browser can share a file), or as a download. Either counts as a
   * backup for the reminder, except a share sheet that was closed without choosing anything.
   *
   * **Call it straight from the tap's handler when sharing.** Safari honours `navigator.share()`
   * only while the tap is the current user gesture, and building the zip is asynchronous, so the
   * game page builds first and shares from a button of its own; everything here before the share
   * is synchronous. A share that fails for any reason but the player closing it falls back to a
   * download rather than losing the backup.
   */
  async deliverBackup(backup: SavesBackup, how: 'download' | 'share'): Promise<BackupDelivery> {
    if (how === 'share') {
      const file = this.backupFile(backup)
      try {
        await navigator.share({ files: [file], title: 'Backup do Elifoot 98' })
        this.status.recordBackup()
        return 'shared'
      } catch (error) {
        if ((error as DOMException | undefined)?.name === 'AbortError') {
          return 'cancelled'
        }
        console.warn('Sharing the backup failed; downloading it instead', error)
        this.diagnostics.log('save', 'share failed; downloading', () => ({ error }))
      }
    }

    this.saveUint8ArrayAsFile(backup.bytes, backup.fileName)
    this.status.recordBackup()
    return 'downloaded'
  }

  /** The backup as a `File`, which is what the share sheet takes. */
  backupFile(backup: SavesBackup): File {
    return new File([backup.bytes as BlobPart], backup.fileName, { type: 'application/zip' })
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
    const zipContent = await zip.generateAsync({ type: 'uint8array' });
    this.saveUint8ArrayAsFile(zipContent, `fullDiskChanges_${SaveBackupHelper.fileStamp(new Date())}.zip`)
    this.status.recordBackup()
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
    this.saveUint8ArrayAsFile(changes, `fullDiskChanges_${SaveBackupHelper.fileStamp(new Date())}.zip`)
    this.status.recordBackup()
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
        reject(open.error ?? new Error(`Não foi possível abrir o armazenamento ${databaseName}.`))
      }
      open.onblocked = () => reject(new Error(`A abertura do armazenamento ${databaseName} está bloqueada. Feche as outras abas do jogo e tente de novo.`))
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
            reject(cursor.error ?? new Error(`Não foi possível ler o armazenamento ${databaseName}.`))
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

  private saveUint8ArrayAsFile(uint8Array: Uint8Array, fileName: string): void {
    const blob = new Blob([uint8Array as BlobPart], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
  
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
  
    document.body.appendChild(link);
    link.click();
  
    document.body.removeChild(link);
    // Not at once: Safari starts the download after this returns, and a revoked URL is an empty file.
    setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
  }
}
