/** What the game page's route guard should do with a navigation away from it. */
export type LeaveVerdict =
  /** Let it through: nothing here to lose, or the leave is already under way. */
  | 'allow'
  /** Cancel the navigation and open the leave dialog (which saves, exits the emulator and reloads). */
  | 'prompt'
  /** Cancel it and do nothing more: the dialog is already open, and a second Back must not stack another. */
  | 'hold';

export interface LeaveInput {
  /** Where the page is, e.g. `/game?host=1`. */
  currentUrl: string;
  /** Where the navigation is going. */
  nextUrl: string;
  /** `leaveGameToMenu` is running (or a deliberate reload is): it navigates by itself, and must not be asked. */
  leaving: boolean;
  /** There is an emulator to save and exit. Without one (the boot failed, or it is still loading) there is nothing to lose. */
  hasEmulator: boolean;
  /** The leave dialog is open. */
  promptOpen: boolean;
}

/**
 * The decision behind `canDeactivate` on the game page: browser Back, the Android Back button and
 * a left-edge swipe on iOS all leave `#/game` without going through "Voltar ao menu", and the page
 * then left a live, audible emulator and everything since the last save behind (and re-entering
 * built a second DOSBox on top of the first).
 *
 * The guard answers with the dialog the menu entry already uses. Three things keep it from being
 * a trap:
 *
 * - Only the game page has it. The landing page and the spectator's page are not guarded, and a
 *   spectator leaves through `reloadSpectator`, which has no state to lose.
 * - It lets through anything that stays on the page (`?host=1` is stripped by a navigation to the
 *   same route) and anything the page itself started (`leaving`).
 * - It never stacks: a Back pressed while the dialog is open changes nothing.
 *
 * Pressing Back never loops, and every Back asks. A refused navigation has to put the address bar
 * back, and the router's default ('replace') does it by rewriting the history entry the browser
 * already moved to, which loses a level: measured, the first Back asked and the next one left the
 * page with no question, "Cancelar" or not. The app sets `canceledNavigationResolution:
 * 'computed'` (app-routing.module.ts), which walks the history pointer back instead, so a refused
 * Back leaves the stack exactly as it was (`history.length` unchanged over Back, Back with the
 * dialog open, Cancelar and Back again: one dialog each time). Nothing is pushed, so nothing is
 * trapped: the dialog is one tap from either answer.
 *
 * Kept free of Angular so it can be tested on plain strings.
 */
export class NavigationGuardHelper {

  static verdict(input: LeaveInput): LeaveVerdict {
    if (input.leaving || !input.hasEmulator) return 'allow';
    if (NavigationGuardHelper.pathOf(input.nextUrl) === NavigationGuardHelper.pathOf(input.currentUrl)) return 'allow';
    return input.promptOpen ? 'hold' : 'prompt';
  }

  /** The URL without its query string and fragment: `/game?host=1#x` is `/game`. */
  static pathOf(url: string): string {
    const end = url.search(/[?#]/);
    return end < 0 ? url : url.slice(0, end);
  }
}
