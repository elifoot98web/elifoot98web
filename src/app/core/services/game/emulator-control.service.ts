import { Injectable, NgZone } from '@angular/core';
import { Observable } from 'rxjs';
import { DosCI } from '../../typings/jsdos';
import { createWorker } from 'tesseract.js';
import { EMULATOR_CONTROL_CONFIG } from '../../models/constants';
import { EmulatorKeyCode } from '../../models/game';
import { OcrRegionHelper, PixelRegion } from '../../helpers/ocr-region.helper';
import { RegionVerdictCache } from '../../helpers/region-verdict-cache.helper';
import { GuestKeyQueueService, KeySendResult, TextSendResult } from './guest-key-queue.service';
import { OcrWorkerHost } from './ocr-worker-host';
import { DiagnosticsService } from '../shared/diagnostics.service';

@Injectable({
  providedIn: 'root'
})
export class EmulatorControlService {
  /**
   * The OCR worker. Nothing is downloaded until `startOcr()` (or the first read that needs it)
   * asks. The constructor used to start it, which began a 5.4 MB download from a CDN the moment
   * the game page opened, in parallel with the emulator's own 7 MB bundle.
   */
  private readonly ocr = new OcrWorkerHost(() => createWorker('por', undefined, {
    // Without a handler tesseract.js rethrows a worker's error from its own onmessage, which
    // nothing can catch: every failed start would also be an uncaught exception. The failure
    // still reaches us, as the rejection of createWorker() or of the recognize() that caused it.
    errorHandler: () => undefined,
  }), {
    timeoutMs: EMULATOR_CONTROL_CONFIG.OCR_WORKER_TIMEOUT_MS,
    retryBackoffMs: EMULATOR_CONTROL_CONFIG.OCR_RETRY_BACKOFF_MS,
    log: (message, data) => this.diagnostics.log('ocr', message, data),
  });
  private readonly savingVerdicts = new RegionVerdictCache();
  private regionCanvas: HTMLCanvasElement | null = null;
  /** The last answer written to the diagnostics log, so a steady answer is one line and not three a second. */
  private lastLoggedVerdict: string | null = null;
  /** Why the last look came back `null`; it names the verdict in the log. */
  private unreadableBecause = '';

  /** True once OCR has failed to start and until it works. See {@link OcrWorkerHost.unavailable$}. */
  readonly ocrUnavailable$: Observable<boolean> = this.ocr.unavailable$;

  constructor(private keyQueue: GuestKeyQueueService, private zone: NgZone, private diagnostics: DiagnosticsService) { }

  /**
   * Press one key, or several together (modifiers first), through the guest key queue — the
   * only way keys reach the guest. Resolves once the guest has seen the release; rejects, so
   * a caller can say so, when there is no emulator or it throws.
   */
  public sendKey(dosCI: DosCI | null | undefined, ...keyCodes: EmulatorKeyCode[]): Promise<KeySendResult> {
    return this.keyQueue.chord(dosCI, keyCodes);
  }

  /** Type `str` into whatever the guest has focused. See GuestKeyQueueService.text. */
  public sendString(dosCI: DosCI | null | undefined, str: string, onProgress?: (completed: number, total: number) => void): Promise<TextSendResult> {
    return this.keyQueue.text(dosCI, str, { onProgress });
  }

  /** Drop every key that has not gone out yet; returns how many. */
  public cancelKeys(): number {
    return this.keyQueue.cancel();
  }

  /**
   * Begin starting the OCR worker, so it is ready before the first save needs it. The
   * auto-saver calls this when it starts, which the game page does once the game has booted.
   * Idempotent, and it never waits: see {@link OcrWorkerHost}.
   */
  public startOcr(): void {
    this.zone.runOutsideAngular(() => this.ocr.warmUp());
  }

  /** Terminate the worker and forget what it last read; a later `startOcr()` starts afresh. */
  public stopOcr(): void {
    this.ocr.stop();
    this.savingVerdicts.forget();
    this.lastLoggedVerdict = null;
  }

  /**
   * Is the game's "A gravar o jogo..." dialog on screen right now?
   *
   * Cheap on purpose, because the auto-saver asks several times a second: a screenshot and a
   * fingerprint of the one strip that holds the dialog's title. OCR runs only for a strip it has
   * not read yet, and a strip that has not changed gets the answer it got last time. While the
   * dialog is up the strip is static, so that answer, not "nothing happened", is what the
   * caller needs (see {@link RegionVerdictCache}).
   *
   * Resolves `null`, not `false`, whenever the look could not be read: no frame, no worker yet
   * or at all, or a failed read. "Could not tell" and "the dialog is not there" must stay apart,
   * because the auto-saver persists the moment the dialog is gone, and a reading that fails while
   * the game is still writing its `.e98` would otherwise look like the all-clear. A non-answer is
   * not remembered, so the next look at the same strip tries again. A failing `screenshot()` is
   * not swallowed either, since the caller has to know the emulator stopped answering.
   */
  public async isGameSaving(dosCI: DosCI): Promise<boolean | null> {
    const frame = await dosCI.screenshot();
    if (!frame) {
      console.warn('No image data found');
      this.noteVerdict(null, 'no frame');
      return null;
    }

    const region = OcrRegionHelper.savingDialogRegion(frame.width, frame.height);
    const hash = OcrRegionHelper.hash(frame, region);
    const remembered = this.savingVerdicts.recall(hash);
    if (remembered !== null) {
      this.noteVerdict(remembered, 'cache');
      return remembered;
    }

    const found = await this.findTextInRegion(
      frame,
      region,
      'a gravar o jogo...',
      EMULATOR_CONTROL_CONFIG.DEFAULT_TOLERANCE_GAME_SAVING_DETECTION
    );
    if (found === null) {
      this.noteVerdict(null, this.unreadableBecause);
      return null;
    }

    this.savingVerdicts.remember(hash, found);
    this.noteVerdict(found, 'ocr');
    return found;
  }

  /**
   * Write the verdict to the diagnostics log when it CHANGES. The auto-saver asks about three
   * times a second and the answer is the same almost always, so logging every look would bury
   * the few that matter (the dialog appearing and going away) under thousands of repeats. While
   * the log is off nothing is tracked, so the first look after it is switched on is written.
   */
  private noteVerdict(verdict: boolean | null, via: string): void {
    if (!this.diagnostics.enabled) return;
    const key = verdict === null ? `null: ${via}` : String(verdict);
    if (key === this.lastLoggedVerdict) return;
    this.lastLoggedVerdict = key;
    this.diagnostics.log('ocr', 'saving verdict', () => ({ verdict, via }));
  }

  /**
   * Read `region` of `frame` with OCR and say whether it holds `searchString`, within
   * `editDistanceTolerance` edits. `null` means OCR could not run, which is different from
   * "the text is not there".
   */
  private async findTextInRegion(frame: ImageData, region: PixelRegion, searchString: string, editDistanceTolerance: number): Promise<boolean | null> {
    // Asked before the strip is encoded, so a worker that is still downloading costs a lookup
    // per tick and not a PNG. warmUp() is a no-op when a start is already in flight.
    const worker = this.ocr.ready;
    if (!worker) {
      this.unreadableBecause = 'no worker';
      this.startOcr();
      return null;
    }

    try {
      const image = this.regionToImage(frame, region);
      if (!image) {
        console.warn('No base64 image data found');
        this.unreadableBecause = 'no image';
        return null;
      }

      const began = performance.now();
      const result = await worker.recognize(image);
      const ms = Math.round(performance.now() - began);
      const foundText = this.stringWithoutAccents(result.data.text.toLowerCase().trim());
      const searchText = this.stringWithoutAccents(searchString.toLowerCase());

      // if text is too short, it is not there
      if (foundText.length == 0 || foundText.length < searchText.length / 2) {
        this.diagnostics.log('ocr', 'recognize', () => ({ ms, read: foundText, verdict: false }));
        return false;
      }

      const distance = this.minimumDistanceWithSlidingWindow(foundText, searchText);
      const includes = foundText.includes(searchText);
      this.diagnostics.log('ocr', 'recognize', () => ({ ms, read: foundText, distance, verdict: includes || distance <= editDistanceTolerance }));

      if (includes || distance <= editDistanceTolerance) {
        console.log('Text found on game screen:', foundText, searchString);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error finding text on game screen:', error);
      this.unreadableBecause = `read failed: ${error instanceof Error ? error.message : String(error)}`;
      return null;
    }
  }

  /**
   * Just `region` of `frame` as a PNG data URL. The crop happens before the encode: encoding
   * the whole 800x600 frame to read 132x20 of it cost 6.2 ms and 38 KB a look, against 4.1 ms and
   * 6 KB for the strip (measured), and the worker then no longer needs a rectangle to confine
   * itself to. Not upscaled: the real dialog's title was read correctly at 1:1.
   */
  private regionToImage(frame: ImageData, region: PixelRegion): string {
    const canvas = this.regionCanvas ?? (this.regionCanvas = document.createElement('canvas'));
    canvas.width = region.width;
    canvas.height = region.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    // The dirty rectangle is painted at (dx + dirtyX, dy + dirtyY): shifting by -left/-top puts
    // the strip at the canvas origin.
    ctx.putImageData(frame, -region.left, -region.top, region.left, region.top, region.width, region.height);
    return canvas.toDataURL('image/png');
  }

  private minimumDistanceWithSlidingWindow(str1: string, str2: string): number {
    const len1 = str1.length;
    const len2 = str2.length;
    
    const smallerStr = len1 < len2 ? str1 : str2;
    const largerStr = len1 < len2 ? str2 : str1;
    
    let smallestDistance = largerStr.length + 1;

    // sliding the smaller string over the larger string
    for(let i = 0; i <= largerStr.length - smallerStr.length; i++) {
      const subStr = largerStr.substring(i, i + smallerStr.length);
      const distance = this.editDistDP(smallerStr, subStr);
      if (distance < smallestDistance) {
        smallestDistance = distance;
      }
    }

    return smallestDistance;
  }

  /**
   * Calculate the edit distance between two strings using dynamic programming.
   * @param str1 The first string.
   * @param str2 The second string.
   * @returns The edit distance between the two strings.
   */
  private editDistDP(str1: string, str2: string): number {
    const m = str1.length;
    const n = str2.length;
  
    // Matrix to store intermediate values
    const editDistance: number[][] = Array.from({ length: m + 1 }, () =>
      Array(n + 1).fill(0)
    );
  
    // Initialize first column
    for (let i = 0; i <= m; i++) {
      editDistance[i][0] = i;
    }
  
    // Initialize first row
    for (let j = 0; j <= n; j++) {
      editDistance[0][j] = j;
    }
  
    // Fill the matrix
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          // If characters match, no cost
          editDistance[i][j] = editDistance[i - 1][j - 1];
        } else {
          // If characters are different, take min of insert, delete, replace
          editDistance[i][j] = 1 + Math.min(
            editDistance[i][j - 1],     // Insertion
            editDistance[i - 1][j],     // Deletion
            editDistance[i - 1][j - 1]  // Substitution
          );
        }
      }
    }
  
    return editDistance[m][n];
  }

  public stringWithoutAccents(str: string): string {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  
}
