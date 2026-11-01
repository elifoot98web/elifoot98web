import { GAME_EXIT_SIGNATURE } from '../models/constants';
import { GameExitHelper } from './game-exit.helper';
import { FrameName, loadFrame } from './game-exit.fixtures';

type Frame = Awaited<ReturnType<typeof loadFrame>>;

/**
 * The fixtures are real frames of the guest (see scripts/frame-fixtures): the Program Manager
 * desktop Elifoot leaves behind when it quits, at both sizes, and the screens that must never be
 * mistaken for it, among them the ones with the most blue in them (team-colour rows, the team
 * editor on the very same desktop, the Program Manager's own window).
 */
describe('GameExitHelper', () => {
  const frames = {} as Record<FrameName, Frame>;
  const NAMES: FrameName[] = [
    'programManager640', 'programManager640Cursor', 'programManager800',
    'acerca640', 'newGame640', 'squad640', 'liveMatch640', 'standings640', 'teamEditor640', 'programManagerWindow640',
  ];

  beforeAll(async () => {
    for (const name of NAMES) frames[name] = await loadFrame(name);
  });

  /** A copy that a spec can paint on without touching the shared fixture. */
  const copy = (frame: Frame): Frame => ({ width: frame.width, height: frame.height, data: new Uint8ClampedArray(frame.data) });

  const paint = (frame: Frame, x: number, y: number, width: number, height: number, [r, g, b]: [number, number, number]) => {
    for (let row = y; row < y + height; row++) {
      for (let column = x; column < x + width; column++) {
        const index = (row * frame.width + column) * 4;
        frame.data[index] = r;
        frame.data[index + 1] = g;
        frame.data[index + 2] = b;
      }
    }
  };

  const DESKTOP: [number, number, number] = [0, 64, 128];
  const WHITE: [number, number, number] = [248, 252, 248];
  const BLACK: [number, number, number] = [0, 0, 0];

  describe('on real frames', () => {
    it('recognises the desktop Elifoot leaves behind when it quits (Esc in its first dialog), at 640x480', () => {
      expect(GameExitHelper.isProgramManagerDesktop(frames.programManager640)).toBeTrue();
    });

    it('recognises it with the mouse cursor somewhere else on the screen', () => {
      expect(GameExitHelper.isProgramManagerDesktop(frames.programManager640Cursor)).toBeTrue();
    });

    it('recognises it at 800x600 (use800.flg), where the icon is the same distance from the bottom-left corner', () => {
      expect(GameExitHelper.isProgramManagerDesktop(frames.programManager800)).toBeTrue();
    });

    it('finds the desktop colour at all but the cursor\'s samples, and the icon where it was measured', () => {
      const reading = GameExitHelper.inspect(frames.programManager640);

      expect(reading.graphics).toBeTrue();
      expect(reading.sampled).toBeGreaterThan(4000);
      expect(reading.sampled - reading.desktop).toBeLessThanOrEqual(GAME_EXIT_SIGNATURE.MAX_STRAY_SAMPLES);
      expect(reading.iconWhite).toBeGreaterThanOrEqual(GAME_EXIT_SIGNATURE.ICON_MIN_WHITE_PIXELS);
      expect(reading.iconInk).toBeGreaterThanOrEqual(GAME_EXIT_SIGNATURE.ICON_MIN_INK_PIXELS);
    });

    for (const name of ['acerca640', 'newGame640', 'squad640'] as FrameName[]) {
      it(`does not take Elifoot's own ${name} for an exit`, () => {
        expect(GameExitHelper.isProgramManagerDesktop(frames[name])).toBeFalse();
      });
    }

    for (const name of ['liveMatch640', 'standings640'] as FrameName[]) {
      it(`does not take ${name}, with its team-colour blue rows, for an exit`, () => {
        const reading = GameExitHelper.inspect(frames[name]);

        expect(GameExitHelper.verdict(reading)).toBeFalse();
        // Not a near miss: the game never draws the desktop colour at all.
        expect(reading.desktop).toBe(0);
      });
    }

    it('does not take the team editor, which shares the screen with the same desktop, for an exit', () => {
      const reading = GameExitHelper.inspect(frames.teamEditor640);

      expect(reading.desktop).toBeGreaterThan(reading.sampled / 4);
      expect(GameExitHelper.verdict(reading)).toBeFalse();
    });

    it('does not take the Program Manager\'s own window, restored from its icon, for an exit', () => {
      expect(GameExitHelper.isProgramManagerDesktop(frames.programManagerWindow640)).toBeFalse();
    });
  });

  describe('on real frames with something changed', () => {
    it('still recognises it with the mouse cursor on top of the icon', () => {
      const frame = copy(frames.programManager640);
      // A 12x20 arrow: white with a black rim, drawn over the icon's title.
      paint(frame, 20, 440, 12, 20, BLACK);
      paint(frame, 21, 441, 10, 18, WHITE);

      expect(GameExitHelper.isProgramManagerDesktop(frame)).toBeTrue();
    });

    it('lets a few samples be something else (the cursor, an hourglass) and no more than that', () => {
      const frame = copy(frames.programManager640);
      const allowed = GAME_EXIT_SIGNATURE.MAX_STRAY_SAMPLES;
      const half = GAME_EXIT_SIGNATURE.GRID_STEP / 2;
      const strays = () => {
        const reading = GameExitHelper.inspect(frame);
        return reading.sampled - reading.desktop;
      };
      // The grid samples (half + step * i, half + step * j). Paint those samples, one pixel each, in a
      // clear part of the screen: the cursor in the fixture already accounts for a couple.
      let next = 0;
      const spoilOne = () => paint(frame, half + GAME_EXIT_SIGNATURE.GRID_STEP * (25 + next++), half + GAME_EXIT_SIGNATURE.GRID_STEP * 20, 1, 1, WHITE);

      while (strays() < allowed) spoilOne();
      expect(strays()).toBe(allowed);
      expect(GameExitHelper.isProgramManagerDesktop(frame)).toBeTrue();

      spoilOne();
      expect(strays()).toBe(allowed + 1);
      expect(GameExitHelper.isProgramManagerDesktop(frame)).toBeFalse();
    });

    it('does not take a minimised Elifoot (a second icon beside the Program Manager\'s) for an exit', () => {
      const frame = copy(frames.programManager640);
      // The icon and its title, copied 75 px to the right, which is where Windows puts the next one.
      for (let y = 410; y < 470; y++) {
        for (let x = 16; x < 62; x++) {
          const from = (y * frame.width + x) * 4;
          const to = (y * frame.width + x + 75) * 4;
          frame.data.set(frame.data.subarray(from, from + 4), to);
        }
      }

      expect(GameExitHelper.isProgramManagerDesktop(frame)).toBeFalse();
    });

    it('does not take a bare desktop with no Program Manager icon for an exit', () => {
      const frame = copy(frames.programManager640);
      paint(frame, 0, 400, 80, 80, DESKTOP);

      const reading = GameExitHelper.inspect(frame);
      expect(reading.iconInk).toBe(0);
      expect(GameExitHelper.verdict(reading)).toBeFalse();
    });

    it('does not take a small window on the desktop for an exit', () => {
      const frame = copy(frames.programManager640);
      paint(frame, 220, 180, 200, 100, WHITE);

      expect(GameExitHelper.isProgramManagerDesktop(frame)).toBeFalse();
    });

    it('only reads graphics modes: a DOS text frame the size of the screen is another stage', () => {
      const dos = { width: 640, height: 400, data: new Uint8ClampedArray(640 * 400 * 4).fill(0) };
      const empty = { width: 0, height: 0, data: new Uint8ClampedArray(0) };

      expect(GameExitHelper.isProgramManagerDesktop(dos)).toBeFalse();
      expect(GameExitHelper.isProgramManagerDesktop(empty)).toBeFalse();
    });
  });

  describe('verdict', () => {
    const ok = { graphics: true, sampled: 4728, desktop: 4726, iconWhite: 489, iconInk: 2035 };

    it('is the signature as measured', () => {
      expect(GameExitHelper.verdict(ok)).toBeTrue();
    });

    it('needs every part of it', () => {
      expect(GameExitHelper.verdict({ ...ok, graphics: false })).toBeFalse();
      expect(GameExitHelper.verdict({ ...ok, desktop: ok.sampled - GAME_EXIT_SIGNATURE.MAX_STRAY_SAMPLES - 1 })).toBeFalse();
      expect(GameExitHelper.verdict({ ...ok, iconWhite: GAME_EXIT_SIGNATURE.ICON_MIN_WHITE_PIXELS - 1 })).toBeFalse();
      expect(GameExitHelper.verdict({ ...ok, iconInk: GAME_EXIT_SIGNATURE.ICON_MIN_INK_PIXELS - 1 })).toBeFalse();
    });

    it('allows exactly the stray samples it says it does', () => {
      expect(GameExitHelper.verdict({ ...ok, desktop: ok.sampled - GAME_EXIT_SIGNATURE.MAX_STRAY_SAMPLES })).toBeTrue();
    });
  });
});
