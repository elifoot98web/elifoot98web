import { TypeBarLayoutHelper, TypeBarLayoutInput } from './type-bar-layout.helper';

describe('TypeBarLayoutHelper', () => {

  const portrait = (over: Partial<TypeBarLayoutInput>): TypeBarLayoutInput => ({
    shape: 'portrait', viewportWidth: 393, viewportHeight: 852, keyboardInset: 0, pictureBottom: 351, ...over,
  });

  describe('a portrait page', () => {

    it('is the full bar with no keyboard: it sits over the free band', () => {
      expect(TypeBarLayoutHelper.folds(portrait({ keyboardInset: 0 }))).toBeFalse();
    });

    it('is the full bar while it fits between the picture and the keyboard, to the pixel', () => {
      const room = TypeBarLayoutHelper.fullHeight(393);
      const inset = 852 - 351 - room;
      expect(TypeBarLayoutHelper.folds(portrait({ keyboardInset: inset }))).toBeFalse();
      expect(TypeBarLayoutHelper.folds(portrait({ keyboardInset: inset + 1 }))).toBeTrue();
    });

    it('folds on a short phone, where a Gboard-sized keyboard leaves it no room (360x740)', () => {
      expect(TypeBarLayoutHelper.folds(portrait({ viewportWidth: 360, viewportHeight: 740, pictureBottom: 326, keyboardInset: 310 }))).toBeTrue();
    });

    it('keeps the full bar on a tall one (430x932 in a browser tab, an iOS keyboard of 336)', () => {
      expect(TypeBarLayoutHelper.folds(portrait({ viewportWidth: 430, viewportHeight: 932, pictureBottom: 378, keyboardInset: 336 }))).toBeFalse();
    });

    it('folds the same phone installed, where the status bar pushes the picture down by 59', () => {
      expect(TypeBarLayoutHelper.folds(portrait({ viewportWidth: 430, viewportHeight: 932, pictureBottom: 437, keyboardInset: 336 }))).toBeTrue();
    });

    it('needs less room from a wide strip: a tablet\'s single row of keys', () => {
      expect(TypeBarLayoutHelper.fullHeight(820)).toBeLessThan(TypeBarLayoutHelper.fullHeight(393));
      // 820x1180, picture 615 tall under a 56 px header, a 300 px keyboard: 1180 - 300 - 671 = 209.
      expect(TypeBarLayoutHelper.folds(portrait({ viewportWidth: 820, viewportHeight: 1180, pictureBottom: 671, keyboardInset: 300 }))).toBeFalse();
    });
  });

  describe('a landscape page', () => {

    it('is always one row: the keyboard covers more than half of it', () => {
      for (const shape of ['landscape-compact', 'landscape-regular'] as const) {
        expect(TypeBarLayoutHelper.folds({ shape, viewportWidth: 844, viewportHeight: 390, keyboardInset: 0, pictureBottom: 390 })).toBeTrue();
        expect(TypeBarLayoutHelper.folds({ shape, viewportWidth: 844, viewportHeight: 390, keyboardInset: 200, pictureBottom: 390 })).toBeTrue();
      }
    });
  });
});
