/**
 * Turns js-dos's own loading text into the line the loader shows.
 *
 * `elifootMain`'s `onProgress` hands over whatever js-dos last wrote to `.emulator-loading-pre-2`,
 * in English, and that text is not all progress: js-dos also writes "Ready", "Connecting..." and,
 * just before it rethrows, "Unexpected error occured...". Only what means "the bytes are moving"
 * is mapped; anything else is null, so the caller leaves the message as it is and a failure never
 * shows up as a cheerful status line. Kept free of Angular so it can be tested on plain strings.
 */
export class BootProgressHelper {

  static describe(loaderText: string | null | undefined): string | null {
    const text = (loaderText ?? '').trim();

    const download = /^Downloading bundle\s*(?:(\d+(?:\.\d+)?)\s*%)?/.exec(text);
    if (download) {
      return download[1] === undefined
        ? 'Baixando o jogo…'
        : `Baixando o jogo… ${BootProgressHelper.percent(download[1])}%`;
    }

    const extract = /^Extracting\s*(\d+(?:\.\d+)?)\s*%/.exec(text);
    if (extract) {
      return `Descompactando o jogo… ${BootProgressHelper.percent(extract[1])}%`;
    }

    if (/^Starting/.test(text)) return 'Iniciando o emulador…';
    return null;
  }

  /**
   * Whole percent, rounded down: js-dos reports two decimals, and 100% on screen while the
   * download is still finishing reads as a hang.
   */
  private static percent(value: string): number {
    return Math.min(100, Math.max(0, Math.floor(Number(value))));
  }
}
