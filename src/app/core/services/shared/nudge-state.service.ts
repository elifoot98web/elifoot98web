import { Injectable } from '@angular/core';
import { STORAGE_KEY } from '../../models/constants';
import { DiagnosticsService } from './diagnostics.service';
import { LocalStorageService } from './local-storage.service';

/** The one-time nudges this service remembers (the backup reminder keeps its own answer in SaveStatusService). */
export type OneShotNudge = 'install' | 'rotate';

const KEYS: Readonly<Record<OneShotNudge, string>> = {
  install: STORAGE_KEY.INSTALL_NUDGE_DISMISSED,
  rotate: STORAGE_KEY.ROTATE_HINT_SHOWN,
};

/**
 * Whether a one-time banner or hint has already had its turn: the rule that it is **never shown
 * again after it was answered** lives here, once, instead of in each caller.
 *
 * An answer is remembered in this page's memory before the write to storage is even tried, so a
 * storage that fails (site data blocked) does not bring the nudge back during the visit; and a store
 * that cannot be READ is read as "answered": a nudge that cannot remember it was shown would be shown
 * on every visit, which is the nagging the rule exists to prevent. The menu entries behind the
 * nudges stay as the permanent way to the same things, so nothing is lost by a nudge not appearing.
 *
 * "Apagar todos os dados" wipes the answers with everything else (Ionic Storage is emptied wholesale),
 * which is right: it is a fresh install.
 */
@Injectable({
  providedIn: 'root'
})
export class NudgeStateService {
  private readonly answeredHere = new Set<OneShotNudge>();

  constructor(private storage: LocalStorageService, private diagnostics: DiagnosticsService) { }

  /** Whether the nudge has had its turn, in this visit or an earlier one. Never throws. */
  async answered(nudge: OneShotNudge): Promise<boolean> {
    if (this.answeredHere.has(nudge)) return true;
    try {
      return (await this.storage.get<unknown>(KEYS[nudge])) === true;
    } catch (error) {
      this.diagnostics.log('platform', 'nudge: storage unreadable, treated as answered', () => ({ nudge, error }));
      return true;
    }
  }

  /** The nudge had its turn: it is not due again. Never throws. */
  async answer(nudge: OneShotNudge): Promise<void> {
    this.answeredHere.add(nudge);
    this.diagnostics.log('platform', 'nudge: answered', () => ({ nudge }));
    try {
      await this.storage.set(KEYS[nudge], true);
    } catch (error) {
      console.warn(`Could not store that the ${nudge} nudge was answered`, error);
    }
  }
}
