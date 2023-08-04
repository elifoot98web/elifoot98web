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
    let filesToRemove = zip.filter((_, file) => {
      return !file.name.toLowerCase().includes('eli98/jogos/') && file.name.toLowerCase() !=('eli98/')
    })

    console.log({filesToRemove})
    filesToRemove.forEach(file => {
      zip.remove(file.name)
    })

    zip.forEach((_, file) => {
      if (file.name.toLowerCase().includes('.e98')) {
        file.name = file.name.replace('eli98/jogos/', '')
      }
    })

    let originalFiles = zip.files
    console.log({originalFiles})
    
    zip.files = {}
    
    for(let filePath in originalFiles) {
      const file = originalFiles[filePath]
      if (file.name.toLowerCase().endsWith('.e98')) {
        zip.files[file.name] = file
      }
    }

    console.log({zip})
    let content = await zip.generateAsync({ type: 'uint8array' })
    const dateTime = new Date()
    const dateTimeString = `${dateTime.getDate()}-${dateTime.getMonth()}-${dateTime.getFullYear()}_${dateTime.getHours()}-${dateTime.getMinutes()}-${dateTime.getSeconds()}`
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
