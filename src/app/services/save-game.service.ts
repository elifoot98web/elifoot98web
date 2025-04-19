import { Injectable } from '@angular/core';
import * as JSZip from 'jszip';

@Injectable({
  providedIn: 'root'
})
export class SaveGameService {
  constructor() { }

  async saveGame(): Promise<void> {
    await saveGameFileSystem()
  }

  async downloadGameSaves(dosCI: any): Promise<boolean> {
    const rawChanges = await dosCI.persist()
    let zip = new JSZip()
    zip = await zip.loadAsync(rawChanges, { createFolders: true })
    
    let hasSaves = false
    // remove non save game files
    let filesToRemove = zip.filter((_, file) => {
      return !file.name.toLowerCase().includes('eli98/jogos/') && file.name.toLowerCase() !=('d/eli98/')
    })
    filesToRemove.forEach(file => {
      zip.remove(file.name)
    })

    // Preparing to move files to the root of the zip
    zip.forEach((_, file) => {
      if (file.name.toLowerCase().includes('.e98')) {
        hasSaves = true
        file.name = file.name.replace('d/eli98/jogos/', '')
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
    // Clear all data from the game
    dosCI.pause()
    await dosCI.exit()

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

  private saveUint8ArrayAsFile(uint8Array: Uint8Array, fileName: string): void {
    const blob = new Blob([uint8Array], { type: 'application/octet-stream' });
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
