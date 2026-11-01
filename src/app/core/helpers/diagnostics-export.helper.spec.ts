import { DiagnosticsExportHelper, DiagnosticsExportNavigator } from './diagnostics-export.helper';

const TEXT = '=== relatório ===\nlinha';
const NAME = 'elifoot98-diagnostico-20261028-140322.txt';

describe('DiagnosticsExportHelper', () => {

  describe('share', () => {

    it('is unsupported where there is no share sheet', async () => {
      expect(DiagnosticsExportHelper.canShare({})).toBeFalse();
      expect(await DiagnosticsExportHelper.share({}, TEXT, NAME)).toBe('unsupported');
    });

    it('hands over a .txt file when the browser can take one', async () => {
      const share = jasmine.createSpy('share').and.resolveTo(undefined);
      const nav: DiagnosticsExportNavigator = { share, canShare: () => true };

      expect(await DiagnosticsExportHelper.share(nav, TEXT, NAME)).toBe('done');

      const sent = share.calls.mostRecent().args[0];
      expect(sent.text).toBeUndefined();
      expect(sent.files.length).toBe(1);
      expect(sent.files[0].name).toBe(NAME);
      expect(await sent.files[0].text()).toBe(TEXT);
    });

    it('falls back to the text itself when files are refused', async () => {
      const share = jasmine.createSpy('share').and.resolveTo(undefined);

      expect(await DiagnosticsExportHelper.share({ share, canShare: () => false }, TEXT, NAME)).toBe('done');

      expect(share.calls.mostRecent().args[0]).toEqual({ title: 'Diagnóstico do Elifoot 98', text: TEXT });
    });

    it('falls back to the text when the browser has share but not canShare', async () => {
      const share = jasmine.createSpy('share').and.resolveTo(undefined);

      await DiagnosticsExportHelper.share({ share }, TEXT, NAME);

      expect(share.calls.mostRecent().args[0].text).toBe(TEXT);
    });

    it('calls share as a method of navigator: a detached share() throws "Illegal invocation"', async () => {
      let receiver: unknown;
      const nav = { share(this: unknown) { receiver = this; return Promise.resolve(); } };

      await DiagnosticsExportHelper.share(nav, TEXT, NAME);

      expect(receiver).toBe(nav);
    });

    it('treats a dismissed sheet as cancelled, not as a failure', async () => {
      const abort = Object.assign(new Error('Share canceled'), { name: 'AbortError' });
      const nav: DiagnosticsExportNavigator = { share: () => Promise.reject(abort) };

      expect(await DiagnosticsExportHelper.share(nav, TEXT, NAME)).toBe('cancelled');
    });

    it('reports any other refusal as a failure (NotAllowedError when the gesture lapsed)', async () => {
      const refused = Object.assign(new Error('not allowed'), { name: 'NotAllowedError' });
      const nav: DiagnosticsExportNavigator = { share: () => Promise.reject(refused) };

      expect(await DiagnosticsExportHelper.share(nav, TEXT, NAME)).toBe('failed');
    });
  });

  describe('copy', () => {

    it('writes to the clipboard where it can', async () => {
      const writeText = jasmine.createSpy('writeText').and.resolveTo(undefined);

      expect(await DiagnosticsExportHelper.copy({ clipboard: { writeText } }, document, TEXT)).toBe('done');

      expect(writeText).toHaveBeenCalledWith(TEXT);
    });

    it('writes before it awaits anything, so the tap is still the current gesture', () => {
      const writeText = jasmine.createSpy('writeText').and.returnValue(new Promise(() => undefined));

      void DiagnosticsExportHelper.copy({ clipboard: { writeText } }, document, TEXT);

      expect(writeText).toHaveBeenCalledTimes(1);
    });

    it('falls back to selecting a hidden textarea when the clipboard refuses', async () => {
      const field = { value: '', style: { cssText: '' }, setAttribute: () => undefined, select: jasmine.createSpy('select'), setSelectionRange: jasmine.createSpy('range') };
      const body = { appendChild: jasmine.createSpy('append'), removeChild: jasmine.createSpy('remove') };
      const doc = { createElement: () => field, body, execCommand: jasmine.createSpy('execCommand').and.returnValue(true) } as unknown as Document;
      const nav: DiagnosticsExportNavigator = { clipboard: { writeText: () => Promise.reject(new Error('denied')) } };

      expect(await DiagnosticsExportHelper.copy(nav, doc, TEXT)).toBe('done');

      expect(field.value).toBe(TEXT);
      expect(doc.execCommand).toHaveBeenCalledWith('copy');
      expect(body.removeChild).toHaveBeenCalledWith(field);
    });

    it('fails, and still cleans up, when nothing can copy', async () => {
      const field = { value: '', style: { cssText: '' }, setAttribute: () => undefined, select: () => undefined, setSelectionRange: () => undefined };
      const body = { appendChild: jasmine.createSpy('append'), removeChild: jasmine.createSpy('remove') };
      const doc = { createElement: () => field, body, execCommand: () => { throw new Error('unsupported'); } } as unknown as Document;

      expect(await DiagnosticsExportHelper.copy({}, doc, TEXT)).toBe('failed');
      expect(body.removeChild).toHaveBeenCalledWith(field);
    });
  });

  describe('download', () => {

    it('clicks a link to an object URL named after the report, and removes it again', () => {
      const link = { href: '', download: '', click: jasmine.createSpy('click') };
      const body = { appendChild: jasmine.createSpy('append'), removeChild: jasmine.createSpy('remove') };
      const doc = { createElement: () => link, body } as unknown as Document;
      spyOn(URL, 'createObjectURL').and.returnValue('blob:test');
      const revoke = spyOn(URL, 'revokeObjectURL');
      jasmine.clock().install();
      try {
        DiagnosticsExportHelper.download(doc, TEXT, NAME);

        expect(link.href).toBe('blob:test');
        expect(link.download).toBe(NAME);
        expect(link.click).toHaveBeenCalledTimes(1);
        expect(body.removeChild).toHaveBeenCalledWith(link);
        // Not at once: Safari saves the file after the click returns.
        expect(revoke).not.toHaveBeenCalled();
        jasmine.clock().tick(10000);
        expect(revoke).toHaveBeenCalledWith('blob:test');
      } finally {
        jasmine.clock().uninstall();
      }
    });
  });
});
