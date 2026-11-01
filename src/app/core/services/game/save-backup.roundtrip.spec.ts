import { HttpClient } from '@angular/common/http';
import JSZip from 'jszip';
import { of } from 'rxjs';
import { BASE_SAVEGAME_DIR } from '../../models/constants';
import { SaveBackupHelper } from '../../helpers/save-backup.helper';
import { DosCI } from '../../typings/jsdos';
import { silentDiagnostics } from '../shared/diagnostics.testing';
import { PatchService } from './patch.service';
import { SaveGameService } from './save-game.service';

/**
 * The backup the app exports must be one the app imports, through the two services the game page
 * actually calls and a stand-in emulator that keeps its changed files in a zip like js-dos's.
 * (save-backup.helper.spec.ts proves the same one layer down; this proves nothing between the two
 * lost it, and that the saves land where the game looks for them.)
 */
describe('The saves backup round trip', () => {
  const globals = window as unknown as Record<string, unknown>;
  const noHttp = { get: () => of(new Blob()) } as unknown as HttpClient;
  const status = { persistStarted: () => ({ seq: 0 }), persistSucceeded: () => undefined, persistFailed: () => undefined, recordBackup: () => undefined };

  /** An emulator holding `files` (path to content) as its changed files. */
  function emulator(files: Record<string, string>) {
    let current: Promise<Uint8Array> = (async () => {
      const zip = new JSZip();
      zip.file('hdd.img', new Uint8Array([7, 7, 7]));
      for (const [path, content] of Object.entries(files)) zip.file(path, content);
      return zip.generateAsync({ type: 'uint8array' });
    })();
    return {
      dosCI: { persist: () => current } as unknown as DosCI,
      /** What the page will boot from after the import: whatever the patch wrote into the layer. */
      replaceWith: (written: Promise<Uint8Array>) => { current = written; },
      layer: () => current,
    };
  }

  let written: { ci: { persist(): Promise<Uint8Array> } } | undefined;

  beforeEach(() => {
    spyOn(console, 'log');
    spyOn(console, 'warn');
    written = undefined;
    globals['saveGameFileSystem'] = () => Promise.resolve();
    globals['dosInstance'] = {
      layers: {},
      emulatorsUi: { persist: { save: (_key: string, _layers: unknown, ci: { persist(): Promise<Uint8Array> }) => { written = { ci }; } } },
    };
  });

  afterEach(() => {
    delete globals['saveGameFileSystem'];
    delete globals['dosInstance'];
  });

  it('puts every exported save back where the game keeps it, with the same bytes', async () => {
    const original = emulator({
      [`${BASE_SAVEGAME_DIR}MEUJOGO.E98`]: 'o meu jogo',
      [`${BASE_SAVEGAME_DIR}OUTRO.E98`]: 'outro, com acentos: João',
      [`${BASE_SAVEGAME_DIR}DRLIST.ELI`]: 'not a save',
    });
    const exporter = new SaveGameService(silentDiagnostics(), status as never);
    const backup = await exporter.prepareSavesBackup(original.dosCI);
    expect(backup).not.toBeNull();

    // On another browser: a game with one of the same saves (older) and one other.
    const fresh = emulator({
      [`${BASE_SAVEGAME_DIR}MEUJOGO.E98`]: 'versão antiga',
      [`${BASE_SAVEGAME_DIR}NAOTOCAR.E98`]: 'fica como está',
    });
    const importer = new PatchService(noHttp);
    const file = new File([backup!.bytes as BlobPart], backup!.fileName, { type: 'application/zip' });

    const plan = await importer.prepareSaveFilesPatch([file]);
    const overwrites = SaveBackupHelper.overwrites(plan.saves, await importer.existingSaveNames(fresh.dosCI));
    await importer.applySaveFilePatch(fresh.dosCI, plan.patch);

    expect(plan.saves.map(save => save.name).sort()).toEqual(['MEUJOGO.E98', 'OUTRO.E98']);
    expect(overwrites).toEqual(['MEUJOGO.E98']);
    const after = await JSZip.loadAsync(await written!.ci.persist());
    expect(await after.file(`${BASE_SAVEGAME_DIR}MEUJOGO.E98`)!.async('string')).toBe('o meu jogo');
    expect(await after.file(`${BASE_SAVEGAME_DIR}OUTRO.E98`)!.async('string')).toBe('outro, com acentos: João');
    expect(await after.file(`${BASE_SAVEGAME_DIR}NAOTOCAR.E98`)!.async('string')).toBe('fica como está');
    expect(await after.file('hdd.img')!.async('uint8array')).toEqual(new Uint8Array([7, 7, 7]));
  });

  it('takes the single .e98 files too, several at a time', async () => {
    const importer = new PatchService(noHttp);

    const plan = await importer.prepareSaveFilesPatch([
      new File(['um'], 'Um.e98'),
      new File(['dois'], 'DOIS.E98'),
    ]);

    expect(plan.saves.map(save => save.name)).toEqual(['UM.E98', 'DOIS.E98']);
    expect(Object.keys(plan.patch.files).filter(path => path.endsWith('.E98')))
      .toEqual([`${BASE_SAVEGAME_DIR}UM.E98`, `${BASE_SAVEGAME_DIR}DOIS.E98`]);
  });

  it('takes the full-disk copy the boot-failure dialog offers, for its saves', async () => {
    const source = emulator({ [`${BASE_SAVEGAME_DIR}RESGATE.E98`]: 'salvo da falha' });
    const file = new File([await source.layer() as BlobPart], 'fullDiskChanges_2026-10-05_04-03-02.zip');

    const plan = await new PatchService(noHttp).prepareSaveFilesPatch([file]);

    expect(plan.saves.map(save => save.name)).toEqual(['RESGATE.E98']);
  });
});
