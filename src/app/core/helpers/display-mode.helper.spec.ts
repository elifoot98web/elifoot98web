import { DisplayMode, DisplayModeHelper } from './display-mode.helper';

describe('DisplayModeHelper', () => {

  describe('fromFrameSize', () => {

    it('reads the two sizes the bundle can boot into', () => {
      expect(DisplayModeHelper.fromFrameSize(640, 480)).toBe('640');
      expect(DisplayModeHelper.fromFrameSize(800, 600)).toBe('800');
    });

    it('answers null for DOS\'s text frame: Windows has exited, and the game is in neither mode', () => {
      expect(DisplayModeHelper.fromFrameSize(640, 400)).toBeNull();
      expect(DisplayModeHelper.fromFrameSize(720, 400)).toBeNull();
    });

    it('answers null for an emulator that has not drawn a frame yet', () => {
      expect(DisplayModeHelper.fromFrameSize(0, 0)).toBeNull();
    });

    it('does not guess from one dimension: a size has to match on both', () => {
      expect(DisplayModeHelper.fromFrameSize(640, 600)).toBeNull();
      expect(DisplayModeHelper.fromFrameSize(800, 480)).toBeNull();
    });

    it('does not offer the modes the driver could do but the app never booted', () => {
      expect(DisplayModeHelper.fromFrameSize(1024, 768)).toBeNull();
    });
  });

  describe('label', () => {

    it('names the modes the way the options dialog lists them', () => {
      expect(DisplayModeHelper.label('640')).toBe('640x480 (maior)');
      expect(DisplayModeHelper.label('800')).toBe('800x600 (clássico)');
    });
  });

  describe('modes', () => {

    it('lists the default first and every mode once, each of which has a label and a size', () => {
      const modes = DisplayModeHelper.modes();

      expect(modes).toEqual(['640', '800']);
      for (const mode of modes as DisplayMode[]) {
        expect(DisplayModeHelper.label(mode)).toContain('x');
        const [width, height] = DisplayModeHelper.label(mode).split(' ')[0].split('x').map(Number);
        expect(DisplayModeHelper.fromFrameSize(width, height)).toBe(mode);
      }
    });
  });
});
