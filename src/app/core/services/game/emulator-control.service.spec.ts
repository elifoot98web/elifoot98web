import { NgZone } from '@angular/core';
import { DosCI } from '../../typings/jsdos';
import { EmulatorControlService } from './emulator-control.service';
import { OcrWorker, OcrWorkerHost } from './ocr-worker-host';
import { silentDiagnostics } from '../shared/diagnostics.testing';

/**
 * What `isGameSaving` answers is a contract with the auto-saver, which persists the moment the
 * dialog is gone: `null` ("could not read") has to stay apart from `false` ("not there").
 */
describe('EmulatorControlService.isGameSaving', () => {
  let service: EmulatorControlService;
  let ready: jasmine.Spy;
  let recognize: jasmine.Spy;
  let startOcr: jasmine.Spy;

  /** A frame whose strip differs from every other `seed`, so each one is a strip not read yet. */
  function frame(seed = 0, width = 800, height = 600): ImageData {
    const image = new ImageData(width, height);
    image.data[((height / 2 - 25 + 5) * width + (width / 2 - 68 + 5)) * 4] = seed;
    return image;
  }

  function emulator(screenshot: () => Promise<ImageData | null>): DosCI {
    return { screenshot } as unknown as DosCI;
  }

  function reads(text: string): void {
    recognize.and.resolveTo({ data: { text } });
  }

  beforeEach(() => {
    spyOn(console, 'log');
    spyOn(console, 'warn');
    spyOn(console, 'error');

    service = new EmulatorControlService({} as never, new NgZone({ enableLongStackTrace: false }), silentDiagnostics());
    recognize = jasmine.createSpy('recognize');
    const worker: OcrWorker = { recognize: recognize as never, terminate: () => Promise.resolve() };
    const host = (service as unknown as { ocr: OcrWorkerHost }).ocr;
    ready = spyOnProperty(host, 'ready', 'get').and.returnValue(worker);
    startOcr = spyOn(service, 'startOcr');
  });

  it('is true when the strip reads "a gravar o jogo..."', async () => {
    reads('À gravar o jogo...');

    expect(await service.isGameSaving(emulator(async () => frame()))).toBeTrue();
  });

  it('is false for the other dialogs that sit where this one does', async () => {
    reads('A iniciar o jogo...');
    expect(await service.isGameSaving(emulator(async () => frame(1)))).toBeFalse();

    reads('A carregar o jogo...');
    expect(await service.isGameSaving(emulator(async () => frame(2)))).toBeFalse();
  });

  it('is false when the strip holds nothing legible', async () => {
    reads('');

    expect(await service.isGameSaving(emulator(async () => frame()))).toBeFalse();
  });

  it('is null, not false, when the read fails', async () => {
    recognize.and.rejectWith(new Error('worker died'));

    expect(await service.isGameSaving(emulator(async () => frame()))).toBeNull();
  });

  it('is null when the strip cannot be turned into an image', async () => {
    spyOn(HTMLCanvasElement.prototype, 'getContext').and.returnValue(null);

    expect(await service.isGameSaving(emulator(async () => frame()))).toBeNull();
    expect(recognize).not.toHaveBeenCalled();
  });

  it('is null while there is no worker, and asks for one to be started', async () => {
    ready.and.returnValue(null);

    expect(await service.isGameSaving(emulator(async () => frame()))).toBeNull();
    expect(startOcr).toHaveBeenCalledTimes(1);
    expect(recognize).not.toHaveBeenCalled();
  });

  it('is null when the emulator has no frame to give', async () => {
    expect(await service.isGameSaving(emulator(async () => null))).toBeNull();
  });

  it('lets a failing screenshot through, so the caller knows the emulator stopped answering', async () => {
    await expectAsync(service.isGameSaving(emulator(() => Promise.reject(new Error('gone')))))
      .toBeRejectedWithError('gone');
  });

  describe('the verdict cache', () => {
    it('answers an unchanged strip with what it said last time, without reading it again', async () => {
      reads('À gravar o jogo...');
      const dosCI = emulator(async () => frame());

      expect(await service.isGameSaving(dosCI)).toBeTrue();
      expect(await service.isGameSaving(dosCI)).toBeTrue();
      expect(recognize).toHaveBeenCalledTimes(1);
    });

    it('reads again as soon as the strip changes', async () => {
      reads('À gravar o jogo...');
      expect(await service.isGameSaving(emulator(async () => frame(1)))).toBeTrue();

      reads('');
      expect(await service.isGameSaving(emulator(async () => frame(2)))).toBeFalse();
      expect(recognize).toHaveBeenCalledTimes(2);
    });

    it('does not remember a read that failed', async () => {
      const dosCI = emulator(async () => frame());

      recognize.and.rejectWith(new Error('worker died'));
      expect(await service.isGameSaving(dosCI)).toBeNull();

      reads('À gravar o jogo...');
      expect(await service.isGameSaving(dosCI)).toBeTrue();
      expect(recognize).toHaveBeenCalledTimes(2);
    });

    it('forgets everything when OCR is stopped', async () => {
      reads('À gravar o jogo...');
      const dosCI = emulator(async () => frame());
      await service.isGameSaving(dosCI);

      service.stopOcr();
      await service.isGameSaving(dosCI);

      expect(recognize).toHaveBeenCalledTimes(2);
    });
  });
});
