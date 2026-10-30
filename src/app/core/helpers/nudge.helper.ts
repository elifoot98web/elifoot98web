import { InstallMode } from './install.helper';

/**
 * When the one-time banner and hint on the game page are due. The page may show three things once
 * its welcome is out of the way: the backup reminder (SaveStatusService), the install banner and the
 * "Gire o aparelho" hint. Each is shown once in the life of the install, and **no more than one of
 * them per page load**, in this order: the one that protects the person's saves first, then the one
 * that offers the app, then the hint that costs nothing to miss. That order is the order of the
 * calls in `GamePage.maybeNudge` (each returns true when it showed something), not data kept here:
 * a list of kinds nothing read once sat here and guarded a sequence it did not run.
 */
export class NudgeHelper {
  /**
   * Whether the install banner is due. Never on the first visit: an app that asks to be installed
   * before it has been used is the pattern people learn to dismiss. "After the first successful
   * session" is read off the save status: a persist has reached the browser's storage in an earlier
   * visit (or earlier in this one, which the caller does not ask about at boot). Never while a room is
   * open, never in an app that is already installed, and never where there is nothing to offer.
   */
  static installDue(state: { mode: InstallMode; dismissed: boolean; firstPersistedAt: number | null; inRoom: boolean }): boolean {
    if (state.dismissed || state.inRoom) return false;
    if (state.mode !== 'prompt' && state.mode !== 'ios') return false;
    return state.firstPersistedAt !== null;
  }

  /** Whether the hint to turn the phone is due: unanswered, a phone held upright, and no room open. */
  static rotateDue(state: { answered: boolean; phoneInPortrait: boolean; inRoom: boolean }): boolean {
    return !state.answered && state.phoneInPortrait && !state.inRoom;
  }
}
