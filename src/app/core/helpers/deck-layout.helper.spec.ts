import { DECK } from '../models/constants';
import { DeckLayoutHelper, DeckPresentation, DeckSetting } from './deck-layout.helper';
import { LayoutViewport } from './layout-shape.helper';

const vp = (width: number, height: number): LayoutViewport => ({ width, height });
const present = (viewport: LayoutViewport, touchPrimary: boolean, setting: DeckSetting = 'auto'): DeckPresentation =>
  DeckLayoutHelper.presentation({ viewport, touchPrimary, setting });

describe('DeckLayoutHelper', () => {

  describe('normalise', () => {

    it('is automatic for everything that is not one of the two stored words', () => {
      expect(DeckLayoutHelper.normalise('on')).toBe('on');
      expect(DeckLayoutHelper.normalise('off')).toBe('off');
      expect(DeckLayoutHelper.normalise('auto')).toBe('auto');
      expect(DeckLayoutHelper.normalise(undefined)).toBe('auto');
      expect(DeckLayoutHelper.normalise(null)).toBe('auto');
      expect(DeckLayoutHelper.normalise('ON')).toBe('auto');
      expect(DeckLayoutHelper.normalise(true)).toBe('auto');
    });
  });

  describe('shows', () => {

    it('follows the primary pointer when automatic', () => {
      expect(DeckLayoutHelper.shows('auto', true)).toBeTrue();
      expect(DeckLayoutHelper.shows('auto', false)).toBeFalse();
    });

    it('obeys the player over the device, both ways', () => {
      expect(DeckLayoutHelper.shows('on', false)).toBeTrue();
      expect(DeckLayoutHelper.shows('off', true)).toBeFalse();
    });
  });

  describe('bandHeight', () => {

    it('is what the 4:3 picture leaves under the toolbar', () => {
      // 360x640: 56 of toolbar and 270 of picture leave 314 (the figure the chat's layout comment gives).
      expect(DeckLayoutHelper.bandHeight(vp(360, 640))).toBe(314);
      expect(DeckLayoutHelper.bandHeight(vp(390, 844))).toBe(844 - 56 - 293);
    });

    it('is never negative', () => {
      expect(DeckLayoutHelper.bandHeight(vp(900, 500))).toBe(0);
    });
  });

  describe('the screens the phase was verified on', () => {

    const PHONES_PORTRAIT: Array<[number, number]> = [[360, 640], [375, 667], [393, 852], [412, 915], [430, 932]];
    const PHONES_LANDSCAPE: Array<[number, number]> = [[844, 390], [932, 430], [667, 375]];

    it('gives every portrait phone the band, with the toolbar', () => {
      for (const [w, h] of PHONES_PORTRAIT) {
        expect(present(vp(w, h), true)).withContext(`${w}x${h}`)
          .toEqual({ kind: 'band', shape: 'portrait', hasHeader: true, launcherHome: null });
      }
    });

    it('gives every landscape phone a launcher in the gutter, because there is no toolbar to hold it', () => {
      for (const [w, h] of PHONES_LANDSCAPE) {
        expect(present(vp(w, h), true)).withContext(`${w}x${h}`)
          .toEqual({ kind: 'launcher', shape: 'landscape-compact', hasHeader: false, launcherHome: 'gutter' });
      }
    });

    it('gives a portrait tablet the band: 820x1180 leaves 509 px under the picture', () => {
      expect(present(vp(820, 1180), true).kind).toBe('band');
      expect(DeckLayoutHelper.bandHeight(vp(820, 1180))).toBe(509);
    });

    it('gives a landscape tablet a launcher in the toolbar: its picture takes the height', () => {
      expect(present(vp(1180, 820), true)).toEqual({ kind: 'launcher', shape: 'landscape-regular', hasHeader: true, launcherHome: 'toolbar' });
    });

    it('shows nothing on a desktop with a mouse, at 1280x800 or at any size', () => {
      expect(present(vp(1280, 800), false).kind).toBe('none');
      expect(present(vp(800, 1000), false).kind).toBe('none');
    });

    it('shows a touch window of 1280x800 the launcher in the toolbar', () => {
      expect(present(vp(1280, 800), true)).toEqual({ kind: 'launcher', shape: 'landscape-regular', hasHeader: true, launcherHome: 'toolbar' });
    });
  });

  describe('the setting', () => {

    it('lets a desktop player turn the deck on in any shape', () => {
      expect(present(vp(1280, 800), false, 'on').kind).toBe('launcher');
      expect(present(vp(800, 1000), false, 'on').kind).toBe('band');
      expect(present(vp(844, 390), false, 'on').launcherHome).toBe('gutter');
    });

    it('lets a phone player turn it off, and still says which shape the page has (the header depends on it)', () => {
      expect(present(vp(390, 844), true, 'off')).toEqual({ kind: 'none', shape: 'portrait', hasHeader: true, launcherHome: null });
      expect(present(vp(844, 390), true, 'off')).toEqual({ kind: 'none', shape: 'landscape-compact', hasHeader: false, launcherHome: null });
    });
  });

  describe('a portrait window with no room under the picture', () => {

    // The numbers of _deck.scss for a coarse pointer, written out so that MIN_BAND_HEIGHT cannot drift from them:
    // the dock's 2 px seam and the taskbar (a 48 px key, 4 px of padding twice and its own 2 px seam) are the chrome,
    // the panel pads 8 px top and bottom, and the Táticas grids share what is left less a 5 px gap, two thirds to the
    // formation rows (flex 2) and one third to A / M (flex 1), a 5 px gap between the two formation rows.
    const SEAM = 2, TASKBAR = 48 + 4 + 4 + 2, PANEL_PADDING = 16, GAP = 5;
    const formationRowAt = (band: number): number => {
      const inner = band - SEAM - TASKBAR - PANEL_PADDING;
      return (((inner - GAP) * 2) / 3 - GAP) / 2;
    };

    it('falls back to the launcher instead of squeezing a taskbar into nothing', () => {
      // 700x720: the picture is 525 tall, the toolbar 56, and 139 is left.
      expect(DeckLayoutHelper.bandHeight(vp(700, 720))).toBeLessThan(DECK.MIN_BAND_HEIGHT);
      expect(present(vp(700, 720), true)).toEqual({ kind: 'launcher', shape: 'portrait', hasHeader: true, launcherHome: 'toolbar' });
    });

    it('keeps the formation keys at the 44 px floor wherever it picks the band', () => {
      expect(formationRowAt(DECK.MIN_BAND_HEIGHT)).toBeGreaterThanOrEqual(44);
      // ...and is not needlessly timid: a band a few pixels under the threshold would already break the floor.
      expect(formationRowAt(DECK.MIN_BAND_HEIGHT - 8)).toBeLessThan(44);
    });

    it('gives the launcher to the window that used to get 32 px formation keys: a Chrome tab on a 360x640 phone', () => {
      // 360 wide and ~512 tall once the status bar, the URL bar and the navigation bar are taken: 186 px of band.
      expect(DeckLayoutHelper.bandHeight(vp(360, 512))).toBe(186);
      expect(present(vp(360, 512), true)).toEqual({ kind: 'launcher', shape: 'portrait', hasHeader: true, launcherHome: 'toolbar' });
    });

    it('gives an iPhone SE in a Safari tab (375x553, 216 px of band) the launcher too: its 42 px keys were under the floor', () => {
      expect(present(vp(375, 553), true).kind).toBe('launcher');
    });

    it('keeps the band for a phone with its full viewport (360x640, 314 px) and one that has just enough', () => {
      expect(present(vp(360, 640), true).kind).toBe('band');
      expect(present(vp(375, 562), true).kind).toBe('band');
    });
  });


  describe('samePresentation', () => {

    it('compares what the page lays out, so a resize that changes nothing repaints nothing', () => {
      expect(DeckLayoutHelper.samePresentation(present(vp(390, 844), true), present(vp(393, 852), true))).toBeTrue();
      expect(DeckLayoutHelper.samePresentation(present(vp(390, 844), true), present(vp(844, 390), true))).toBeFalse();
    });
  });

  describe('words', () => {

    it('lists the choices, automatic first, each in Portuguese with a line under it', () => {
      expect(DeckLayoutHelper.settings()).toEqual(['auto', 'on', 'off']);
      expect(DeckLayoutHelper.settings().map(setting => DeckLayoutHelper.label(setting))).toEqual(['Automático', 'Sempre mostrar', 'Nunca mostrar']);
      for (const setting of DeckLayoutHelper.settings()) {
        expect(DeckLayoutHelper.describe(setting).length).toBeGreaterThan(20);
      }
    });
  });
});
