import { TYPE_BAR } from '../models/constants';
import { LayoutShape } from './layout-shape.helper';

export interface TypeBarLayoutInput {
  shape: LayoutShape;
  viewportWidth: number;
  viewportHeight: number;
  /** The OS keyboard's height from KeyboardInsetService, `0` with none. */
  keyboardInset: number;
  /** The bottom edge of the picture, from the top of the viewport. */
  pictureBottom: number;
}

/**
 * Whether the live type bar is the full window (title, field, two rows of keys) or folds into one
 * row. A pure function of the viewport, the keyboard and the picture, so the matrix of real phones
 * is numbers in a spec and not a guess.
 *
 * **The bar never makes room: it covers.** It is fixed to the bottom of the screen above the OS
 * keyboard, so it sits over the band under the picture, and when the keyboard is tall it reaches
 * up over the picture's lower edge. The full bar is used only while it fits between the picture and
 * the keyboard, so it hides nothing of the game; otherwise one row (56 px) is used, which is also
 * all a landscape phone gets: its keyboard covers 55-60% of the screen and the picture is what is
 * left, so there is nothing to protect that a taller bar would add to, and the compose dialog
 * (the other option) would cover the same pixels and put its buttons under the keyboard. With no
 * keyboard in a portrait page the bar is the full one, over the band, which is free.
 *
 * It depends on the keyboard and so can change while the player types, which is why the field is
 * the same element in both layouts (only CSS differs): a field that was re-created would lose the
 * focus and close the keyboard it had just opened.
 */
export class TypeBarLayoutHelper {

  /** Room the full bar needs at this width. */
  static fullHeight(viewportWidth: number): number {
    return viewportWidth >= TYPE_BAR.WIDE_STRIP_MIN_WIDTH ? TYPE_BAR.FULL_HEIGHT_WIDE : TYPE_BAR.FULL_HEIGHT_NARROW;
  }

  /** Whether the bar folds into one row. */
  static folds(input: TypeBarLayoutInput): boolean {
    if (input.shape !== 'portrait') return true;
    if (input.keyboardInset <= 0) return false;
    const room = input.viewportHeight - input.keyboardInset - input.pictureBottom;
    return room < TypeBarLayoutHelper.fullHeight(input.viewportWidth);
  }
}
