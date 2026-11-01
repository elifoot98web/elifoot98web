import { EMULATOR_CONTROL_CONFIG } from '../models/constants';

/** A rectangle of the guest's framebuffer, in its pixels. */
export interface PixelRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** What {@link OcrRegionHelper} reads of a frame; `ImageData` satisfies it. */
export interface PixelFrame {
  width: number;
  height: number;
  /** RGBA, row by row, as in `ImageData.data`. */
  data: ArrayLike<number>;
}

/**
 * Where to look in the guest's frame for the game's own "A gravar o jogo..." dialog, and a
 * cheap fingerprint of what is there.
 *
 * Kept free of Angular, of the DOM and of tesseract so it can be tested on plain arrays.
 */
export class OcrRegionHelper {

  /**
   * The strip holding the dialog's title, found from the CENTRE of the frame rather than from a
   * corner. The dialog is centred and does not change size with the video mode, so this is the
   * same crop at every resolution: (332, 275) at 800x600 and (252, 215) at 640x480.
   *
   * Clamped inside the frame, so a frame smaller than the strip (no real guest is) yields a
   * region that can still be read instead of one that runs off the buffer.
   */
  static savingDialogRegion(frameWidth: number, frameHeight: number): PixelRegion {
    const { OFFSET_X, OFFSET_Y, WIDTH, HEIGHT } = EMULATOR_CONTROL_CONFIG.SAVING_DIALOG_REGION;
    const width = Math.min(WIDTH, frameWidth);
    const height = Math.min(HEIGHT, frameHeight);
    const left = Math.round(frameWidth / 2 + OFFSET_X);
    const top = Math.round(frameHeight / 2 + OFFSET_Y);
    return {
      left: Math.max(0, Math.min(left, frameWidth - width)),
      top: Math.max(0, Math.min(top, frameHeight - height)),
      width,
      height,
    };
  }

  /**
   * A 32-bit FNV-1a fingerprint of every byte of `region`, alpha included. Two different
   * contents collide with a chance of about 2^-32, which for a change detector means one missed
   * change in four billion; and it costs about 0.1 ms for the 132x20 strip (10,560 bytes).
   *
   * It depends on the pixels of the region and on nothing else, so the same picture drawn at
   * another position or in a frame of another size fingerprints the same.
   */
  static hash(frame: PixelFrame, region: PixelRegion): number {
    const { data, width } = frame;
    const rowBytes = region.width * 4;
    let hash = 0x811c9dc5;
    for (let y = region.top; y < region.top + region.height; y++) {
      const start = (y * width + region.left) * 4;
      for (let i = start; i < start + rowBytes; i++) {
        hash ^= data[i];
        hash = Math.imul(hash, 0x01000193);
      }
    }
    return hash >>> 0;
  }
}
