import { FIELD_HINT } from '../models/constants';
import { FrameLike } from './caret-watch.helper';

/** What the look under the cursor found, with the numbers that led to it (for the diagnostics log and the specs). */
export interface IBeamLook {
  found: boolean;
  /** The stem's column and the sprite's top row, when found. */
  x: number | null;
  y: number | null;
  /** The stem pixels counted in the best window, and the serif that made it an I-beam. */
  stemRows: number;
  serif: 'top' | 'bottom' | 'both' | null;
}

const NOT_FOUND: IBeamLook = { found: false, x: null, y: null, stemRows: 0, serif: null };

/**
 * Is the guest's mouse cursor an I-beam? Windows shows one over an edit control, and the guest
 * draws its cursor into the frame, so after a tap the pixels around where the cursor was sent say
 * whether it landed on a text field. It is the immediate half of the field hint: a caret takes two
 * seconds to be seen (CaretWatcher), and a tap is where the player's attention already is.
 *
 * **What it looks for**, measured on the real game (the fixtures in field-hint.fixtures.ts): the
 * I-beam is an XOR cursor, a 17-row sprite made of a one pixel stem 15 rows tall between a top and a
 * bottom serif 7 pixels wide, in the inverse of what is under it: blue on the focused yellow field,
 * black on a white one. So it is found by shape against whatever the background is: a stem is a
 * column that differs from the columns two pixels either side of it while those two are alike, for
 * most of 15 rows, and a serif is a row of 7 pixels that all differ from the same row six pixels out.
 *
 * **The serif is what makes it an I-beam.** The arrow's black left edge is a 15 row stem with the
 * same background on both sides wherever it is drawn over a white list (the country list is one),
 * and a stem-only test calls every arrow over a white pane a field. The arrow has no 7 pixel row
 * at either end of its edge, which the specs check on real frames.
 *
 * The model's idea of the cursor is within 3 px of the truth (the touch harness measured it), so
 * the search covers a few pixels either side. Still only a hint: the splash text also shows an
 * I-beam, and a game that sets another cursor over a field would show none.
 */
export class IBeamHelper {

  /** Look for an I-beam around the guest pixel (x, y), where the cursor was last sent. */
  static look(frame: FrameLike, x: number, y: number): IBeamLook {
    const spread = FIELD_HINT.IBEAM_SEARCH_X;
    const topAbove = FIELD_HINT.IBEAM_TOP_ROWS_ABOVE_HOTSPOT;
    let best: IBeamLook = NOT_FOUND;

    for (let column = x - spread; column <= x + spread; column++) {
      for (let top = y - topAbove - FIELD_HINT.IBEAM_SEARCH_Y; top <= y - topAbove + FIELD_HINT.IBEAM_SEARCH_Y; top++) {
        const stemRows = IBeamHelper.stemRows(frame, column, top + 1);
        if (stemRows < FIELD_HINT.IBEAM_STEM_MIN_ROWS) continue;

        const topSerif = IBeamHelper.isSerif(frame, column, top);
        const bottomSerif = IBeamHelper.isSerif(frame, column, top + FIELD_HINT.IBEAM_STEM_ROWS + 1);
        if (!topSerif && !bottomSerif) continue;
        if (stemRows > best.stemRows || (stemRows === best.stemRows && topSerif && bottomSerif)) {
          best = {
            found: true, x: column, y: top, stemRows,
            serif: topSerif && bottomSerif ? 'both' : topSerif ? 'top' : 'bottom',
          };
        }
      }
    }
    return best;
  }

  /**
   * How many of the `IBEAM_STEM_ROWS` rows from `from` down are a one pixel stem at `column`. Public
   * so that a spec can show that the arrow's edge passes this test and is turned down by the serif.
   */
  static stemRows(frame: FrameLike, column: number, from: number): number {
    const gap = FIELD_HINT.IBEAM_STEM_NEIGHBOUR;
    let rows = 0;
    for (let row = from; row < from + FIELD_HINT.IBEAM_STEM_ROWS; row++) {
      const middle = IBeamHelper.pixel(frame, column, row);
      const left = IBeamHelper.pixel(frame, column - gap, row);
      const right = IBeamHelper.pixel(frame, column + gap, row);
      if (middle === null || left === null || right === null) return 0;
      if (IBeamHelper.distance(middle, left) >= FIELD_HINT.IBEAM_DIFF
        && IBeamHelper.distance(middle, right) >= FIELD_HINT.IBEAM_DIFF
        && IBeamHelper.distance(left, right) <= FIELD_HINT.IBEAM_SAME) {
        rows++;
      }
    }
    return rows;
  }

  /** A row of `2 * IBEAM_SERIF_HALF_WIDTH + 1` pixels centred on `column`, nearly all unlike the same row further out. */
  private static isSerif(frame: FrameLike, column: number, row: number): boolean {
    const reach = FIELD_HINT.IBEAM_SERIF_REFERENCE;
    const left = IBeamHelper.pixel(frame, column - reach, row);
    const right = IBeamHelper.pixel(frame, column + reach, row);
    if (left === null || right === null || IBeamHelper.distance(left, right) > FIELD_HINT.IBEAM_SAME) return false;

    let unlike = 0;
    for (let offset = -FIELD_HINT.IBEAM_SERIF_HALF_WIDTH; offset <= FIELD_HINT.IBEAM_SERIF_HALF_WIDTH; offset++) {
      const pixel = IBeamHelper.pixel(frame, column + offset, row);
      if (pixel !== null && IBeamHelper.distance(pixel, left) >= FIELD_HINT.IBEAM_DIFF) unlike++;
    }
    return unlike >= FIELD_HINT.IBEAM_SERIF_MIN_PIXELS;
  }

  private static pixel(frame: FrameLike, column: number, row: number): [number, number, number] | null {
    if (column < 0 || row < 0 || column >= frame.width || row >= frame.height) return null;
    const o = (row * frame.width + column) * 4;
    return [frame.data[o], frame.data[o + 1], frame.data[o + 2]];
  }

  private static distance(a: readonly number[], b: readonly number[]): number {
    return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  }
}
