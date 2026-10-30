/** What the game page's route guard should do with a navigation away from it. */
export type LeaveVerdict =
  /** Let it through: nothing here to lose, or the leave is already under way. */
  | 'allow'
  /** Cancel the navigation and open the leave dialog (which saves, exits the emulator and reloads). */
  | 'prompt'
  /** Cancel it and do nothing more: the dialog is already open, and a second Back must not stack another. */
  | 'hold'
  /** Cancel it and close the window that is on top (the options sheet, "Dados e avançado", the guide...): Back closes it before it leaves. */
  | 'close-window';

export interface LeaveInput {
  /** Where the page is, e.g. `/game?host=1`. */
  currentUrl: string;
  /** Where the navigation is going. */
  nextUrl: string;
  /** `leaveGameToMenu` is running (or a deliberate reload is): it navigates by itself, and must not be asked. */
  leaving: boolean;
  /**
   * There is an emulator to save and exit. Without one (the boot failed, or it is still loading) there is nothing to lose, so there is
   * no question to ask; a window that is open is still closed first (the room dialog `?host=1` opens while the game boots).
   */
  hasEmulator: boolean;
  /** The leave dialog is open. */
  promptOpen: boolean;
  /**
   * One of the page's own windows is the top overlay: a modal or the options sheet, with no dialog or loader over it. The Android
   * Back button and an iOS edge swipe mean "close what is open" to a person with a sheet in front of them, and only then "leave".
   */
  windowOpen: boolean;
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
 * - **A window that is open takes the Back first.** With the options sheet (or "Dados e avançado", or the guide) in front of the player,
 *   Back closes it and the page stays; the NEXT Back asks about leaving. It costs no new mechanism: a refused navigation is the very
 *   thing the guard already does, and the history pointer is walked back as for the dialog, so nothing is pushed and nothing trapped.
 *   An alert or a loader over the window is not the window's to close, so then the guard answers as it did before the window existed.
 *   **This holds without an emulator too**: `?host=1` opens the room dialog while the game is still starting, and a Back that left the page with that
 *   dialog up stranded it over the landing page (measured), where "Transmitir agora" starts nothing. With no emulator and no window there is
 *   still nothing to ask, and the Back goes through.
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
    if (input.leaving) return 'allow';
    if (NavigationGuardHelper.pathOf(input.nextUrl) === NavigationGuardHelper.pathOf(input.currentUrl)) return 'allow';
    // The leave dialog only exists where there is an emulator to leave, so it is not asked about without one.
    if (input.hasEmulator && input.promptOpen) return 'hold';
    if (input.windowOpen) return 'close-window';
    return input.hasEmulator ? 'prompt' : 'allow';
  }

  /** The URL without its query string and fragment: `/game?host=1#x` is `/game`. */
  static pathOf(url: string): string {
    const end = url.search(/[?#]/);
    return end < 0 ? url : url.slice(0, end);
  }
}
