import { BootFailureHelper } from './boot-failure.helper';

function timeout(lastProgress?: string): Error {
  const error = new Error('jsdos wrote no progress for 20 seconds');
  error.name = 'JsdosTimeoutError';
  return Object.assign(error, { lastProgress });
}

describe('BootFailureHelper.kindOf', () => {

  it('recognises the timeout by its name, not its message', () => {
    expect(BootFailureHelper.kindOf(timeout())).toBe('timeout');
    const renamed = new Error('anything at all');
    renamed.name = 'JsdosTimeoutError';
    expect(BootFailureHelper.kindOf(renamed)).toBe('timeout');
  });

  it('does not take a message that merely mentions a timeout for one', () => {
    expect(BootFailureHelper.kindOf(new Error('jsdos timed out after 15 seconds'))).toBe('other');
  });

  it('calls js-dos\'s download failures "network", which cover a 404 as well as being offline', () => {
    expect(BootFailureHelper.kindOf(new Error('Network error, can\'t download assets/elifoot/elifoot98.jsdos'))).toBe('network');
    expect(BootFailureHelper.kindOf(new Error('Request canceled for url assets/elifoot/elifoot98.jsdos'))).toBe('network');
  });

  it('calls a file js-dos\'s worker could not fetch "network": that is what an offline start with a gap in the cache says', () => {
    expect(BootFailureHelper.kindOf(new Error('Unable to download \'assets/js-dos/wdosbox.js\', code: 504'))).toBe('network');
    expect(BootFailureHelper.kindOf(new Error('Unable to download \'assets/js-dos/wdosbox.wasm\', code: 0'))).toBe('network');
  });

  it('calls a failed fetch "network" in the wording of each engine', () => {
    expect(BootFailureHelper.kindOf(new TypeError('Failed to fetch'))).toBe('network');
    expect(BootFailureHelper.kindOf(new TypeError('Load failed'))).toBe('network');
    expect(BootFailureHelper.kindOf(new Error('NetworkError when attempting to fetch resource.'))).toBe('network');
  });

  it('calls missing emulator scripts "network": js-dos.js never loaded', () => {
    expect(BootFailureHelper.kindOf(new ReferenceError('emulators is not defined'))).toBe('network');
    expect(BootFailureHelper.kindOf(new ReferenceError('Dos is not defined'))).toBe('network');
    expect(BootFailureHelper.kindOf(new ReferenceError('foo is not defined'))).toBe('other');
  });

  it('calls anything else "other": the emulator itself threw', () => {
    expect(BootFailureHelper.kindOf(new Error('WebAssembly.instantiate(): out of memory'))).toBe('other');
    expect(BootFailureHelper.kindOf(new Error('Unable to create 2d context on given canvas'))).toBe('other');
  });

  it('calls the worker\'s panic "other": a saved layer that reads but is not a zip fails there, and the wipe is its way out', () => {
    // js-dos rejects run() with Error(JSON.stringify(panicMessages)) when the worker panics.
    const panic = new Error(JSON.stringify(['Unable to extract bundle archive\n']));
    expect(BootFailureHelper.kindOf(panic)).toBe('other');
    expect(BootFailureHelper.offersWipe(BootFailureHelper.kindOf(panic), 3)).toBeTrue();
  });

  it('copes with what is not an Error', () => {
    expect(BootFailureHelper.kindOf('Network error, can\'t download x')).toBe('network');
    expect(BootFailureHelper.kindOf({ message: 'Failed to fetch' })).toBe('network');
    expect(BootFailureHelper.kindOf(undefined)).toBe('other');
    expect(BootFailureHelper.kindOf(null)).toBe('other');
    expect(BootFailureHelper.kindOf(42)).toBe('other');
  });
});

describe('BootFailureHelper.offersWipe', () => {

  it('offers it only for the emulator\'s own failures', () => {
    expect(BootFailureHelper.offersWipe('other', 3)).toBeTrue();
    expect(BootFailureHelper.offersWipe('network', 3)).toBeFalse();
    expect(BootFailureHelper.offersWipe('network', 30)).toBeFalse();
    expect(BootFailureHelper.offersWipe('timeout', 30)).toBeFalse();
  });

  it('waits for the third failure in a row', () => {
    expect(BootFailureHelper.offersWipe('other', 1)).toBeFalse();
    expect(BootFailureHelper.offersWipe('other', 2)).toBeFalse();
    expect(BootFailureHelper.offersWipe('other', 3)).toBeTrue();
    expect(BootFailureHelper.offersWipe('other', 4)).toBeTrue();
  });
});

describe('BootFailureHelper.timeoutMessage', () => {

  it('says where it stopped, in Portuguese', () => {
    const message = BootFailureHelper.timeoutMessage(timeout('Downloading bundle 43.21%'));
    expect(message).toContain('O jogo está demorando mais do que o normal para iniciar.');
    expect(message).toContain('Última etapa: Baixando o jogo… 43%');
  });

  it('reassures about the saved games', () => {
    expect(BootFailureHelper.timeoutMessage(timeout())).toContain('Seus jogos salvos não foram afetados.');
  });

  it('leaves the step out when the last text was not progress', () => {
    expect(BootFailureHelper.timeoutMessage(timeout(''))).not.toContain('Última etapa');
    expect(BootFailureHelper.timeoutMessage(timeout('Unexpected error occured...'))).not.toContain('Última etapa');
    expect(BootFailureHelper.timeoutMessage(timeout())).not.toContain('Última etapa');
    expect(BootFailureHelper.timeoutMessage(new Error('x'))).not.toContain('Última etapa');
  });

  it('never shows js-dos\'s English', () => {
    const message = BootFailureHelper.timeoutMessage(timeout('Extracting 61% (hdd.img)'));
    expect(message).not.toMatch(/Extracting|Downloading|timed out|progress/i);
    expect(message).toContain('Descompactando o jogo… 61%');
  });
});

describe('BootFailureHelper.failureMessage', () => {

  it('explains a missing download as a connection problem', () => {
    const message = BootFailureHelper.failureMessage('network', 1);
    expect(message).toContain('Não foi possível baixar os arquivos do jogo.');
    expect(message).toContain('conexão');
  });

  it('explains an emulator failure without blaming the connection', () => {
    const message = BootFailureHelper.failureMessage('other', 1);
    expect(message).toContain('O emulador não conseguiu iniciar');
    expect(message).not.toContain('conexão');
  });

  it('counts the attempts from the second on', () => {
    expect(BootFailureHelper.failureMessage('other', 1)).not.toContain('tentativas');
    expect(BootFailureHelper.failureMessage('other', 2)).toContain('2 tentativas seguidas falharam.');
  });

  it('mentions the wipe, and the backup to take first, exactly when the dialog offers the wipe', () => {
    for (const kind of ['network', 'other'] as const) {
      for (const failures of [1, 2, 3, 4]) {
        const message = BootFailureHelper.failureMessage(kind, failures);
        expect(/apaga os jogos salvos/.test(message))
          .withContext(`${kind} x${failures}`)
          .toBe(BootFailureHelper.offersWipe(kind, failures));
      }
    }
    expect(BootFailureHelper.failureMessage('other', 3)).toContain('Baixe uma cópia deles antes.');
  });
});
