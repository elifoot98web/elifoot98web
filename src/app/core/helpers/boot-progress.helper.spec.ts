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
});
