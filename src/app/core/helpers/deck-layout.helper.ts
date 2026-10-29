import { DECK } from '../models/constants';
import { LayoutShape, LayoutShapeHelper, LayoutViewport } from './layout-shape.helper';

/** Whether the control deck is shown. `auto` follows the device; the other two are the player's word. */
export type DeckSetting = 'auto' | 'on' | 'off';

/**
 * How the deck is presented, which is a pure function of the viewport, the orientation, what the
 * device is touched with and the player's setting:
 *
 * - `none`: no deck. A desktop with a physical keyboard and a mouse is not cluttered by default.
 * - `band`: a taskbar plus one panel at a time in the free band under the picture. Portrait only,
 *   because only a portrait page leaves one (a 4:3 picture on a phone uses a third of the height).
 * - `launcher`: a button that opens the same panels as a sheet over the page. Landscape has no
 *   free band (the picture takes the height and the width beside it is a gutter that is 70 px on
 *   the narrowest phone), and the sheet is an overlay precisely so that it cannot resize
 *   `#game-container`. Until the stage-layout phase builds rails, this is the landscape deck.
 *
 * `launcherHome` is where the button lives: in the toolbar when there is one, in the left gutter
 * when the header is dropped. It is never over the picture.
 */
export type DeckKind = 'none' | 'band' | 'launcher';
export type DeckLauncherHome = 'toolbar' | 'gutter';

export interface DeckPresentation {
  kind: DeckKind;
  shape: LayoutShape;
  hasHeader: boolean;
  launcherHome: DeckLauncherHome | null;
}

export interface DeckLayoutInput {
  viewport: LayoutViewport;
  /** `(pointer: coarse)`: a finger is the primary way this device is used. */
  touchPrimary: boolean;
  setting: DeckSetting;
}

export class DeckLayoutHelper {

  /** A value out of storage is just another input: anything that is not 'on' or 'off' is automatic. */
  static normalise(stored: unknown): DeckSetting {
    return stored === 'on' || stored === 'off' ? stored : 'auto';
  }

  /**
   * Whether the deck is shown at all. Automatic follows the PRIMARY pointer: an iPad or a phone
   * has the deck, a laptop whose touch screen is a second input does not (it has a keyboard), and
   * a convertible gets it when the keyboard is folded away because its primary pointer changes.
   */
  static shows(setting: DeckSetting, touchPrimary: boolean): boolean {
    if (setting === 'on') return true;
    if (setting === 'off') return false;
    return touchPrimary;
  }

  /**
   * The height the portrait page leaves under the picture, from the viewport alone: the viewport,
   * less the toolbar, less the 4:3 picture the width fixes. An estimate, with no safe areas in it.
   */
  static bandHeight(viewport: LayoutViewport): number {
    const picture = Math.round(viewport.width * DECK.PICTURE_HEIGHT_PER_WIDTH);
    return Math.max(0, viewport.height - DECK.HEADER_HEIGHT - picture);
  }

  static presentation(input: DeckLayoutInput): DeckPresentation {
    const shape = LayoutShapeHelper.of(input.viewport.width, input.viewport.height);
    const hasHeader = LayoutShapeHelper.hasHeader(shape);

    if (!DeckLayoutHelper.shows(input.setting, input.touchPrimary)) {
      return { kind: 'none', shape, hasHeader, launcherHome: null };
    }
    if (shape === 'portrait' && DeckLayoutHelper.bandHeight(input.viewport) >= DECK.MIN_BAND_HEIGHT) {
      return { kind: 'band', shape, hasHeader, launcherHome: null };
    }
    return { kind: 'launcher', shape, hasHeader, launcherHome: hasHeader ? 'toolbar' : 'gutter' };
  }

  static samePresentation(a: DeckPresentation, b: DeckPresentation): boolean {
    return a.kind === b.kind && a.shape === b.shape && a.launcherHome === b.launcherHome;
  }

  /** What the menu and the dialog call a setting. */
  static label(setting: DeckSetting): string {
    switch (setting) {
      case 'on': return 'Sempre mostrar';
      case 'off': return 'Nunca mostrar';
      default: return 'Automático';
    }
  }

  /** What the dialog says under each choice, so "Automático" is not a riddle. */
  static describe(setting: DeckSetting): string {
    switch (setting) {
      case 'on': return 'O painel de teclas aparece em qualquer aparelho.';
      case 'off': return 'O painel de teclas nunca aparece.';
      default: return 'O painel aparece em celulares e tablets (telas de toque) e fica escondido no computador.';
    }
  }

  /** All settings, the default first. */
  static settings(): DeckSetting[] {
    return ['auto', 'on', 'off'];
  }
}
