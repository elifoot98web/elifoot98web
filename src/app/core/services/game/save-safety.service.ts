import { Injectable, NgZone } from '@angular/core';
import { Subscription } from 'rxjs';
import { AUTO_SAVER, SAVE_SAFETY } from '../../models/constants';
import { GameSavingVerdict, SavePolicyHelper, SavePurpose } from '../../helpers/save-policy.helper';
import { TimeoutHelper } from '../../helpers/timeout.helper';
import { DosCI } from '../../typings/jsdos';
import { DiagnosticsService } from '../shared/diagnostics.service';
import { SaveStatusService } from '../shared/save-status.service';
import { AutoSaverService } from './auto-saver.service';
import { EmulatorControlService } from './emulator-control.service';
import { SaveGameService } from './save-game.service';

export interface SaveSafetyOptions {
  /** Asked when the page is about to unload: a hosting browser keeps the page from closing quietly. */
  isHosting: () => boolean;
}

/**
 * How an explicit save ended. `busy` is the game's own save dialog being up: nothing was written,
 * and nothing needs to be, because the auto-saver (which must be running for the dialog to have
 * been seen at all) persists the moment it closes. `verified` is whether the look proved the
 * dialog was not up (a `false` answer); a save the player asked for goes ahead on an unreadable
 * look (see SavePolicyHelper), and the caller says so rather than present it as a clean one.
 */
export type SaveNowResult =
  | { outcome: 'saved'; at: number; verified: boolean }
  | { outcome: 'busy' }
  | { outcome: 'failed'; error: unknown }
  | { outcome: 'no-emulator' };

/** What a persist-before-reload came to; `ask` means it could not prove the game was not writing. */
export type SaveBeforeReloadResult = 'saved' | 'busy' | 'ask' | 'failed';

/**
 * The nets under the player's progress, for the length of one game page: it tells the status
 * service when input reaches the game, saves when the player asks, saves when the page goes to
 * the background, and stops the browser from closing a page that has something to lose without
 * saying so.
 *
 * Between `attach()` and `detach()` it holds the emulator, like TouchInputService: the page
 * owns it and these listeners outlive any one call. `GamePage.ngOnDestroy` and every flow that
 * ends in a reload detach it, which also removes the listeners; none is left on `document`.
 *
 * **Every persist here asks the game first, and `null` is not an answer.** The rules are in
 * SavePolicyHelper; this is only the part that looks at the screen. The look is
 * `isGameSaving`, which needs the OCR worker, which the auto-saver keeps alive, so with
 * auto-save off the look is not even attempted (it would start the worker's download) and
 * counts as unreadable.
 *
 * **Why the page-hidden save is conservative.** It fires on `visibilitychange` to hidden, which is
 * the last event a mobile browser reliably delivers before it may freeze or kill the tab, and the
 * only one that leaves time for an asynchronous write at all (`pagehide` does not). It writes only
 * when input has reached the game since the last persist, only when the dialog is provably not up,
 * and at most once per `HIDDEN_PERSIST_MIN_GAP_MS`: each persist rewrites the whole changes layer.
 * A browser may still cut it off; whether iOS does is on the device checklist.
 */
@Injectable({
  providedIn: 'root'
})
export class SaveSafetyService {
  private dosCI: DosCI | null = null;
  private options: SaveSafetyOptions | null = null;
  private keySubscription: Subscription | null = null;
  private lastHiddenPersistAt: number | null = null;
  private hiddenBusy = false;

  constructor(
    private zone: NgZone,
    private status: SaveStatusService,
    private saveGameService: SaveGameService,
    private emulatorControl: EmulatorControlService,
    private autoSaver: AutoSaverService,
    private diagnostics: DiagnosticsService) { }

  /** Start watching input and the page's lifecycle for this emulator. Replaces an earlier attach. */
  attach(dosCI: DosCI, options: SaveSafetyOptions): void {
    this.detach();
    this.dosCI = dosCI;
    this.options = options;
    this.diagnostics.log('save', 'safety attached');

    this.zone.runOutsideAngular(() => {
      // Capture phase on document, so it runs before the touch layer's capture listener on the
      // emulator's root stops the event, and still sees a finger the layer takes over.
      document.addEventListener('pointerdown', this.onInput, { capture: true, passive: true });
      document.addEventListener('keydown', this.onInput, { capture: true, passive: true });
      document.addEventListener('visibilitychange', this.onVisibilityChange);
      this.unloadTarget().addEventListener('beforeunload', this.onBeforeUnload);
    });
    // The virtual keys (the FABs, the text dialog) never become a DOM event on the game.
    this.keySubscription = this.emulatorControl.keyActivity$.subscribe(() => this.status.markDirty());
  }

  detach(): void {
    if (this.dosCI) this.diagnostics.log('save', 'safety detached');
    document.removeEventListener('pointerdown', this.onInput, { capture: true });
    document.removeEventListener('keydown', this.onInput, { capture: true });
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.unloadTarget().removeEventListener('beforeunload', this.onBeforeUnload);
    this.keySubscription?.unsubscribe();
    this.keySubscription = null;
    this.dosCI = null;
    this.options = null;
  }

  /**
   * The player asked to save ("Salvar agora", the chip), or is leaving and the dialog promised a
   * save. See SavePolicyHelper for what each answer of the look means for each purpose.
   *
   * **The auto-saver has to be running when this is called**, because the look needs its OCR
   * worker: with it stopped the look is skipped (`null`) and the save goes ahead at once, which
   * for `leave` means no wait for the game's own dialog. The leave path therefore flushes first
   * and stops the tickers afterwards.
   */
  async saveNow(purpose: Extract<SavePurpose, 'manual' | 'leave'>): Promise<SaveNowResult> {
    if (!this.dosCI) return { outcome: 'no-emulator' };

    let verdict = await this.look();
    this.diagnostics.log('save', 'save requested', () => ({ purpose, verdict }));
    if (SavePolicyHelper.decide(purpose, verdict) === 'wait') {
      if (purpose === 'manual') return { outcome: 'busy' };
      // Leaving: the dialog promised a save, so wait for the game to finish its own and then take it.
      verdict = await this.waitUntilIdle();
    }
    return this.persist(purpose, verdict === false);
  }

  /**
   * Persist before the page is reloaded, only when the game is provably not writing. `ask` is the
   * caller's cue to say that the progress could not be saved and let the player choose; `busy` is
   * a cue to say to try again in a moment.
   */
  async saveBeforeReload(): Promise<SaveBeforeReloadResult> {
    if (!this.dosCI) return 'ask';

    const verdict = await this.look();
    const action = SavePolicyHelper.decide('reload', verdict);
    this.diagnostics.log('save', 'save before reload', () => ({ verdict, action }));
    if (action === 'wait') return 'busy';
    if (action === 'ask') return 'ask';

    const result = await this.persist('reload', true);
    return result.outcome === 'saved' ? 'saved' : 'failed';
  }

  /**
   * Where the browser announces that the page is about to go away. The window, except in a spec:
   * a synthetic `beforeunload` on the real window reaches Karma's own handler on it, which fails
   * the run with "Some of your tests did a full page reload!".
   */
  protected unloadTarget(): EventTarget {
    return window;
  }

  /**
   * The game's own save dialog is up right now (a proven `true`; an unreadable look is not one).
   * For actions that copy the disk without writing it, like the export, which would otherwise
   * capture a half-written `.e98`.
   */
  async isGameWriting(): Promise<boolean> {
    return (await this.look()) === true;
  }

  /**
   * Flush the disk, giving up waiting after PERSIST_TIMEOUT_MS. Every caller sits behind a loader
   * the player cannot dismiss, and a flush that never answers (IndexedDB stalls on a phone that
   * has been in the background) must end as a failed save they can decide about, not as a screen
   * that never changes. The deadline stops the wait, not the flush: `saveGame()` keeps one flush
   * at a time, so a later persist queues behind a stuck one and times out the same way.
   */
  private async persist(purpose: SavePurpose, verified: boolean): Promise<SaveNowResult> {
    try {
      await TimeoutHelper.withTimeout(() => this.saveGameService.saveGame(), AUTO_SAVER.PERSIST_TIMEOUT_MS);
      return { outcome: 'saved', at: this.status.snapshot.lastPersistedAt ?? Date.now(), verified };
    } catch (error) {
      console.error(`Could not save the game (${purpose})`, error);
      return { outcome: 'failed', error };
    }
  }

  /**
   * Ask the game whether its save dialog is up. `null` for every way of not knowing, the auto-saver
   * being off, a look that throws or one that overruns the heartbeat included, because those are
   * the answers that must never be read as the all-clear.
   */
  private async look(): Promise<GameSavingVerdict> {
    const dosCI = this.dosCI;
    if (!dosCI) return null;
    if (!this.autoSaver.running) {
      this.diagnostics.log('save', 'look skipped: auto-save is off');
      return null;
    }
    try {
      return await TimeoutHelper.withTimeout(() => this.emulatorControl.isGameSaving(dosCI), AUTO_SAVER.HEARTBEAT_MS);
    } catch (error) {
      this.diagnostics.log('save', 'look failed', () => ({ error }));
      return null;
    }
  }

  /** Look every `GAME_IDLE_POLL_MS` until the dialog is gone, for at most `GAME_IDLE_WAIT_MS`. */
  private async waitUntilIdle(): Promise<GameSavingVerdict> {
    const deadline = Date.now() + SAVE_SAFETY.GAME_IDLE_WAIT_MS;
    let verdict: GameSavingVerdict = true;
    while (verdict === true && Date.now() < deadline && this.dosCI) {
      await new Promise(resolve => setTimeout(resolve, SAVE_SAFETY.GAME_IDLE_POLL_MS));
      verdict = await this.look();
    }
    this.diagnostics.log('save', 'waited for the game to finish saving', () => ({ verdict }));
    return verdict;
  }

  // Arrow functions: the same reference is added and removed.

  private onInput = (event: Event): void => {
    const target = event.target;
    // Only the game's own surface: keys typed into the chat, or a tap on the toolbar, change nothing in the guest.
    if (target instanceof Element && target.closest('#game-container')) this.status.markDirty();
  };

  private onVisibilityChange = (): void => {
    if (document.visibilityState !== 'hidden') return;
    void this.persistBecauseHidden();
  };

  private onBeforeUnload = (event: Event): void => {
    if (this.status.exitAllowed) return;
    const hosting = this.options?.isHosting() ?? false;
    if (!this.status.dirty && !hosting) return;
    this.diagnostics.log('page', 'beforeunload prompt', () => ({ dirty: this.status.dirty, hosting }));
    // The text cannot be localised or changed; the prompt is the browser's. Both forms, because
    // older engines read only returnValue.
    event.preventDefault();
    (event as BeforeUnloadEvent).returnValue = '';
  };

  private async persistBecauseHidden(): Promise<void> {
    if (this.hiddenBusy) return;
    const gate = SavePolicyHelper.gateHidden({
      dirty: this.status.dirty,
      hasEmulator: this.dosCI !== null,
      autoSaveRunning: this.autoSaver.running,
      lastHiddenPersistAt: this.lastHiddenPersistAt,
      now: Date.now(),
      minGapMs: SAVE_SAFETY.HIDDEN_PERSIST_MIN_GAP_MS,
    });
    if (gate !== 'proceed') {
      this.diagnostics.log('save', 'hidden: no persist', () => ({ reason: gate }));
      return;
    }

    this.hiddenBusy = true;
    try {
      const verdict = await this.look();
      if (SavePolicyHelper.decide('hidden', verdict) !== 'persist') {
        this.diagnostics.log('save', 'hidden: no persist', () => ({ reason: verdict === true ? 'game-saving' : 'unreadable' }));
        return;
      }
      if (document.visibilityState !== 'hidden') {
        // Back before the look came home: the player is here again, and the normal paths take over.
        this.diagnostics.log('save', 'hidden: no persist', () => ({ reason: 'visible again' }));
        return;
      }

      this.lastHiddenPersistAt = Date.now();
      const result = await this.persist('hidden', true);
      this.diagnostics.log('save', 'hidden: persisted', () => ({ outcome: result.outcome }));
    } finally {
      this.hiddenBusy = false;
    }
  }
}
