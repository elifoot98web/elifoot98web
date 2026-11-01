import { InstallHelper, InstallMode } from './install.helper';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPAD_MOBILE = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_CLASS = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-A075M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Mobile Safari/537.36';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';

describe('InstallHelper', () => {
  describe('isStandalone', () => {
    const none = { displayStandalone: false, navigatorStandalone: undefined };

    it('is false in a browser tab', () => {
      expect(InstallHelper.isStandalone(none)).toBeFalse();
      expect(InstallHelper.isStandalone({ ...none, navigatorStandalone: false })).toBeFalse();
    });

    it('is true for the standalone display mode, which is what the manifest asks for', () => {
      expect(InstallHelper.isStandalone({ ...none, displayStandalone: true })).toBeTrue();
    });

    it('is true for iOS\'s own flag, which the media query does not report on every version', () => {
      expect(InstallHelper.isStandalone({ ...none, navigatorStandalone: true })).toBeTrue();
    });

    it('has no reading of the referrer: a tab opened from another app is a tab, not an installed app', () => {
      // Chrome on Android gives such a tab an android-app:// referrer for the life of the document; it must still be offered the install.
      expect(InstallHelper.isStandalone({ ...none, referrer: 'android-app://com.google.android.googlequicksearchbox/' } as typeof none)).toBeFalse();
    });
  });

  describe('isIos', () => {
    it('knows an iPhone, an iPod and an iPad by their user agent', () => {
      expect(InstallHelper.isIos({ userAgent: IPHONE, platform: 'iPhone', maxTouchPoints: 5 })).toBeTrue();
      expect(InstallHelper.isIos({ userAgent: IPAD_MOBILE, platform: 'iPad', maxTouchPoints: 5 })).toBeTrue();
    });

    it('knows an iPad that asks for the desktop site: a "Macintosh" with a touch screen, which no Mac has', () => {
      expect(InstallHelper.isIos({ userAgent: IPAD_DESKTOP_CLASS, platform: 'MacIntel', maxTouchPoints: 5 })).toBeTrue();
    });

    it('does not take a Mac, an Android phone or a Windows laptop for one', () => {
      expect(InstallHelper.isIos({ userAgent: IPAD_DESKTOP_CLASS, platform: 'MacIntel', maxTouchPoints: 0 })).toBeFalse();
      expect(InstallHelper.isIos({ userAgent: ANDROID, platform: 'Linux armv8l', maxTouchPoints: 5 })).toBeFalse();
      expect(InstallHelper.isIos({ userAgent: WINDOWS, platform: 'Win32', maxTouchPoints: 10 })).toBeFalse();
    });
  });

  describe('mode: the decision table', () => {
    // [standalone, hasPrompt, ios] -> mode. Installed beats everything: nothing is offered to an app already installed.
    const rows: Array<[boolean, boolean, boolean, InstallMode]> = [
      [true, true, true, 'installed'],
      [true, true, false, 'installed'],
      [true, false, true, 'installed'],
      [true, false, false, 'installed'],
      [false, true, true, 'prompt'],
      [false, true, false, 'prompt'],
      [false, false, true, 'ios'],
      [false, false, false, 'none'],
    ];
    for (const [standalone, hasPrompt, ios, expected] of rows) {
      it(`standalone ${standalone}, prompt ${hasPrompt}, iOS ${ios}: ${expected}`, () => {
        expect(InstallHelper.mode({ standalone, hasPrompt, ios })).toBe(expected);
      });
    }
  });

  describe('the words', () => {
    it('offers a menu entry only where there is something to do', () => {
      expect(InstallHelper.menuLabel('prompt')?.title).toBe('Instalar o app');
      expect(InstallHelper.menuLabel('ios')?.subtitle).toBe('Adicionar à Tela de Início');
      expect(InstallHelper.menuLabel('installed')).toBeNull();
      expect(InstallHelper.menuLabel('none')).toBeNull();
    });

    it('words the banner for the platform, in Portuguese', () => {
      expect(InstallHelper.bannerMessage('prompt')).toContain('instalar');
      expect(InstallHelper.bannerMessage('ios')).toContain('Tela de Início');
    });

    it('gives the iOS steps and, above all, the warning that the saves do not move between the browser and the installed app', () => {
      const { header, message } = InstallHelper.iosHowTo();

      expect(header).toBe('Adicionar à Tela de Início');
      expect(message).toContain('Compartilhar');
      expect(message).toContain('Adicionar à Tela de Início');
      expect(message).toContain('separado do navegador');
      // ...and the way across: the backup, by the names the menu uses.
      expect(message).toContain('Exportar jogos salvos');
      expect(message).toContain('Importar jogos salvos');
    });
  });
});
