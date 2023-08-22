import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import * as JSZip from 'jszip';
import { DosCI } from '../interfaces/jsdos';
import { lastValueFrom } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class PatchService {

  constructor(private httpClient: HttpClient) { }

  async applyPatch(dosCI: DosCI, patch: JSZip) {
    // load local changes
    await saveGameFileSystem()
    const rawChanges = await dosCI.persist()
    let localChanges = await JSZip.loadAsync(rawChanges)

    const patchedElifootBatBlob = await this.getElifootBatchFile()

    if(!patchedElifootBatBlob) {
      throw new Error('Could not get patched elifoot.bat')
    }
    // Override elifoot.bat with the patched one
    localChanges.file('ELIFOOT.BAT', patchedElifootBatBlob, { binary: true })

    // Remove existing .EFT files
    let filesToRemove = localChanges.filter((_, file) => {
      return file.name.toLowerCase().endsWith('.eft')
    })

    filesToRemove.forEach(file => {
      localChanges.remove(file.name)
    })    

    // Merge patch file with local changes
    // Add patch files
    localChanges.file('eli98/PATCH', 'patch', { dir: true })
    patch.forEach((_, file) => {
      const path = `eli98/PATCH/${file.name}`
      file.name = path
      localChanges.files[path] = file
    })
    
    await this.overwriteEmulatorsUICache(dosCI, localChanges)

  }

  async processPatchFile(patchFile: File): Promise<JSZip> {
    if (!patchFile) {
      throw new Error('No file provided')
    }
    
    // Load patch file
    const patch = await JSZip.loadAsync(await patchFile.arrayBuffer(), { createFolders: true })
    
    // Sanitize input patch file to only contain .EFT files on the root
    let originalFiles = patch.files
    patch.files = {}
    for(let filePath in originalFiles) {
      const file = originalFiles[filePath]
      if (file.name.toLowerCase().endsWith('.eft')) {
        const rootedName = file.name.split('/').pop() || "undefined.eft"
        file.name = rootedName
        patch.files[rootedName] = file
      }
    }

    // validate patch has at least 34 files
    if (Object.keys(patch.files).length < 34) {
      throw new Error('Não há equipes suficientes para jogar')
    }

    return patch
  }

  private async getElifootBatchFile(): Promise<Blob> {
    const response = await lastValueFrom(this.httpClient.get('assets/elifoot/ELIFOOT.BAT', { responseType: 'blob' }))
    return response
  }

  private async overwriteEmulatorsUICache(dosCI: DosCI, patch: JSZip) {
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

}
