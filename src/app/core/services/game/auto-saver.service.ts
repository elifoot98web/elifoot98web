import { Injectable, NgZone } from '@angular/core';
import { Subscription } from 'rxjs';
import { SaveGameService } from './save-game.service';
import { DosCI } from '../../typings/jsdos';
import { EmulatorControlService } from './emulator-control.service';
import { LoadingController, ToastController } from '@ionic/angular/lazy';
import { AUTO_SAVER } from '../../models/constants';
import { BackoffHelper } from '../../helpers/backoff.helper';
import { TimeoutHelper } from '../../helpers/timeout.helper';
import { DiagnosticsService } from '../shared/diagnostics.service';

export interface AutoSaverOptions {
  tickIntervalMs?: number;
  /**
   * Asked on every tick of a hidden page. A browser throttles a hidden tab's timers and pauses
   * its frames, so by default those ticks do nothing: what they could see would not be current,
   * and the battery matters on a phone. A host is the exception, since it keeps streaming the
   * canvas, and the game keeps being played, while its tab is behind another.
   */
  keepRunningWhileHidden?: () => boolean;
}

@Injectable({
  providedIn: 'root'
})
export class AutoSaverService {
  private state: AutoSaverState = AutoSaverState.IDLE
  private tickIntervalMs: number = AUTO_SAVER.DEFAULT_TICK_INTERVAL_MS
  private keepRunningWhileHidden: () => boolean = () => false
  private dosCI!: DosCI
  /**
   * Which start() a deferred callback belongs to. stop() and start() both move it on, so a tick,
   * a wait or a subscription from a run that has since ended finds out and does nothing: a fast
   * stop/start (the options switch toggled twice) must not leave two loops, and a persist must
   * never fire into a VM that is exiting (see GamePage.leaveGameToMenu).
   */
  private runId = 0
  private tickTimer: ReturnType<typeof setTimeout> | undefined
  private failures = 0
  private ocrSubscription: Subscription | undefined
  private ocrFallbackAnnounced = false
  /**
   * The game saved, and persisting it failed. Paid at the first look that finds the dialog gone,
   * so a transient fault (IndexedDB closed after the browser was backgrounded) does not cost the
   * save: the tick that failed is retried after a backoff, and by then the dialog is long gone
   * and nothing else would ask.
   */
  private persistOwed = false

  // The periodic save runs when the user switched it on, or when OCR is unavailable and it is
  // the only thing left saving the game. They are separate so that OCR coming back, or the
  // auto-saver stopping, ends the forced one without touching the user's.
  private periodicRequested = false
  private periodicForced = false
  private periodicIntervalMs: number = AUTO_SAVER.DEFAULT_PERIODIC_SAVE_INTERVAL_MS
  private periodicSaveInterval: ReturnType<typeof setInterval> | undefined

  private persistInFlight: Promise<void> | null = null
  /** The last tick was skipped because the page is hidden; only for the diagnostics log. */
  private skippingHiddenTicks = false

  constructor(
    private saveGameService: SaveGameService,
    private emulatorControlService: EmulatorControlService,
    private loadingController: LoadingController,
    private toastController: ToastController,
    private zone: NgZone,
    private diagnostics: DiagnosticsService) {
  }


  public start(dosCI: DosCI, options: AutoSaverOptions = {}) {
    if (this.state !== AutoSaverState.IDLE) {
      console.warn('AutoSaverService is already running')
      return
    }

    const tickIntervalMs = options.tickIntervalMs ?? AUTO_SAVER.DEFAULT_TICK_INTERVAL_MS
    console.log('AutoSaverService started with tick interval:', tickIntervalMs)
    this.tickIntervalMs = tickIntervalMs
    this.keepRunningWhileHidden = options.keepRunningWhileHidden ?? (() => false)
    this.dosCI = dosCI
    this.state = AutoSaverState.MONITORING
    this.failures = 0
    this.persistOwed = false
    this.ocrFallbackAnnounced = false
    this.skippingHiddenTicks = false
    const run = ++this.runId
    this.diagnostics.log('save', 'auto-save start', () => ({ tickMs: tickIntervalMs, keepRunningWhileHidden: this.keepRunningWhileHidden() }))

    // Outside the zone: the loop touches no template state, and at several ticks a second it
    // would otherwise cost the whole app a change-detection pass each time.
    this.zone.runOutsideAngular(() => {
      // The worker is started here and not at boot. The game page calls start() once the game
      // has loaded (or the wait for it gave up), so the download no longer competes with the
      // emulator's own bundle.
      this.emulatorControlService.startOcr()
      this.ocrSubscription = this.emulatorControlService.ocrUnavailable$.subscribe(
        unavailable => this.onOcrAvailability(run, unavailable)
      )
      void this.tick(run)
    })
  }

  public stop() {
    console.log('AutoSaverService stopped')
    this.diagnostics.log('save', 'auto-save stop')
    this.state = AutoSaverState.IDLE
    this.runId++
    clearTimeout(this.tickTimer)
    this.tickTimer = undefined
    this.ocrSubscription?.unsubscribe()
    this.ocrSubscription = undefined
    this.emulatorControlService.stopOcr()
    if (this.periodicForced) {
      this.periodicForced = false
      this.syncPeriodicSave()
    }
  }

  public startPeriodicSave(periodInMs: number = AUTO_SAVER.DEFAULT_PERIODIC_SAVE_INTERVAL_MS) {
    console.log('Periodic save started with interval:', periodInMs)
    this.diagnostics.log('save', 'periodic save on', () => ({ everyMs: periodInMs }))
    this.periodicRequested = true
    this.periodicIntervalMs = periodInMs
    this.syncPeriodicSave()
  }

  public stopPeriodicSave() {
    console.log('Periodic save stopped')
    this.diagnostics.log('save', 'periodic save off')
    this.periodicRequested = false
    this.syncPeriodicSave()
  }

  /** Bring the interval in line with whether anything wants a periodic save right now. */
  private syncPeriodicSave() {
    clearInterval(this.periodicSaveInterval)
    this.periodicSaveInterval = undefined
    if (!this.periodicRequested && !this.periodicForced) return

    this.zone.runOutsideAngular(() => {
      this.periodicSaveInterval = setInterval(() => void this.runPeriodicSave(), this.periodicIntervalMs)
    })
  }

  /**
   * Awaited and caught. A save that rejects (IndexedDB closed, or out of quota after the browser
   * was backgrounded) used to be an unhandled rejection that nobody saw. It is logged and left
   * for the next interval, and it must not stop the interval.
   */
  private async runPeriodicSave() {
    console.log('Periodic save triggered')
    try {
      await this.persist(this.periodicRequested ? 'periodic' : 'periodic (forced, no OCR)')
    } catch (error) {
      console.error('Periodic save failed:', error)
    }
  }

  /**
   * OCR is what tells this service the game just saved. Without it nothing would ever be
   * persisted, and that used to be silent. The periodic save takes over, and the user is told
   * once.
   */
  private onOcrAvailability(run: number, unavailable: boolean) {
    if (run !== this.runId) return

    if (!unavailable) {
      if (this.periodicForced) {
        console.log('OCR is back; the forced periodic save is no longer needed')
        this.diagnostics.log('save', 'ocr is back; forced periodic save off')
        this.periodicForced = false
        this.syncPeriodicSave()
      }
      return
    }

    console.warn('OCR is unavailable; forcing the periodic save')
    this.diagnostics.log('save', 'ocr unavailable; periodic save forced', () => ({ everyMs: this.periodicIntervalMs, announced: this.ocrFallbackAnnounced }))
    this.periodicForced = true
    this.syncPeriodicSave()
    if (this.ocrFallbackAnnounced) return
    this.ocrFallbackAnnounced = true
    void this.announceOcrFallback()
  }

  private async announceOcrFallback() {
    const minutes = Math.round(this.periodicIntervalMs / 60000)
    try {
      // Back inside the zone: Ionic's overlay controllers are Angular providers, and the
      // subscription that got here runs from a worker callback outside it.
      await this.zone.run(async () => {
        const toast = await this.toastController.create({
          message: `Salvamento automático indisponível. O jogo será salvo a cada ${minutes} minutos.`,
          duration: 8000,
          position: 'bottom',
          color: 'warning',
        })
        await toast.present()
      })
    } catch (error) {
      console.warn('Could not announce the auto-save fallback:', error)
    }
  }

  private shouldSkipTick(): boolean {
    return typeof document !== 'undefined' && document.hidden && !this.keepRunningWhileHidden()
  }

  /**
   * One look, then the next one is always scheduled. The reschedule is in `finally` because it
   * used to follow the `try` and so was skipped on a throw: a throw set the state to ERROR,
   * every later tick returned on its first line, and one transient error ended auto-save for
   * the session while the options menu still showed it switched on.
   *
   * A tick that throws is retried after a growing wait (5 s, 15 s, 60 s, then every 60 s), so a
   * persistent fault such as an emulator that is gone is quiet instead of a console full of
   * errors, and a transient one costs a few seconds. A tick that works goes back to the normal
   * pace.
   */
  private async tick(run: number) {
    if (run !== this.runId || this.state === AutoSaverState.IDLE) {
      return
    }

    let delayMs = this.tickIntervalMs
    try {
      const skipping = this.shouldSkipTick()
      if (skipping !== this.skippingHiddenTicks) {
        this.skippingHiddenTicks = skipping
        this.diagnostics.log('save', skipping ? 'ticks paused: page hidden' : 'ticks resumed: page visible')
      }
      if (!skipping) {
        await this.monitor(run)
        // Only the run that is current may touch the shared state: a tick that outlived a
        // stop()/start() (the wait for the dialog lasts up to 2 min) would otherwise reset, or
        // advance, the backoff of the run that replaced it.
        if (run === this.runId) {
          this.failures = 0
          this.state = AutoSaverState.MONITORING
        }
      }
    } catch (error) {
      if (run === this.runId) {
        this.failures++
        this.state = AutoSaverState.ERROR
      }
      delayMs = BackoffHelper.delayRepeating(AUTO_SAVER.RETRY_BACKOFF_MS, this.failures)
      this.diagnostics.log('save', 'tick failed', () => ({ failures: this.failures, retryInMs: delayMs, error }))
      console.error(`Error in AutoSaver monitor (failure ${this.failures}); retrying in ${delayMs / 1000} s:`, error)
    } finally {
      if (run === this.runId) {
        this.tickTimer = setTimeout(() => void this.tick(run), delayMs)
      }
    }
  }

  /** One step of a tick, with a deadline: `isGameSaving` and the like have none of their own. */
  private heartbeat<T>(work: () => Promise<T>): Promise<T> {
    return TimeoutHelper.withTimeout(work, AUTO_SAVER.HEARTBEAT_MS)
  }

  /**
   * Detect the game's own save and, once it is over, persist the emulator's disk.
   *
   * Persisting only AFTER the dialog is gone is the point: the dialog is up while the game
   * writes the .e98, and a persist that lands mid-write would store a truncated save over a
   * good one. So when the dialog is seen, wait for it to disappear, then persist.
   *
   * Each look is guarded by a heartbeat (a hung screenshot or OCR pass fails the tick instead
   * of freezing the loop). The tick as a whole is not, because it lasts as long as the save.
   *
   * A look has three answers, not two: the dialog is there, it is not, or OCR could not say
   * (`null`). Before the dialog has been seen, "could not say" is "not saving", as there is
   * nothing to wait for. Once it has been seen it is "still saving": whatever stopped the reading
   * (the worker dying under the memory spike of a save, a canvas that would not encode) says
   * nothing about the game having finished writing.
   */
  private async monitor(run: number) {
    let isGameSaving = (await this.heartbeat(() => this.emulatorControlService.isGameSaving(this.dosCI))) === true
    if (run !== this.runId) {
      return
    }
    if (!isGameSaving) {
      await this.payOwedPersist()
      return
    }

    console.log('Game is saving...')
    this.diagnostics.log('save', 'save dialog seen')
    const dialogSeenAt = performance.now()
    this.persistOwed = true
    const waitUntil = Date.now() + AUTO_SAVER.MAX_WAITING_TIME_FOR_GAME_SAVE_DETECTED
    while (isGameSaving && waitUntil > Date.now()) {
      console.log('Game is still saving...')
      await new Promise(resolve => setTimeout(resolve, AUTO_SAVER.DEFAULT_GAME_SAVING_DETECTED_TIMEOUT_MS))
      if (run !== this.runId) {
        return
      }
      try {
        const look = await this.heartbeat(() => this.emulatorControlService.isGameSaving(this.dosCI))
        isGameSaving = look ?? true
      } catch (error) {
        // Not a reason to persist either: the dialog was up a moment ago, so a persist now could
        // be the truncated one this wait exists to prevent. Keep looking until the ceiling.
        console.warn('Could not tell whether the game is still saving; waiting:', error)
      }
    }

    if (run !== this.runId) {
      return
    }
    this.diagnostics.log('save', 'save dialog gone', () => ({ afterMs: Math.round(performance.now() - dialogSeenAt), gaveUpWaiting: isGameSaving }))
    await this.persistSave('after the game saved')
  }

  private async persistSave(reason: string) {
    await this.persistWithLoader(reason)
    this.persistOwed = false
  }

  /**
   * Retry a persist that failed after the game's save, as many times as a tick may fail in a
   * row before giving up. A fault that outlasts that (IndexedDB gone for good) would otherwise
   * flash the loader over the game once a minute for as long as the page lives.
   */
  private async payOwedPersist() {
    if (!this.persistOwed) {
      return
    }
    if (this.failures > AUTO_SAVER.RETRY_BACKOFF_MS.length) {
      console.error('Giving up on persisting the last save after repeated failures')
      this.diagnostics.log('save', 'owed persist dropped', () => ({ failures: this.failures }))
      this.persistOwed = false
      return
    }
    await this.persistSave('owed from a failed one')
  }

  /**
   * Persist behind the "Salvando máquina virtual..." loader, which is dismissed in `finally`: a
   * rejected or hung save used to leave a loader nobody can dismiss (backdropDismiss is off)
   * over the game for good.
   *
   * The loader's own present and dismiss are bounded too. Both wait for an animation, and a
   * page Chrome counts as hidden runs no animation frames, so there they never settle; a
   * hosting browser reaches this while hidden.
   */
  private async persistWithLoader(reason: string) {
    const loading = await this.loadingController.create({
      message: 'Salvando máquina virtual...',
      backdropDismiss: false,
    })
    try {
      await this.boundedOverlay(() => loading.present())
      await this.persist(reason)
      console.log('Emulator data saved')
    } finally {
      await this.boundedOverlay(() => loading.dismiss())
    }
  }

  private async boundedOverlay(work: () => Promise<unknown>) {
    try {
      await TimeoutHelper.withTimeout(work, AUTO_SAVER.OVERLAY_TIMEOUT_MS)
    } catch (error) {
      this.diagnostics.log('save', 'loader did not finish animating', () => ({ error }))
      console.warn('The save loader did not finish animating; carrying on:', error)
    }
  }

  /**
   * Flush the emulator's changes to IndexedDB, one flush at a time and within PERSIST_TIMEOUT_MS.
   * The detected save and the periodic save can both fall due at once, and a second
   * `layers.save()` started while the first is still reading the disk is not something the
   * emulator promises to cope with, so the second waits its turn.
   *
   * The deadline stops *waiting*, not the flush. The flush stays tracked until it settles, so
   * the next one queues behind it instead of landing on top of it.
   */
  private async persist(reason: string): Promise<void> {
    const began = performance.now()
    try {
      await TimeoutHelper.withTimeout(async () => {
        while (this.persistInFlight) {
          await this.persistInFlight
        }
        const work = this.saveGameService.saveGame()
        const tracked: Promise<void> = work.then(() => undefined, () => undefined).then(() => {
          if (this.persistInFlight === tracked) {
            this.persistInFlight = null
          }
        })
        this.persistInFlight = tracked
        await work
      }, AUTO_SAVER.PERSIST_TIMEOUT_MS)
      this.diagnostics.log('save', 'persist ok', () => ({ reason, ms: Math.round(performance.now() - began) }))
    } catch (error) {
      this.diagnostics.log('save', 'persist failed', () => ({ reason, ms: Math.round(performance.now() - began), error }))
      throw error
    }
  }
}

enum AutoSaverState {
    IDLE = 'IDLE',
    MONITORING = 'MONITORING',
    // The last tick threw and another is scheduled after a backoff. Not terminal.
    ERROR = 'ERROR',
}
