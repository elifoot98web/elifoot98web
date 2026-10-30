import { FULLSCREEN } from '../models/constants';
import { FullscreenDocumentLike, FullscreenHelper } from './fullscreen.helper';

/** The documents of the browsers this decides for, as literals. */
const standard: FullscreenDocumentLike = {
  fullscreenEnabled: true,
  documentElement: { requestFullscreen: () => Promise.resolve() },
};
const iPad: FullscreenDocumentLike = {
  webkitFullscreenEnabled: true,
  documentElement: { webkitRequestFullscreen: () => undefined },
};
// iPhone Safari: no Fullscreen API for elements. Older versions leave the flag undefined, newer say false.
const iPhoneOld: FullscreenDocumentLike = { documentElement: {} };
const iPhoneNew: FullscreenDocumentLike = { fullscreenEnabled: false, webkitFullscreenEnabled: false, documentElement: {} };

describe('FullscreenHelper', () => {
  describe('supported', () => {
    it('is true for the standard API and for WebKit\'s prefixed one (iPad Safari)', () => {
      expect(FullscreenHelper.supported(standard)).toBeTrue();
      expect(FullscreenHelper.supported(iPad)).toBeTrue();
    });

    it('is false on an iPhone, however Safari words it, so the entry is not offered there', () => {
      expect(FullscreenHelper.supported(iPhoneOld)).toBeFalse();
      expect(FullscreenHelper.supported(iPhoneNew)).toBeFalse();
    });

    it('needs both the flag and the call: a browser that says yes and cannot do it is not offered', () => {
      expect(FullscreenHelper.supported({ fullscreenEnabled: true, documentElement: {} })).toBeFalse();
      expect(FullscreenHelper.supported({ documentElement: { requestFullscreen: () => Promise.resolve() } })).toBeFalse();
    });

    it('is false when the page is not allowed to (an iframe without the permission)', () => {
      expect(FullscreenHelper.supported({ ...standard, fullscreenEnabled: false })).toBeFalse();
    });
  });

  describe('active', () => {
    it('follows whichever property the browser has', () => {
      expect(FullscreenHelper.active(standard)).toBeFalse();
      expect(FullscreenHelper.active({ ...standard, fullscreenElement: document.body })).toBeTrue();
      expect(FullscreenHelper.active({ ...iPad, webkitFullscreenElement: document.body })).toBeTrue();
      expect(FullscreenHelper.active({ ...iPad, webkitFullscreenElement: null })).toBeFalse();
    });
  });

  describe('phoneInPortrait', () => {
    // viewport (css px), a finger is the primary pointer, expected
    const table: Array<[string, number, number, boolean, boolean]> = [
      ['an iPhone 15 Pro Max upright', 430, 932, true, true],
      ['a Galaxy A07 upright', 360, 800, true, true],
      ['an iPhone SE upright', 375, 667, true, true],
      ['a phone in a browser tab, short', 360, 512, true, true],
      ['a phone on its side', 932, 430, true, false],
      ['a square window', 400, 400, true, false],
      ['an iPad mini upright (768 wide)', 768, 1024, true, false],
      ['an iPad upright', 820, 1180, true, false],
      ['a narrow desktop window with a mouse', 360, 800, false, false],
      ['a tablet-sized window one pixel under the phone limit', FULLSCREEN.PHONE_MAX_SHORT_SIDE_PX - 1, 1000, true, true],
      ['a tablet-sized window at the limit', FULLSCREEN.PHONE_MAX_SHORT_SIDE_PX, 1000, true, false],
    ];
    for (const [name, width, height, coarse, expected] of table) {
      it(`${name} (${width}x${height}, finger ${coarse}): ${expected ? 'turn it' : 'say nothing'}`, () => {
        expect(FullscreenHelper.phoneInPortrait({ width, height }, coarse)).toBe(expected);
      });
    }
  });

  describe('shouldLockOrientation', () => {
    it('asks for landscape only where a finger is the primary pointer and the browser has the call', () => {
      expect(FullscreenHelper.shouldLockOrientation({ coarsePointer: true, canLock: true })).toBeTrue();
      expect(FullscreenHelper.shouldLockOrientation({ coarsePointer: true, canLock: false })).toBeFalse(); // iOS
      expect(FullscreenHelper.shouldLockOrientation({ coarsePointer: false, canLock: true })).toBeFalse(); // a desktop
      expect(FullscreenHelper.shouldLockOrientation({ coarsePointer: false, canLock: false })).toBeFalse();
    });
  });

  describe('describe', () => {
    it('says what the entry will do, including turning the screen', () => {
      expect(FullscreenHelper.describe(false, true)).toBe('Esconde a barra do navegador e deita a tela');
      expect(FullscreenHelper.describe(false, false)).toBe('Esconde a barra do navegador');
      expect(FullscreenHelper.describe(true, true)).toBe('Ligada · toque para sair');
    });
  });
});
