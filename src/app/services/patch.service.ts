import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import * as JSZip from 'jszip';
import { DosCI } from '../models/jsdos';
import { lastValueFrom } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class PatchService {

  constructor(private httpClient: HttpClient) { }
  
  async clearPatch(dosCI: DosCI) {
    const cleanChanges = await this.getClearLocalChanges(dosCI)
    await this.overwriteEmulatorsUICache(cleanChanges)
  }

  async applyPatch(dosCI: DosCI, patch: JSZip) {
    // Get patched elifoot.bat
    const patchedElifootBatBlob = await this.getElifootBatchFile()
    if(!patchedElifootBatBlob) {
      throw new Error('Could not get patched elifoot.bat')
    }

    // Get patch.bat
    const patchBatBlob = await this.getPatchBatchFile()
    if(!patchBatBlob) {
      throw new Error('Could not get patch.bat')
    }

    // Prepare and load local changes
    const localChanges = await this.getClearLocalChanges(dosCI)

    // Override elifoot.bat with the patched one
    localChanges.file('ELIFOOT.BAT', patchedElifootBatBlob, { binary: true })

    // Add patch.bat
    localChanges.file('PATCH.BAT', patchBatBlob, { binary: true })   

    // Merge patch file with local changes
    // Add patch files
    localChanges.file('eli98/PATCH', 'patch', { dir: true })
    patch.forEach((_, file) => {
      const path = `eli98/PATCH/${file.name}`
      file.name = path
      localChanges.files[path] = file
    })

    console.log("Patched zip", {localChanges})
    
    await this.overwriteEmulatorsUICache(localChanges)
  }

  async processPatchFile(patchFile: File): Promise<JSZip> {
    if (!patchFile) {
      throw new Error('No file provided')
    }
    
    // Load patch file
    const patch = await JSZip.loadAsync(await patchFile.arrayBuffer(), { createFolders: true })
    
    // Sanitize input patch file to only contain .EFT files on the root
    const originalFiles = patch.files
    patch.files = {}

    // Flags, ctrgroup and countries files
    const supportFiles: {[key: string]: JSZip.JSZipObject} = {}

    // TODO: Optimize this loop
    for(let filePath in originalFiles) {
      const file = originalFiles[filePath]
      file.dosPermissions = null
      file.unixPermissions = null
      if (file.name.toLowerCase().endsWith('.eft')) {
        const rootedName = file.name.split('/').pop() || "undefined.eft"
        file.name = `EQUIPAS/${rootedName}`
        patch.files[file.name] = file
      } else if (file.name.toLowerCase().endsWith('country.txe')) {
        file.name = 'COUNTRY.TXE'
        supportFiles[file.name] = file
      } else if (file.name.toLowerCase().endsWith('referee.txe')) {
        file.name = 'REFEREE.TXE'
        supportFiles[file.name] = file
      } else if (file.name.toLowerCase().includes('ctrgroup') && file.name.toLowerCase().endsWith('.txe')) {
        const rootedName = file.name.split('/').pop() || "undefined.TXE"
        file.name = `CTRGROUP/${rootedName}`
        supportFiles[file.name] = file
      } else if (file.name.toLowerCase().includes('flags') && file.name.toLowerCase().endsWith('.bmp')) {
        const rootedName = file.name.split('/').pop() || "undefined.BMP"
        file.name = `FLAGS/${rootedName}`
        supportFiles[file.name] = file
      }
    }

    // validate patch has at least 34 .eft files
    if (Object.keys(patch.files).length < 34) {
      throw new Error('Não há equipes suficientes para jogar')
    }

    // merge support files to patch object
    Object.assign(patch.files, supportFiles)
    return patch
  }

  private async getAssetFile(assetFilePath: string): Promise<Blob> {
    return await lastValueFrom(this.httpClient.get(`assets/${assetFilePath}`, { responseType: 'blob' }))
  }

  private getElifootBatchFile(): Promise<Blob> {
    return this.getAssetFile('elifoot/ELIFOOT.BAT')
  }

  private getPatchBatchFile(): Promise<Blob> {
    return this.getAssetFile('elifoot/PATCH.BAT')
  }

  private async overwriteEmulatorsUICache(patch: JSZip) {
    // tricking the emulator-ui to use the patched zip instead of ci.persist()
    const fakeCI = {
      persist: async () => {
        console.log("Persisting patched zip")
        return await patch.generateAsync({ 
          type: 'uint8array', 
          compression: 'DEFLATE',
          compressionOptions: {
            level: 9
          }
        })
      }
    }

    const bundleName = "assets/elifoot/elifoot98.jsdos.changes"

    dosInstance.emulatorsUi.persist.save(bundleName, dosInstance.layers, fakeCI)
    await saveGameFileSystem()
  }

  private async getClearLocalChanges(dosCI: DosCI): Promise<JSZip> {
    await saveGameFileSystem()
    const rawChanges = await dosCI.persist()
    const localChanges = await JSZip.loadAsync(rawChanges)
    
    // clear existing patch files
    const filesToRemove = localChanges.filter((_, file) => {
      return file.name.toLowerCase().startsWith('eli98/patch') || 
        file.name.toLowerCase() == 'elifoot.bat' ||
        file.name.toLowerCase() == 'patch.bat' ||
        file.name.toLowerCase() == 'country.txe' ||
        file.name.toLowerCase() == 'referee.txe' ||
        file.name.toLowerCase().startsWith('eli98/flags') ||
        file.name.toLowerCase().startsWith('eli98/equipas') ||
        file.name.toLowerCase().startsWith('eli98/ctrgroup')
    })

    filesToRemove.forEach(file => {
      localChanges.remove(file.name)
    })

    return localChanges
  }
}
