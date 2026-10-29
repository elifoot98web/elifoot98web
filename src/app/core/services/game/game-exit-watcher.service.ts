import { Injectable, NgZone } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { GAME_EXIT_WATCH } from '../../models/constants';
import { GameExitHelper, GameExitReading } from '../../helpers/game-exit.helper';
import { PixelFrame } from '../../helpers/ocr-region.helper';
import { TimeoutHelper } from '../../helpers/timeout.helper';
import { DosCI } from '../../typings/jsdos';
import { DiagnosticsService } from '../shared/diagnostics.service';

/**
 * Notices that Elifoot has quit to the Windows Program Manager, once the game has been running.
 *
 * The boot chain leaves Windows with the game as its only program, so when the game exits (Esc or
 * Cancelar in its first dialog, Enter before a choice, a crash) the player is on a blue desktop
 * with a Program Manager icon and no way back but a reload; the page had no idea. One look a
 * second at the guest's frame, judged by GameExitHelper, and `exited$` fires once the picture
 * has been the bare desktop for `LOOKS_NEEDED` looks in a row.
 *
 * - **Once per episode.** After it fires it stays quiet until a look finds anything else on screen
 *   (the player restored the Program Manager window, started another program), so "Agora não"
 *   on the banner is not asked again a second later.
 * - **A look that cannot be read is not a match.** A `screenshot()` that throws or overruns resets
 *   the run, so a flaky emulator can never add up to an exit.
 * - **A hidden page is not looked at.** Its timers are throttled and nothing it could see is
 *   current; the run is kept, not reset, and goes on when the page comes back.
 * - **Armed after the game is up, never before.** Windows draws this very desktop while the
 *   game loads, so no look counts until the boot has seen the game's own screen. The page starts
 *   it armed when the boot saw it; when the boot's window ran out first (a slow phone), it passes
 *   `armWhen`, and the looks start to count at the first frame that test accepts, so a late boot
 *   is not left without the dialog for the whole session.
 *
 * Holds the emulator between `start()` and `stop()`, like TouchInputService, and runs outside
 * Angular's zone (a timer every second would otherwise cost a change-detection pass each); only
 * the emission re-enters it.
 */
export interface GameExitWatchOptions {
  /**
   * Hold the looks back until a frame passes this test (the game's own screen being on show).
   * Left out, the watcher counts from its first look.
   */
  armWhen?: (frame: PixelFrame) => boolean;
}

@Injectable({
  providedIn: 'root'
})
export class GameExitWatcherService {
  private readonly exitedSubject = new Subject<void>();
  private dosCI: DosCI | null = null;
  /** Which start() a pending look belongs to; stop() moves it on so a late look finds out. */
  private run = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private streak = 0;
  private announced = false;
  private lastMatched = false;
  private armed = true;
  private armWhen: ((frame: PixelFrame) => boolean) | null = null;

  /** Emits (inside the zone) when the game has been gone for long enough to say so. */
  readonly exited$: Observable<void> = this.exitedSubject.asObservable();

  constructor(private zone: NgZone, private diagnostics: DiagnosticsService) { }

  get watching(): boolean {
    return this.dosCI !== null;
  }

  start(dosCI: DosCI, options: GameExitWatchOptions = {}): void {
    this.stop();
    this.dosCI = dosCI;
    this.armWhen = options.armWhen ?? null;
    this.armed = this.armWhen === null;
    const run = ++this.run;
    this.diagnostics.log('frame', 'exit watcher started');
    this.zone.runOutsideAngular(() => this.schedule(run));
  }

  stop(): void {
    if (this.dosCI) this.diagnostics.log('frame', 'exit watcher stopped');
    this.run++;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.dosCI = null;
    this.streak = 0;
    this.announced = false;
    this.lastMatched = false;
    this.armWhen = null;
    this.armed = true;
  }

  private schedule(run: number): void {
    this.timer = setTimeout(() => void this.look(run), GAME_EXIT_WATCH.POLL_MS);
  }

  private async look(run: number): Promise<void> {
    const dosCI = this.dosCI;
    if (run !== this.run || !dosCI) return;

    try {
      if (typeof document === 'undefined' || !document.hidden) {
        let reading: GameExitReading | null = null;
        try {
          const frame = await TimeoutHelper.withTimeout(() => dosCI.screenshot(), GAME_EXIT_WATCH.SCREENSHOT_TIMEOUT_MS);
          if (run !== this.run) return;
          if (frame && !this.armed && this.armWhen?.(frame)) {
            this.armed = true;
            this.diagnostics.log('frame', 'exit watcher: armed');
          }
          reading = frame && this.armed ? GameExitHelper.inspect(frame) : null;
        } catch (error) {
          if (run !== this.run) return;
          this.diagnostics.log('frame', 'exit watcher: look failed', () => ({ error }));
        }
        this.settle(reading !== null && GameExitHelper.verdict(reading), reading);
      }
    } finally {
      if (run === this.run) this.schedule(run);
    }
  }

  private settle(matched: boolean, reading: GameExitReading | null): void {
    if (matched !== this.lastMatched) {
      this.lastMatched = matched;
      this.diagnostics.log('frame', matched ? 'exit watcher: desktop signature seen' : 'exit watcher: signature gone', () => ({ ...reading, streak: this.streak }));
    }
    if (!matched) {
      this.streak = 0;
      this.announced = false;
      return;
    }

    this.streak++;
    if (this.streak < GAME_EXIT_WATCH.LOOKS_NEEDED || this.announced) return;
    this.announced = true;
    this.diagnostics.log('frame', 'exit watcher: the game has exited', () => ({ ...reading, looks: this.streak }));
    this.zone.run(() => this.exitedSubject.next());
  }
}
