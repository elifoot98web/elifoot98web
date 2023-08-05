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

  async downloadGameSaves(dosCI: any): Promise<void> {
    const rawChanges = await dosCI.persist()
    let zip = new JSZip()
    zip = await zip.loadAsync(rawChanges, { createFolders: true })
    
    // remove non save game files
    let filesToRemove = zip.filter((_, file) => {
      return !file.name.toLowerCase().includes('eli98/jogos/') && file.name.toLowerCase() !=('eli98/')
    })
    filesToRemove.forEach(file => {
      zip.remove(file.name)
    })

    // Preparing to move files to the root of the zip
    zip.forEach((_, file) => {
      if (file.name.toLowerCase().includes('.e98')) {
        file.name = file.name.replace('eli98/jogos/', '')
      }
    })

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
    const dateTime = new Date()
    dateTime.toISOString()
    const dateTimeString = `${dateTime.getFullYear()}-${dateTime.getMonth()}-${dateTime.getDate()}_${dateTime.getHours()}-${dateTime.getMinutes()}-${dateTime.getSeconds()}`
    this.saveUint8ArrayAsFile(content, `saveGames_${dateTimeString}.zip`)
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
