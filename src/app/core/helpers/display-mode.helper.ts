import { DISPLAY_MODE } from '../models/constants';

/**
 * The two video modes the guest can run in. The strings are the screen widths, which is also what
 * SYSTEM.INI calls them (`screen-size=640`), and they travel as radio values in the options dialog.
 */
export type DisplayMode = '640' | '800';

/**
 * Which video mode the guest is in, read off the size of its framebuffer, and how to say it.
 *
 * The mode is never stored. The only persisted fact is the flag file in the changes layer, and
 * that says what the NEXT boot will do; the frame says what this one did. Reading the frame keeps
 * the menu honest in every case a stored flag would not be: a layer restored from a backup, a
 * flag written and the reload not yet done, a boot that failed to switch.
 *
 * Kept free of Angular and of the DOM so it can be tested on plain numbers.
 */
export class DisplayModeHelper {

  /**
   * The mode a frame of this size belongs to, or `null` for any other size: DOS text mode (640x400,
   * the guest after Windows exits), the 0x0 of an emulator that has not drawn yet, or a mode this
   * app does not offer.
   */
  static fromFrameSize(width: number, height: number): DisplayMode | null {
    for (const mode of DisplayModeHelper.modes()) {
      const size = DISPLAY_MODE.SIZES[mode];
      if (size.width === width && size.height === height) return mode;
    }
    return null;
  }

  /** What the options dialog and the menu call a mode. */
  static label(mode: DisplayMode): string {
    return mode === '640' ? '640x480 (maior)' : '800x600 (clássico)';
  }

  /** Both modes, in the order the dialog lists them. */
  static modes(): DisplayMode[] {
    return ['640', '800'];
  }
}
