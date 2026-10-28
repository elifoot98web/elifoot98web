import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DosCI } from '../../typings/jsdos';
import { lastValueFrom } from 'rxjs';
import { BASE_SAVEGAME_DIR } from '../../models/constants';
import JSZip from 'jszip';

/**
 * Every `Error` thrown from here ends up in the game page's error dialog verbatim, so each
 * message is Portuguese and says what to do next. The technical cause (JSZip's and
 * HttpClient's own messages are English) goes to the console at the catch site instead.
 */
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
      throw new Error('Não foi possível obter o ELIFOOT.BAT do patch. Verifique sua conexão e tente novamente.')
    }

    // Get patch.bat
    const patchBatBlob = await this.getPatchBatchFile()
    if(!patchBatBlob) {
      throw new Error('Não foi possível obter o PATCH.BAT. Verifique sua conexão e tente novamente.')
    }

    // Prepare and load local changes
    const localChanges = await this.getClearLocalChanges(dosCI)

    // Override elifoot.bat with the patched one
    localChanges.file('d/ELIFOOT.BAT', patchedElifootBatBlob, { binary: true })

    // Add patch.bat
    localChanges.file('d/PATCH.BAT', patchBatBlob, { binary: true })   

    // Merge patch file with local changes
    // Add patch files
    localChanges.file('d/eli98/PATCH', 'patch', { dir: true })
    patch.forEach((_, file) => {
      const path = `d/eli98/PATCH/${file.name}`
      file.name = path
      localChanges.files[path] = file
    })

    console.log("Patched zip", {localChanges})
    
    await this.overwriteEmulatorsUICache(localChanges)
  }

  async processPatchFile(patchFile: File): Promise<JSZip> {
    if (!patchFile) {
      throw new Error('Nenhum arquivo foi selecionado.')
    }
    
    // Load patch file. JSZip's own rejection ("Can't find end of central directory...") is
    // English and says nothing a person can act on.
    let patch: JSZip
    try {
      patch = await JSZip.loadAsync(await patchFile.arrayBuffer(), { createFolders: true })
    } catch (error) {
      console.error('Patch file could not be read as a zip', error)
      throw new Error('O arquivo selecionado não é um ZIP válido. Escolha um patch do Elifoot 98 em formato .zip.')
    }
    
    // Sanitize input patch file to only contain .EFT files on the root
    const originalFiles = patch.files
    patch.files = {}

    // Flags, ctrgroup and countries files
    const supportFiles: {[key: string]: JSZip.JSZipObject} = {}
    const equipasFiles: {[key: string]: JSZip.JSZipObject} = {}

    // TODO: Optimize this loop
    for(let filePath in originalFiles) {
      const file = originalFiles[filePath]
      file.dosPermissions = null
      file.unixPermissions = null
      if (file.name.toLowerCase().endsWith('.eft')) {
        const rootedName = file.name.split('/').pop() || "undefined.eft"
        file.name = `EQUIPAS/${rootedName}`
        equipasFiles[file.name] = file
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

    // validate equipas dictionary, if filled has at least 34 .eft files
    if (Object.keys(equipasFiles).length > 0 && Object.keys(equipasFiles).length < 34) {
      throw new Error('Não há equipes suficientes para jogar. O patch deve conter pelo menos 34 arquivos .EFT.')
    }

    // merge equipasFiles and support files to the patch object
    Object.assign(patch.files, equipasFiles)
    Object.assign(patch.files, supportFiles)

    return patch
  }

  /**
   * 
   * @param file - Save(s) to be validated
   * @returns 
   */
  async prepareSaveFilePatch(file: File): Promise<JSZip> {
    if (!file) {
      throw new Error('Nenhum arquivo foi selecionado.')
    }

    // Check if the file is a .e98 file
    if (!file.name.toLowerCase().endsWith('.e98')) {
      throw new Error('Tipo de arquivo inválido. Escolha um jogo salvo do Elifoot 98 (arquivo .e98).')
    }

    const fileName = file.name.toUpperCase()
    const zip = new JSZip()
    // load .e98 file in the zip
    await zip.file(BASE_SAVEGAME_DIR + fileName, file.arrayBuffer())

    return zip
  }

  async applySaveFilePatch(dosCI: DosCI, patch: JSZip) {
    // Get local changes
    const localChanges = await this.getLocalChanges(dosCI)
    if (!localChanges) {
      throw new Error('Não foi possível ler os dados do jogo. Recarregue a página e tente novamente.')
    }
    
    Object.assign(localChanges.files, patch.files)
    console.log("Patched zip", {localChanges})
    await this.overwriteEmulatorsUICache(localChanges)
  }

  private async getAssetFile(assetFilePath: string): Promise<Blob> {
    try {
      return await lastValueFrom(this.httpClient.get(`assets/${assetFilePath}`, { 
        responseType: 'blob',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      }))
    } catch (error) {
      // HttpErrorResponse's message is English ("Http failure response for ...").
      console.error(`Could not download assets/${assetFilePath}`, error)
      throw new Error(`Não foi possível baixar um arquivo necessário (${assetFilePath.split('/').pop()}). Verifique sua conexão e tente novamente.`)
    }
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
    const localChanges = await this.getLocalChanges(dosCI)

    // clear existing patch files
    const filesToRemove = localChanges.filter((_, file) => {
      return file.name.toLowerCase().startsWith('d/eli98/patch') || 
        file.name.toLowerCase().includes('elifoot.bat') ||
        file.name.toLowerCase().includes('patch.bat') ||
        file.name.toLowerCase().includes('d/eli98/country.txe') ||
        file.name.toLowerCase().includes('d/eli98/referee.txe') ||
        file.name.toLowerCase().includes('d/eli98/flags') ||
        file.name.toLowerCase().includes('d/eli98/equipas') ||
        file.name.toLowerCase().includes('d/eli98/ctrgroup')
    })

    filesToRemove.forEach(file => {
      localChanges.remove(file.name)
    })

    return localChanges
  }

  private async getLocalChanges(dosCI: DosCI): Promise<JSZip> {
    try {
      await saveGameFileSystem()
      const rawChanges = await dosCI.persist()
      return await JSZip.loadAsync(rawChanges)
    } catch (error) {
      console.error('Could not read the emulator changes', error)
      throw new Error('Não foi possível ler os dados do jogo. Recarregue a página e tente novamente.')
    }
  }
}
