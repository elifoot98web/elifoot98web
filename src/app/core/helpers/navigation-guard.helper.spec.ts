import { LeaveInput, NavigationGuardHelper } from './navigation-guard.helper';

describe('NavigationGuardHelper', () => {
  const back: LeaveInput = {
    currentUrl: '/game',
    nextUrl: '/main',
    leaving: false,
    hasEmulator: true,
    promptOpen: false,
    windowOpen: false,
  };

  it('asks before the game is left through Back', () => {
    expect(NavigationGuardHelper.verdict(back)).toBe('prompt');
  });

  it('asks for every way out of the page, wherever it goes', () => {
    for (const nextUrl of ['/main', '/join-game?room=ELI-ABCD', '/', '/anything']) {
      expect(NavigationGuardHelper.verdict({ ...back, nextUrl })).toBe('prompt');
    }
  });

  it('lets the leave through that the page started itself', () => {
    expect(NavigationGuardHelper.verdict({ ...back, leaving: true })).toBe('allow');
  });

  it('lets a navigation that stays on the page through: ?host=1 is stripped by one', () => {
    expect(NavigationGuardHelper.verdict({ ...back, currentUrl: '/game?host=1', nextUrl: '/game' })).toBe('allow');
    expect(NavigationGuardHelper.verdict({ ...back, currentUrl: '/game', nextUrl: '/game?host=1#x' })).toBe('allow');
  });

  it('has nothing to ask when there is no emulator to lose: a boot that failed, or one still loading', () => {
    expect(NavigationGuardHelper.verdict({ ...back, hasEmulator: false })).toBe('allow');
  });

  it('does not stack a second dialog on the first when Back is pressed again', () => {
    expect(NavigationGuardHelper.verdict({ ...back, promptOpen: true })).toBe('hold');
  });

  it('still lets a leave through while the dialog is open, if the leave is the page\'s own', () => {
    expect(NavigationGuardHelper.verdict({ ...back, promptOpen: true, leaving: true })).toBe('allow');
  });

  describe('a window of the page is open', () => {
    it('closes the window first instead of asking about leaving: Back means "close what is in front of me"', () => {
      expect(NavigationGuardHelper.verdict({ ...back, windowOpen: true })).toBe('close-window');
    });

    it('asks about leaving on the next Back, once the window is gone', () => {
      expect(NavigationGuardHelper.verdict({ ...back, windowOpen: false })).toBe('prompt');
    });

    it('does not close it for a navigation that stays on the page, or for a leave the page started itself', () => {
      expect(NavigationGuardHelper.verdict({ ...back, windowOpen: true, nextUrl: '/game?x=1' })).toBe('allow');
      expect(NavigationGuardHelper.verdict({ ...back, windowOpen: true, leaving: true })).toBe('allow');
    });

    it('closes it during the boot too: ?host=1 has the room dialog up before the emulator exists, and a Back that left would strand it', () => {
      expect(NavigationGuardHelper.verdict({ ...back, windowOpen: true, hasEmulator: false })).toBe('close-window');
    });

    it('lets Back leave during the boot when no window is open: there is no emulator to lose and nothing to close first', () => {
      expect(NavigationGuardHelper.verdict({ ...back, windowOpen: false, hasEmulator: false })).toBe('allow');
    });

    it('still lets the page\'s own leave through with a window open and no emulator', () => {
      expect(NavigationGuardHelper.verdict({ ...back, windowOpen: true, hasEmulator: false, leaving: true })).toBe('allow');
    });

    it('holds when the leave dialog is the thing on screen, even with a window under it', () => {
      expect(NavigationGuardHelper.verdict({ ...back, windowOpen: true, promptOpen: true })).toBe('hold');
    });
  });

  describe('pathOf', () => {
    it('drops the query string and the fragment', () => {
      expect(NavigationGuardHelper.pathOf('/game?host=1')).toBe('/game');
      expect(NavigationGuardHelper.pathOf('/game#top')).toBe('/game');
      expect(NavigationGuardHelper.pathOf('/game?a=1#top')).toBe('/game');
      expect(NavigationGuardHelper.pathOf('/game')).toBe('/game');
    });
  });
});
