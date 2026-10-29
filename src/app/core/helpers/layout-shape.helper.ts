import { DECK } from '../models/constants';

/**
 * The shape of the page, apart from what the device is touched with. `landscape-compact` is the
 * short landscape of a phone, where a toolbar would cost the picture a seventh of its height and
 * the header is dropped; `landscape-regular` is a tablet or a laptop window, which keeps it.
 */
export type LayoutShape = 'portrait' | 'landscape-compact' | 'landscape-regular';

/** What the window measures, in css px: the layout viewport, which the page is laid out in. */
export interface LayoutViewport {
  width: number;
  height: number;
}

/**
 * The layout half of what `LayoutHelperService.isMobile` used to say. That one answered three
 * different questions with one number (a viewport under 768 px, or a landscape one under 768 tall):
 * which layout to use, whether to drop the header and whether this is a touch device. A laptop
 * window 650 px tall was "mobile landscape" and lost its header; the same iPad was one thing in a
 * Safari tab and another installed. The questions are now separate: the shape is this, and what
 * the device is touched with is `(pointer: coarse)` / `(any-pointer: coarse)` (LayoutHelperService).
 *
 * Pure, and free of Angular and of the DOM, so the matrix of real viewports can be tested as numbers.
 */
export class LayoutShapeHelper {

  /**
   * Portrait is a viewport at least as tall as it is wide, which is what `(orientation: portrait)`
   * says in the stylesheets, so a square window is portrait in both places.
   */
  static of(width: number, height: number): LayoutShape {
    if (width <= height) return 'portrait';
    return height <= DECK.LANDSCAPE_COMPACT_MAX_HEIGHT ? 'landscape-compact' : 'landscape-regular';
  }

  /** The toolbar is dropped only where the height is the scarce thing. */
  static hasHeader(shape: LayoutShape): boolean {
    return shape !== 'landscape-compact';
  }

  /** Two viewports that lay the page out the same way. */
  static sameViewport(a: LayoutViewport, b: LayoutViewport): boolean {
    return a.width === b.width && a.height === b.height;
  }

  /**
   * The viewport the page should be laid out in, given the one it had and the one the window
   * reports now.
   *
   * The OS keyboard is not a layout: the page's contract is that the picture, the deck and the
   * header depend on the viewport and the orientation and on nothing the player is doing with a
   * text field. Chrome and Safari keep `innerHeight` when a keyboard opens, but a browser that
   * resizes the layout viewport for it (older Android WebViews, some OEM browsers) reports a
   * window half as tall, and a deck that chose its presentation from that would flip between the
   * band and the launcher, or lose the header in landscape, every time a field is focused. So a
   * drop to `KEYBOARD_HEIGHT_RATIO` of the height or less, at the same width, while an editable
   * element has the focus, is the keyboard and changes nothing. Anything else (a rotation, a
   * resize, the keyboard closing, which brings the height back) is believed.
   */
  static settle(previous: LayoutViewport | null, reported: LayoutViewport, editableFocused: boolean): LayoutViewport {
    if (!previous) return reported;
    const keyboard = editableFocused
      && reported.width === previous.width
      && reported.height < previous.height
      && reported.height <= previous.height * DECK.KEYBOARD_HEIGHT_RATIO;
    return keyboard ? previous : reported;
  }
}
