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
