import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import JSZip from 'jszip';
import { of, throwError } from 'rxjs';
import { BASE_SAVEGAME_DIR } from '../../models/constants';
import { DosCI } from '../../typings/jsdos';
import { PatchService } from './patch.service';

/**
 * Every Error this service throws is shown to the player verbatim by the game page's error
 * dialog, so the contract under test is the wording: Portuguese, and never the English that
 * JSZip and HttpClient reject with.
 *
 * Plain fakes cast to the constructor's types, as in the other service specs. The emulator
 * side (`saveGameFileSystem`, `dosInstance`) is a pair of browser globals installed by
 * game.js, so the specs that reach it install and remove a stand-in.
 */
describe('PatchService error messages', () => {
  const noHttp = { get: () => of(new Blob()) } as unknown as HttpClient;

  function service(http: HttpClient = noHttp): PatchService {
    return new PatchService(http);
  }

  const globals = window as unknown as Record<string, unknown>;

  beforeEach(() => {
    // A rejected parse is logged for a bug report; keep the test output clean.
    spyOn(console, 'error');
  });

  afterEach(() => {
    delete globals['saveGameFileSystem'];
  });

  describe('processPatchFile', () => {
    it('asks for a file when none was chosen', async () => {
      await expectAsync(service().processPatchFile(undefined as unknown as File))
        .toBeRejectedWithError('Nenhum arquivo foi selecionado.');
    });

    it('explains a file that is not a zip, instead of passing JSZip\'s message on', async () => {
      const notAZip = new File(['isto não é um zip'], 'patch.zip');

      const failure = await service().processPatchFile(notAZip).then(() => null, error => error as Error);

      expect(failure?.message).toBe('O arquivo selecionado não é um ZIP válido. Escolha um patch do Elifoot 98 em formato .zip.');
      expect(failure?.message).not.toMatch(/central directory/i);
    });

    it('still refuses a patch with too few teams, in Portuguese as before', async () => {
      const zip = new JSZip();
      for (let team = 0; team < 3; team++) zip.file(`TIME${team}.EFT`, 'x');
      const patch = new File([await zip.generateAsync({ type: 'arraybuffer' })], 'patch.zip');

      await expectAsync(service().processPatchFile(patch))
        .toBeRejectedWithError('Não há equipes suficientes para jogar. O patch deve conter pelo menos 34 arquivos .EFT.');
    });
  });

  describe('prepareSaveFilePatch', () => {
    it('asks for a file when none was chosen', async () => {
      await expectAsync(service().prepareSaveFilePatch(undefined as unknown as File))
        .toBeRejectedWithError('Nenhum arquivo foi selecionado.');
    });

    it('says which kind of file it wants when given another', async () => {
      await expectAsync(service().prepareSaveFilePatch(new File(['x'], 'jogo.txt')))
        .toBeRejectedWithError('Tipo de arquivo inválido. Escolha um jogo salvo do Elifoot 98 (arquivo .e98).');
    });

    it('accepts a save in any letter case and stores it upper-cased under the save directory', async () => {
      const zip = await service().prepareSaveFilePatch(new File(['dados'], 'Meu Jogo.E98'));

      const files = Object.values(zip.files).filter(entry => !entry.dir).map(entry => entry.name);
      expect(files).toEqual([`${BASE_SAVEGAME_DIR}MEU JOGO.E98`]);
    });
  });

  describe('when the machinery underneath fails', () => {
    it('reports a bat file that cannot be downloaded without HttpClient\'s English', async () => {
      const offline = {
        get: () => throwError(() => new HttpErrorResponse({ status: 0, url: 'assets/elifoot/ELIFOOT.BAT' })),
      } as unknown as HttpClient;

      const failure = await service(offline).applyPatch({} as DosCI, new JSZip()).then(() => null, error => error as Error);

      expect(failure?.message).toBe('Não foi possível baixar um arquivo necessário (ELIFOOT.BAT). Verifique sua conexão e tente novamente.');
    });

    it('reports an emulator whose changes cannot be read', async () => {
      globals['saveGameFileSystem'] = () => Promise.resolve();
      const broken = { persist: () => Promise.reject(new Error('worker is gone')) } as unknown as DosCI;

      await expectAsync(service().applySaveFilePatch(broken, new JSZip()))
        .toBeRejectedWithError('Não foi possível ler os dados do jogo. Recarregue a página e tente novamente.');
    });

    it('reports it the same way when there is no emulator at all', async () => {
      globals['saveGameFileSystem'] = () => Promise.resolve();

      await expectAsync(service().applySaveFilePatch(undefined as unknown as DosCI, new JSZip()))
        .toBeRejectedWithError('Não foi possível ler os dados do jogo. Recarregue a página e tente novamente.');
    });
  });
});

/**
 * The display mode is one file in the changes layer, so what matters is what the layer holds after
 * the call and where it was written. The emulator side is stood in for: a `persist()` that returns
 * a layer shaped like js-dos's (hdd.img, a save game, directory entries) and a `dosInstance` whose
 * `emulatorsUi.persist.save` records the fake CI it was handed, which is how the real thing is
 * overwritten (see overwriteEmulatorsUICache).
 */
describe('PatchService.setDisplayMode', () => {
  const noHttp = { get: () => of(new Blob()) } as unknown as HttpClient;
  const globals = window as unknown as Record<string, unknown>;
  const FLAG = 'd/res/use800.flg';
  const HDD = new Uint8Array([1, 2, 3, 4, 5]);
  const SAVE = new Uint8Array([9, 8, 7]);

  let calls: string[];
  let written: { key: string; ci: { persist(): Promise<Uint8Array> } } | undefined;

  async function layer(extra: (zip: JSZip) => void = () => undefined): Promise<Uint8Array> {
    const zip = new JSZip();
    zip.file('hdd.img', HDD);
    zip.file(`${BASE_SAVEGAME_DIR}MEUJOGO.E98`, SAVE);
    extra(zip);
    return zip.generateAsync({ type: 'uint8array' });
  }

  function emulator(persisted: Uint8Array): DosCI {
    return { persist: () => { calls.push('persist'); return Promise.resolve(persisted); } } as unknown as DosCI;
  }

  /** What the call left in the layer, read back through the fake CI like js-dos would. */
  async function writtenLayer(): Promise<JSZip> {
    return JSZip.loadAsync(await written!.ci.persist());
  }

  beforeEach(() => {
    // The service narrates its work to the console (the patched zip, its persisting); keep it out of the run.
    spyOn(console, 'log');
    calls = [];
    written = undefined;
    globals['saveGameFileSystem'] = () => { calls.push('flush'); return Promise.resolve(); };
    globals['dosInstance'] = {
      layers: {},
      emulatorsUi: { persist: { save: (key: string, _layers: unknown, ci: { persist(): Promise<Uint8Array> }) => { written = { key, ci }; } } },
    };
  });

  afterEach(() => {
    delete globals['saveGameFileSystem'];
    delete globals['dosInstance'];
  });

  it('asks for 800x600 by adding the flag, and leaves the disk and the saves as they were', async () => {
    await new PatchService(noHttp).setDisplayMode(emulator(await layer()), '800');

    const result = await writtenLayer();
    expect(result.file(FLAG)).not.toBeNull();
    expect(await result.file('hdd.img')!.async('uint8array')).toEqual(HDD);
    expect(await result.file(`${BASE_SAVEGAME_DIR}MEUJOGO.E98`)!.async('uint8array')).toEqual(SAVE);
  });

  it('goes back to the default by removing the flag, and nothing else', async () => {
    const withFlag = await layer(zip => zip.file(FLAG, 'x'));

    await new PatchService(noHttp).setDisplayMode(emulator(withFlag), '640');

    const result = await writtenLayer();
    expect(result.file(FLAG)).toBeNull();
    expect(await result.file('hdd.img')!.async('uint8array')).toEqual(HDD);
    expect(await result.file(`${BASE_SAVEGAME_DIR}MEUJOGO.E98`)!.async('uint8array')).toEqual(SAVE);
  });

  it('is the same call whichever way the player was already set', async () => {
    const service = new PatchService(noHttp);

    await service.setDisplayMode(emulator(await layer()), '640');
    expect((await writtenLayer()).file(FLAG)).toBeNull();

    await service.setDisplayMode(emulator(await layer(zip => zip.file(FLAG, 'x'))), '800');
    expect((await writtenLayer()).file(FLAG)).not.toBeNull();
  });

  it('writes under the key js-dos loads the layer from, which is the bundle URL plus ".changes"', async () => {
    await new PatchService(noHttp).setDisplayMode(emulator(await layer()), '800');

    // A different key would be a layer nothing reads: the player would reload into the old mode.
    expect(written?.key).toBe('assets/elifoot/elifoot98.jsdos.changes');
  });

  it('flushes the running disk first, so the layer it edits is the current one', async () => {
    await new PatchService(noHttp).setDisplayMode(emulator(await layer()), '800');

    expect(calls).toEqual(['flush', 'persist', 'flush']);
  });

  it('writes nothing when the layer cannot be read, and says so in Portuguese', async () => {
    const broken = { persist: () => Promise.reject(new Error('worker is gone')) } as unknown as DosCI;
    spyOn(console, 'error');

    const failure = await new PatchService(noHttp).setDisplayMode(broken, '800').then(() => null, error => error as Error);

    expect(failure?.message).toBe('Não foi possível ler os dados do jogo. Recarregue a página e tente novamente.');
    expect(written).toBeUndefined();
  });

  it('keeps the chosen mode through a patch and through removing it', async () => {
    const withFlag = await layer(zip => zip.file(FLAG, 'x'));
    const service = new PatchService(noHttp);

    await service.applyPatch(emulator(withFlag), new JSZip());
    expect((await writtenLayer()).file(FLAG)).not.toBeNull();

    await service.clearPatch(emulator(withFlag));
    expect((await writtenLayer()).file(FLAG)).not.toBeNull();
  });
});

