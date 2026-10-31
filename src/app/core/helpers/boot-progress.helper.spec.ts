import { BootProgressHelper } from './boot-progress.helper';

describe('BootProgressHelper.describe', () => {

  it('shows the download as a whole percent, rounded down', () => {
    expect(BootProgressHelper.describe('Downloading bundle 43.21%')).toBe('Baixando o jogo… 43%');
    expect(BootProgressHelper.describe('Downloading bundle 43.99%')).toBe('Baixando o jogo… 43%');
    expect(BootProgressHelper.describe('Downloading bundle 0.17%')).toBe('Baixando o jogo… 0%');
  });

  it('reads 100% only when js-dos says 100', () => {
    // 99.96 must not round up to a finished-looking 100 while the last bytes are still coming.
    expect(BootProgressHelper.describe('Downloading bundle 99.96%')).toBe('Baixando o jogo… 99%');
    expect(BootProgressHelper.describe('Downloading bundle 100%')).toBe('Baixando o jogo… 100%');
  });

  it('has a line for the moment before the first percentage', () => {
    // js-dos writes "Downloading bundle ..." until the first progress event with a known size.
    expect(BootProgressHelper.describe('Downloading bundle ...')).toBe('Baixando o jogo…');
  });

  it('shows unpacking with its percentage and drops the file name', () => {
    expect(BootProgressHelper.describe('Extracting 61% (hdd.img)')).toBe('Descompactando o jogo… 61%');
    expect(BootProgressHelper.describe('Extracting 100% (ELIFOOT.BAT)')).toBe('Descompactando o jogo… 100%');
  });

  it('names the first step', () => {
    expect(BootProgressHelper.describe('Starting...')).toBe('Iniciando o emulador…');
  });

  it('ignores whitespace around js-dos\'s text', () => {
    expect(BootProgressHelper.describe('  Downloading bundle 5%\n')).toBe('Baixando o jogo… 5%');
  });

  it('keeps the previous line for text that is not progress', () => {
    // "Ready" hands over to the stage labels, and "Unexpected error occured..." is js-dos
    // rethrowing: neither may show up as a status line.
    expect(BootProgressHelper.describe('Ready')).toBeNull();
    expect(BootProgressHelper.describe('Unexpected error occured...')).toBeNull();
    expect(BootProgressHelper.describe('Connecting...')).toBeNull();
    expect(BootProgressHelper.describe('')).toBeNull();
    expect(BootProgressHelper.describe(null)).toBeNull();
    expect(BootProgressHelper.describe(undefined)).toBeNull();
  });

  it('clamps a percentage that arrives out of range', () => {
    expect(BootProgressHelper.describe('Downloading bundle 250%')).toBe('Baixando o jogo… 100%');
  });

  describe('status', () => {

    it('keeps the phase and the percentage apart', () => {
      expect(BootProgressHelper.status('Downloading bundle 43.21%')).toEqual({ phase: 'download', message: 'Baixando o jogo… 43%', percent: 43 });
      expect(BootProgressHelper.status('Extracting 61% (hdd.img)')).toEqual({ phase: 'extract', message: 'Descompactando o jogo… 61%', percent: 61 });
    });

    it('has no percentage before js-dos reports one, and none for starting the emulator', () => {
      expect(BootProgressHelper.status('Downloading bundle ...')).toEqual({ phase: 'download', message: 'Baixando o jogo…', percent: null });
      expect(BootProgressHelper.status('Starting...')).toEqual({ phase: 'emulator', message: 'Iniciando o emulador…', percent: null });
    });

    it('is null for text that is not progress, and describe() agrees with it for every input', () => {
      for (const text of ['Ready', 'Unexpected error occured...', 'Connecting...', '', null, undefined, 'Downloading bundle 5%', 'Extracting 100% (A.B)', 'Starting...']) {
        expect(BootProgressHelper.describe(text)).toBe(BootProgressHelper.status(text)?.message ?? null);
      }
    });
  });

  describe('logStep', () => {

    it('puts every percentage of a ten-percent band on the same step', () => {
      expect(BootProgressHelper.logStep('Downloading bundle 40.0%')).toBe('Downloading bundle 40%');
      expect(BootProgressHelper.logStep('Downloading bundle 43.2%')).toBe('Downloading bundle 40%');
      expect(BootProgressHelper.logStep('Downloading bundle 49.99%')).toBe('Downloading bundle 40%');
    });

    it('moves to the next step at the next ten', () => {
      expect(BootProgressHelper.logStep('Downloading bundle 50.0%')).toBe('Downloading bundle 50%');
      expect(BootProgressHelper.logStep('Extracting 100% (ELIFOOT.BAT)')).toBe('Extracting 100%');
    });

    it('drops the file name js-dos appends while unpacking, which changes on every event', () => {
      expect(BootProgressHelper.logStep('Extracting 91% (EGA80WOA.FON)')).toBe(BootProgressHelper.logStep('Extracting 93% (VGAOEM.FON)'));
      expect(BootProgressHelper.logStep('Extracting 61% (hdd.img)')).toBe('Extracting 60%');
      expect(BootProgressHelper.logStep('Extracting 99% ()')).toBe('Extracting 90%');
    });

    it('keeps the phases apart', () => {
      expect(BootProgressHelper.logStep('Extracting 45% (hdd.img)')).not.toBe(BootProgressHelper.logStep('Downloading bundle 45%'));
    });

    it('passes text without a percentage through, trimmed', () => {
      expect(BootProgressHelper.logStep('  Starting...\n')).toBe('Starting...');
      expect(BootProgressHelper.logStep(null)).toBe('');
    });

    it('turns a thousand download events into about ten lines', () => {
      const steps = new Set<string>();
      for (let n = 0; n <= 1000; n++) steps.add(BootProgressHelper.logStep(`Downloading bundle ${(n / 10).toFixed(1)}%`));

      expect(steps.size).toBe(11);
    });
  });
});
