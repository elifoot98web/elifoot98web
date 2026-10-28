import { GAME_SCREEN_PROBE } from '../models/constants';
import { PixelFrame } from './ocr-region.helper';

/**
 * Where the guest is on its way to the game, in the order it gets there. `game` is the only one
 * that ends the wait; the rest only decide what the loader says.
 */
export type BootStage = 'dos' | 'windows' | 'elifoot' | 'game';

const STAGE_ORDER: readonly BootStage[] = ['dos', 'windows', 'elifoot', 'game'];

const STAGE_MESSAGES: Record<BootStage, string> = {
  dos: 'Iniciando o DOS…',
  windows: 'Abrindo o Windows 3.1…',
  elifoot: 'Carregando o Elifoot…',
  game: 'Abrindo o jogo…',
};

type Color = { r: number; g: number; b: number; a: number };

/**
 * Classifies a framebuffer into a stage of the boot, by looking at the same four pixels load
 * detection always looked at. js-dos exposes no guest-level state, so this is all there is.
 *
 * Measured on the real bundle (800x600): DOS is a 640x400 text frame, black with grey text;
 * Windows 3.1 then switches to graphics (800x600, black for a moment); its desktop is a flat
 * (0, 64, 128) with an hourglass while ELIFOOT.EXE loads; the game's splash is (0, 128, 0) with
 * a navy title bar. Kept free of Angular and of the DOM so it can be tested on plain arrays.
 */
export class BootStageHelper {

  /**
   * The detector `GamePage.loadGame()` has always used, moved here unchanged: the game's green
   * at three or more of eight (colour, point) pairs. Do not retune it without re-measuring both
   * resolutions.
   */
  static isGameScreen(frame: PixelFrame): boolean {
    const { POINTS, GAME_COLORS, GAME_MATCHES_NEEDED } = GAME_SCREEN_PROBE;
    let matches = 0;
    for (const expected of GAME_COLORS) {
      for (const point of POINTS) {
        if (BootStageHelper.matches(frame, point.x, point.y, expected)) matches++;
      }
    }
    return matches >= GAME_MATCHES_NEEDED;
  }

  static classify(frame: PixelFrame): BootStage {
    if (BootStageHelper.isGameScreen(frame)) return 'game';
    // Text mode is the only thing the guest draws under 480 lines tall.
    if (frame.height < GAME_SCREEN_PROBE.GRAPHICS_MIN_HEIGHT) return 'dos';

    const { POINTS, WINDOWS_DESKTOP_COLOR, DESKTOP_MATCHES_NEEDED } = GAME_SCREEN_PROBE;
    const onDesktop = POINTS.filter(point =>
      BootStageHelper.matches(frame, point.x, point.y, WINDOWS_DESKTOP_COLOR)).length;
    return onDesktop >= DESKTOP_MATCHES_NEEDED ? 'elifoot' : 'windows';
  }

  /**
   * The stage to show given the one shown and the one just seen. It never goes back: a black
   * frame between the desktop and the game's splash would otherwise flip the loader from
   * "Carregando o Elifoot…" back to "Abrindo o Windows 3.1…" for a moment.
   */
  static advance(shown: BootStage | null, seen: BootStage): BootStage {
    if (shown == null) return seen;
    return STAGE_ORDER.indexOf(seen) > STAGE_ORDER.indexOf(shown) ? seen : shown;
  }

  static message(stage: BootStage): string {
    return STAGE_MESSAGES[stage];
  }

  /** A point outside the frame matches nothing, instead of reading past the buffer. */
  private static matches(frame: PixelFrame, x: number, y: number, expected: Color): boolean {
    if (x >= frame.width || y >= frame.height) return false;
    const index = (y * frame.width + x) * 4;
    const { data } = frame;
    const tolerance = GAME_SCREEN_PROBE.TOLERANCE;
    return Math.abs(data[index] - expected.r) <= tolerance
      && Math.abs(data[index + 1] - expected.g) <= tolerance
      && Math.abs(data[index + 2] - expected.b) <= tolerance
      && Math.abs(data[index + 3] - expected.a) <= tolerance;
  }
}
