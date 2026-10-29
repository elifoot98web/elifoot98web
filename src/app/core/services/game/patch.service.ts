import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DosCI } from '../../typings/jsdos';
import { lastValueFrom } from 'rxjs';
import { BASE_SAVEGAME_DIR, DISPLAY_MODE } from '../../models/constants';
import { DisplayMode } from '../../helpers/display-mode.helper';
import { BackupInput, BackupReading, BackupSave, SaveBackupHelper } from '../../helpers/save-backup.helper';
import JSZip from 'jszip';

/** What an import will do, ready to be shown and then applied. */
export interface SaveImportPlan extends BackupReading {
  /** The saves under `d/eli98/jogos/`, in the shape `applySaveFilePatch` merges into the disk. */
  patch: JSZip;
  saves: BackupSave[];
}

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

  /**
   * Choose the video mode of the NEXT boot, by adding or removing `d/res/use800.flg` in the saved
   * disk. `d/SETRES.BAT` (run from dosbox.conf before Windows starts) looks for that file and
   * copies the matching SYSTEM.INI over the guest's own, so the choice survives every bundle
   * update and needs nothing from hdd.img. The default, with no flag, is 640x480.
   *
   * Nothing changes until the page reloads, and the caller has to do that: this only rewrites the
   * layer, with the same fake-CI trick as a patch, after which `layers.save()` no longer persists
   * the running VM (see overwriteEmulatorsUICache), so the emulator must not be played on.
   * The mode in force is not asked of this service; it is read off the live framebuffer
   * (DisplayModeHelper), and the flag is never mirrored into storage.
   */
  async setDisplayMode(dosCI: DosCI, mode: DisplayMode) {
    const changes = await this.getLocalChanges(dosCI)

    if (mode === '800') {
      // JSZip makes the missing `d/res/` folder entry on its own (createFolders defaults to true).
      changes.file(DISPLAY_MODE.FLAG_PATH, '800x600\r\n')
    } else {
      // Only the file: the folder entry may be holding nothing else, but a layer is allowed an
      // empty directory, and removing a folder in JSZip removes everything under it.
      changes.remove(DISPLAY_MODE.FLAG_PATH)
    }

    await this.overwriteEmulatorsUICache(changes)
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
   * Read what the player picked for "Importar jogos salvos": `.e98` files and `.zip` backups, any
   * number of them (see SaveBackupHelper for what is taken from a zip), and lay the saves out
   * where the guest keeps them. Nothing is written yet; the caller shows the plan first.
   */
  async prepareSaveFilesPatch(files: readonly File[]): Promise<SaveImportPlan> {
    if (!files || files.length === 0) {
      throw new Error('Nenhum arquivo foi selecionado.')
    }

    let inputs: BackupInput[]
    try {
      inputs = await Promise.all(files.map(async file => ({ name: file.name, data: await file.arrayBuffer() })))
    } catch (error) {
      // A file the phone has not downloaded yet (a cloud drive), or one it can no longer reach.
      console.error('A picked file could not be read', error)
      throw new Error('Não foi possível ler o arquivo escolhido. Se ele estiver na nuvem, baixe-o para o aparelho e tente de novo.')
    }

    const reading = await SaveBackupHelper.read(inputs)
    if (reading.saves.length === 0) {
      const supported = inputs.some(input => /\.(e98|zip)$/i.test(input.name))
      if (!supported) {
        throw new Error('Tipo de arquivo inválido. Escolha jogos salvos do Elifoot 98 (arquivos .e98) ou um backup em .zip.')
      }
      if (reading.unreadable.length > 0) {
        throw new Error('O arquivo selecionado não é um ZIP válido. Escolha um backup exportado pelo jogo (.zip) ou jogos salvos (.e98).')
      }
      throw new Error('Nenhum jogo salvo (.e98) foi encontrado nos arquivos escolhidos.')
    }

    const patch = new JSZip()
    for (const save of reading.saves) {
      patch.file(BASE_SAVEGAME_DIR + save.name, save.data)
    }
    return { patch, ...reading }
  }

  /**
   * The saves the running game already has, for the import's confirm dialog to flag the ones it
   * would replace. Read from the live changed files, like the export, so a save made a second ago
   * counts.
   */
  async existingSaveNames(dosCI: DosCI): Promise<string[]> {
    try {
      return await SaveBackupHelper.existingNames(await dosCI.persist())
    } catch (error) {
      console.error('Could not list the saves in the emulator', error)
      throw new Error('Não foi possível ler os dados do jogo. Recarregue a página e tente novamente.')
    }
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

    // clear existing patch files. Matching is by name, and nothing under `d/res/` (the display
    // mode flag) contains any of these, so a patch or its removal keeps the player's resolution.
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
