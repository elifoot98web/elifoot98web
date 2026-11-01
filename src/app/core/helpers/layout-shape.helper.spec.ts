import { LayoutShapeHelper, LayoutViewport } from './layout-shape.helper';

const vp = (width: number, height: number): LayoutViewport => ({ width, height });

describe('LayoutShapeHelper', () => {

  describe('of', () => {

    it('calls every portrait phone portrait', () => {
      for (const [w, h] of [[360, 640], [375, 667], [393, 852], [412, 915], [430, 932], [320, 568]]) {
        expect(LayoutShapeHelper.of(w, h)).withContext(`${w}x${h}`).toBe('portrait');
      }
    });

    it('calls every landscape phone compact, notched or not', () => {
      for (const [w, h] of [[844, 390], [932, 430], [667, 375], [915, 412], [640, 360], [568, 320], [812, 375]]) {
        expect(LayoutShapeHelper.of(w, h)).withContext(`${w}x${h}`).toBe('landscape-compact');
      }
    });

    it('calls a tablet or a laptop window in landscape regular, which keeps its toolbar', () => {
      for (const [w, h] of [[1280, 800], [1180, 820], [1024, 768], [1366, 650], [1133, 744], [1920, 1080]]) {
        expect(LayoutShapeHelper.of(w, h)).withContext(`${w}x${h}`).toBe('landscape-regular');
      }
    });

    it('calls a tablet in portrait portrait', () => {
      expect(LayoutShapeHelper.of(820, 1180)).toBe('portrait');
      expect(LayoutShapeHelper.of(768, 1024)).toBe('portrait');
    });

    it('draws the compact line at 500 px of height, inclusive', () => {
      expect(LayoutShapeHelper.of(900, 500)).toBe('landscape-compact');
      expect(LayoutShapeHelper.of(900, 501)).toBe('landscape-regular');
    });

    it('agrees with (orientation: portrait) on a square window, which is portrait', () => {
      expect(LayoutShapeHelper.of(700, 700)).toBe('portrait');
    });
  });

  describe('hasHeader', () => {

    it('drops the toolbar only where the height is the scarce thing', () => {
      expect(LayoutShapeHelper.hasHeader('portrait')).toBeTrue();
      expect(LayoutShapeHelper.hasHeader('landscape-regular')).toBeTrue();
      expect(LayoutShapeHelper.hasHeader('landscape-compact')).toBeFalse();
    });
  });

  describe('settle', () => {

    it('believes the first measurement', () => {
      expect(LayoutShapeHelper.settle(null, vp(390, 844), false)).toEqual(vp(390, 844));
    });

    it('believes a rotation', () => {
      expect(LayoutShapeHelper.settle(vp(390, 844), vp(844, 390), false)).toEqual(vp(844, 390));
      // Even with a field focused: a rotation changes the width.
      expect(LayoutShapeHelper.settle(vp(390, 844), vp(844, 390), true)).toEqual(vp(844, 390));
    });

    it('ignores a keyboard that shrank the window while a field has the focus', () => {
      expect(LayoutShapeHelper.settle(vp(390, 844), vp(390, 420), true)).toEqual(vp(390, 844));
      expect(LayoutShapeHelper.settle(vp(844, 390), vp(844, 160), true)).toEqual(vp(844, 390));
    });

    it('believes the same shrink when nothing is being edited (the window really got smaller)', () => {
      expect(LayoutShapeHelper.settle(vp(390, 844), vp(390, 420), false)).toEqual(vp(390, 420));
    });

    it('believes a small shrink with a field focused: that is browser chrome, not a keyboard', () => {
      expect(LayoutShapeHelper.settle(vp(390, 844), vp(390, 780), true)).toEqual(vp(390, 780));
    });

    it('believes the height coming back when the keyboard closes', () => {
      expect(LayoutShapeHelper.settle(vp(390, 844), vp(390, 844), true)).toEqual(vp(390, 844));
      expect(LayoutShapeHelper.settle(vp(390, 844), vp(390, 860), false)).toEqual(vp(390, 860));
    });

    it('never lets a keyboard turn a regular landscape window into a compact one', () => {
      const before = vp(1180, 820);
      const withKeyboard = LayoutShapeHelper.settle(before, vp(1180, 420), true);

      expect(LayoutShapeHelper.of(withKeyboard.width, withKeyboard.height)).toBe('landscape-regular');
    });
  });

  it('compares viewports by value', () => {
    expect(LayoutShapeHelper.sameViewport(vp(1, 2), vp(1, 2))).toBeTrue();
    expect(LayoutShapeHelper.sameViewport(vp(1, 2), vp(1, 3))).toBeFalse();
  });
});
