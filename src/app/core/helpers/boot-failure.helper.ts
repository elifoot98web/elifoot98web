import { GAME_BOOT } from '../models/constants';
import { BootProgressHelper } from './boot-progress.helper';

/**
 * What kind of failure ended the boot, which decides what the dialog offers:
 *
 * - `timeout`: js-dos is still working, only slowly. Never counted as a failure, never wipes,
 *   never reloads by itself. Waiting more or starting over are the user's call.
 * - `network`: the files never arrived (offline, a 404, a server error). Counted, but a wipe
 *   cannot fix it, so it is not offered.
 * - `other`: the emulator itself threw. The only kind where clearing the saved disk can be the
 *   fix, so it is the only one that can lead to the wipe.
 */
export type BootFailureKind = 'timeout' | 'network' | 'other';

/**
 * Sorts what `elifootMain` rejected with, and says it in Portuguese. js-dos's own messages are
 * English and mean nothing to the person reading the dialog; they stay in the console.
 * Kept free of Angular so it can be tested on plain errors.
 */
export class BootFailureHelper {

  static kindOf(error: unknown): BootFailureKind {
    if ((error as { name?: unknown } | null)?.name === 'JsdosTimeoutError') return 'timeout';

    const message = BootFailureHelper.messageOf(error);
    // js-dos's bundle download rejects with "Network error, can't download <url>" for ANY status
    // other than 200, and "Request canceled for url". Its worker says "Unable to download
    // '<file>', code: 504" when wdosbox.js or the wasm cannot be fetched (504 is what the
    // service worker answers offline). Safari words a failed fetch "Load failed". The
    // ReferenceError is the other way the files can be missing: js-dos.js never loaded, so
    // `emulators` / `Dos` do not exist.
    if (/network error|can't download|unable to download|request canceled|failed to fetch|networkerror|load failed/i.test(message)
      || /\b(?:emulators|Dos) is not defined/.test(message)) {
      return 'network';
    }
    return 'other';
  }

  /** Whether the dialog may offer "Limpar todos os dados" after this many failures in a row. */
  static offersWipe(kind: BootFailureKind, failures: number): boolean {
    return kind === 'other' && failures >= GAME_BOOT.WIPE_OFFER_AFTER_FAILURES;
  }

  /** The body of the "keep waiting?" dialog. */
  static timeoutMessage(error: unknown): string {
    const lastProgress = (error as { lastProgress?: unknown } | null)?.lastProgress;
    const step = BootProgressHelper.describe(typeof lastProgress === 'string' ? lastProgress : null);
    return 'O jogo está demorando mais do que o normal para iniciar.\n'
      + (step ? `Última etapa: ${step}\n` : '')
      + '\nIsso costuma acontecer em conexões lentas, principalmente na primeira vez. '
      + 'Seus jogos salvos não foram afetados.';
  }

  /** The body of the "did not load" dialog; `failures` counts this one. */
  static failureMessage(kind: Exclude<BootFailureKind, 'timeout'>, failures: number): string {
    let message = kind === 'network'
      ? 'Não foi possível baixar os arquivos do jogo. Verifique sua conexão com a internet e tente de novo.'
      : 'O emulador não conseguiu iniciar neste navegador. Feche outras abas e tente de novo.';

    if (failures >= 2) {
      message += `\n\n${failures} tentativas seguidas falharam.`;
    }
    if (BootFailureHelper.offersWipe(kind, failures)) {
      message += '\n\nSe continuar assim, limpar os dados do site costuma resolver, mas apaga os jogos salvos. '
        + 'Baixe uma cópia deles antes.';
    }
    return message;
  }

  private static messageOf(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return String((error as { message?: unknown } | null)?.message ?? '');
  }
}
