import { TouchMode, TouchModeHelper } from './touch-mode.helper';

const UA = {
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; SM-A075M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Mobile Safari/537.36',
  // What "Request desktop site" sends on the same phone.
  androidDesktopSite: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
  iPhone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  // iPadOS before 13, and the iPad when it is told not to pretend to be a Mac.
  iPadMobile: 'Mozilla/5.0 (iPad; CPU OS 12_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.0 Mobile/15E148 Safari/604.1',
  // The iPadOS default since 13: indistinguishable from Safari on a Mac.
  iPadDefault: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  desktopChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
};

describe('TouchModeHelper', () => {

  describe('normalise', () => {

    it('is direct for everything that is not the one stored word for classic', () => {
      expect(TouchModeHelper.normalise('classic')).toBe('classic');
      expect(TouchModeHelper.normalise('direct')).toBe('direct');
      expect(TouchModeHelper.normalise(undefined)).toBe('direct');
      expect(TouchModeHelper.normalise(null)).toBe('direct');
      expect(TouchModeHelper.normalise('')).toBe('direct');
      expect(TouchModeHelper.normalise('Classic')).toBe('direct');
      expect(TouchModeHelper.normalise(true)).toBe('direct');
    });
  });

  describe('stockTouchWorks', () => {

    it('is js-dos\'s own test: only user agents that name a phone get its touchpad', () => {
      expect(TouchModeHelper.stockTouchWorks(UA.androidChrome)).toBeTrue();
      expect(TouchModeHelper.stockTouchWorks(UA.iPhone)).toBeTrue();
      expect(TouchModeHelper.stockTouchWorks(UA.iPadMobile)).toBeTrue();
    });

    it('is false for an iPad that reports itself as a Mac, which js-dos gives no touch input at all', () => {
      expect(TouchModeHelper.stockTouchWorks(UA.iPadDefault)).toBeFalse();
    });

    it('is false for a phone asked for its desktop site, and for a desktop', () => {
      expect(TouchModeHelper.stockTouchWorks(UA.androidDesktopSite)).toBeFalse();
      expect(TouchModeHelper.stockTouchWorks(UA.desktopChrome)).toBeFalse();
    });
  });

  describe('effective', () => {

    it('honours classic where js-dos can run it', () => {
      expect(TouchModeHelper.effective('classic', UA.androidChrome)).toBe('classic');
      expect(TouchModeHelper.effective('classic', UA.iPhone)).toBe('classic');
    });

    it('turns classic into direct where it would leave a dead screen', () => {
      expect(TouchModeHelper.effective('classic', UA.iPadDefault)).toBe('direct');
      expect(TouchModeHelper.effective('classic', UA.androidDesktopSite)).toBe('direct');
      expect(TouchModeHelper.effective('classic', UA.desktopChrome)).toBe('direct');
    });

    it('leaves direct alone everywhere', () => {
      for (const agent of Object.values(UA)) expect(TouchModeHelper.effective('direct', agent)).toBe('direct');
    });
  });

  describe('offersChoice', () => {

    it('is offered on a phone, where touch is the primary pointer and classic works', () => {
      expect(TouchModeHelper.offersChoice(true, UA.androidChrome)).toBeTrue();
      expect(TouchModeHelper.offersChoice(true, UA.iPhone)).toBeTrue();
    });

    it('is not offered to a mouse, even on a user agent that names a phone', () => {
      expect(TouchModeHelper.offersChoice(false, UA.androidChrome)).toBeFalse();
    });

    it('is not offered on a default-UA iPad, where choosing classic would break it', () => {
      expect(TouchModeHelper.offersChoice(true, UA.iPadDefault)).toBeFalse();
    });
  });

  describe('labels', () => {

    it('names both modes, default first, in Portuguese', () => {
      const modes: TouchMode[] = TouchModeHelper.modes();
      expect(modes).toEqual(['direct', 'classic']);
      expect(modes.map(mode => TouchModeHelper.label(mode))).toEqual(['Direto (padrão)', 'Touchpad (clássico)']);
    });
  });
});
