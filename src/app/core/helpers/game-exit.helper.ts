import { GAME_EXIT_SIGNATURE } from '../models/constants';
import { PixelFrame } from './ocr-region.helper';

/** What {@link GameExitHelper.inspect} counted, for the verdict and for the diagnostics log. */
export interface GameExitReading {
  /** The frame is a graphics mode big enough to be Windows; anything else cannot be the desktop. */
  graphics: boolean;
  /** Grid samples taken outside the Program Manager's icon. */
  sampled: number;
  /** ... of which were the desktop colour. */
  desktop: number;
  /** White pixels inside the icon's box (its title and highlights). */
  iconWhite: number;
  /** Pixels inside the icon's box that are not the desktop colour (the icon and its title bar). */
  iconInk: number;
}

/**
 * Tells, from one frame of the guest, whether Elifoot has exited and left Windows 3.1 on its bare
 * desktop with the Program Manager as an icon.
 *
 * The boot chain runs `win D:\ELI98\ELIFOOT.EXE` and nothing else, so when the game quits (Esc or
 * Cancelar in its first dialog, Enter before a choice is made, a crash) this is where the player
 * lands, with no way back but a reload. Nothing in the guest says so: the only evidence is the
 * picture.
 *
 * **Why this is a picture of the desktop and not the loss of the game's green.** Load detection
 * samples four points of the game's green BACKDROP, which at 800x600 shows around the game window
 * for as long as the game runs. At 640x480 the window fills the frame and hides it, so the four
 * points read the menu bar and the squad list during ordinary play: "green lost" is the normal
 * state there, and the probe is a boot-only signal. The question this answers has to be asked of
 * the desktop's own colour instead.
 *
 * **The signature is nearly the whole frame.** The desktop is a flat (0, 64, 128) and the Program
 * Manager is the one thing on it, an icon at the bottom left. A scan every few pixels must find the
 * desktop colour everywhere except in that icon's box (and a few samples for the mouse cursor,
 * which is drawn into the frame), and the box must hold the icon: white text and some ink. That is
 * strict on purpose. Elifoot never draws the desktop colour at all (checked over ~120 real
 * frames), and the other programs that share the screen with it, the team editor and the Program
 * Manager window, leave it a third and under half of the frame. A second icon beside the Program
 * Manager's, which is what a minimised Elifoot looks like, is not an exit and fails the scan.
 *
 * Kept free of Angular and of the DOM so it can be tested on plain arrays.
 */
export class GameExitHelper {

  static isProgramManagerDesktop(frame: PixelFrame): boolean {
    return GameExitHelper.verdict(GameExitHelper.inspect(frame));
  }

  /** The decision, separated from the counting so a log line can carry the counts it was made on. */
  static verdict(reading: GameExitReading): boolean {
    const { MAX_STRAY_SAMPLES, ICON_MIN_WHITE_PIXELS, ICON_MIN_INK_PIXELS } = GAME_EXIT_SIGNATURE;
    return reading.graphics
      && reading.sampled - reading.desktop <= MAX_STRAY_SAMPLES
      && reading.iconWhite >= ICON_MIN_WHITE_PIXELS
      && reading.iconInk >= ICON_MIN_INK_PIXELS;
  }

  static inspect(frame: PixelFrame): GameExitReading {
    const { MIN_WIDTH, MIN_HEIGHT } = GAME_EXIT_SIGNATURE;
    const empty: GameExitReading = { graphics: false, sampled: 0, desktop: 0, iconWhite: 0, iconInk: 0 };
    if (frame.width < MIN_WIDTH || frame.height < MIN_HEIGHT) return empty;

    const box = GameExitHelper.iconBox(frame.height);
    const { GRID_STEP } = GAME_EXIT_SIGNATURE;
    const half = GRID_STEP >> 1;

    let sampled = 0;
    let desktop = 0;
    for (let y = half; y < frame.height; y += GRID_STEP) {
      for (let x = half; x < frame.width; x += GRID_STEP) {
        if (GameExitHelper.inside(box, x, y)) continue;
        sampled++;
        if (GameExitHelper.isDesktop(frame, x, y)) desktop++;
      }
    }

    let iconWhite = 0;
    let iconInk = 0;
    const { ICON_WHITE_MIN_CHANNEL } = GAME_EXIT_SIGNATURE;
    for (let y = box.top; y < box.top + box.height; y++) {
      for (let x = box.left; x < box.left + box.width; x++) {
        const index = (y * frame.width + x) * 4;
        const { data } = frame;
        if (data[index] >= ICON_WHITE_MIN_CHANNEL && data[index + 1] >= ICON_WHITE_MIN_CHANNEL && data[index + 2] >= ICON_WHITE_MIN_CHANNEL) {
          iconWhite++;
        }
        if (!GameExitHelper.isDesktop(frame, x, y)) iconInk++;
      }
    }

    return { graphics: true, sampled, desktop, iconWhite, iconInk };
  }

  /** The icon's box in a frame of this height: fixed distances from the bottom-left corner. */
  private static iconBox(frameHeight: number): { left: number; top: number; width: number; height: number } {
    const { LEFT, WIDTH, BOTTOM_INSET, HEIGHT } = GAME_EXIT_SIGNATURE.ICON_BOX;
    return { left: LEFT, top: frameHeight - BOTTOM_INSET - HEIGHT, width: WIDTH, height: HEIGHT };
  }

  private static inside(box: { left: number; top: number; width: number; height: number }, x: number, y: number): boolean {
    return x >= box.left && x < box.left + box.width && y >= box.top && y < box.top + box.height;
  }

  private static isDesktop(frame: PixelFrame, x: number, y: number): boolean {
    const { DESKTOP_COLOR, COLOR_TOLERANCE } = GAME_EXIT_SIGNATURE;
    const index = (y * frame.width + x) * 4;
    const { data } = frame;
    return Math.abs(data[index] - DESKTOP_COLOR.r) <= COLOR_TOLERANCE
      && Math.abs(data[index + 1] - DESKTOP_COLOR.g) <= COLOR_TOLERANCE
      && Math.abs(data[index + 2] - DESKTOP_COLOR.b) <= COLOR_TOLERANCE;
  }
}
