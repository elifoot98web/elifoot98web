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
   * `loaderText` reduced to its phase and a percentage floored to a multiple of ten, so a
   * diagnostics log can note "the download reached 40%" once instead of once per progress event.
   * The file name js-dos appends while unpacking ("Extracting 61% (hdd.img)") is dropped: it
   * changes on every event, so keeping it would make every event a new step (measured: hundreds
   * of lines for one boot from the cache). Two texts with the same step are the same log line.
   */
  static logStep(loaderText: string | null | undefined): string {
    return (loaderText ?? '').trim()
      .replace(/\s*\(.*\)\s*$/, '')
      .replace(/(\d+)(?:\.\d+)?\s*%/, (_, whole: string) => `${Math.floor(Number(whole) / 10) * 10}%`);
  }

  /**
   * Whole percent, rounded down: js-dos reports two decimals, and 100% on screen while the
   * download is still finishing reads as a hang.
   */
  private static percent(value: string): number {
    return Math.min(100, Math.max(0, Math.floor(Number(value))));
  }
}
