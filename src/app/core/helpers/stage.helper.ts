import { STAGE } from '../models/constants';
import { LayoutShape } from './layout-shape.helper';

/** A size in css px. */
export interface StageSize {
  width: number;
  height: number;
}

/** Room taken from the edges of a box, in css px: the safe areas, the rails, the chat. */
export interface StageInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** The ratio of the picture as two integers (4:3), so a stage is always whole pixels. */
export interface StageRatio {
  width: number;
  height: number;
}

/**
 * "Tamanho da imagem": `fit` (Ajustar, the default) shows two columns of keys in each rail where they fit without costing
 * the picture, `wide` (Ampliar) always one. Neither crops the picture: magnifying and panning it is the camera's job
 * (CameraService), which does it INSIDE a stage whose box it never changes, and a cropped stage would change that box,
 * which is what the camera's contract forbids (CLAUDE.md, *The camera*).
 */
export type StageView = 'fit' | 'wide';

/** How many columns of keys a rail has; 0 is no rail. */
export type RailColumns = 0 | 1 | 2;

export const STAGE_RATIO: StageRatio = { width: STAGE.RATIO_WIDTH, height: STAGE.RATIO_HEIGHT };

/** What the stage is a function of, and nothing else: see {@link StageHelper.plan}. */
export interface StageInput {
  /** The box the page lays out in, in css px: the viewport less the toolbar where there is one. */
  box: StageSize;
  /** The settled shape of the window (LayoutShapeHelper), which decides whether there are rails at all. */
  shape: LayoutShape;
  /** `env(safe-area-inset-*)`, read from the page. Only the sides of a landscape phone are used. */
  insets: StageInsets;
  /** The control deck is shown: the rails carry keys. */
  keys: boolean;
  /** The chat is docked open beside the picture (landscape). */
  chat: boolean;
  view: StageView;
}

/**
 * The page's layout, as numbers. Every field is an answer, not a measurement: the CSS reads them (as custom properties,
 * StageLayoutService) and the components that draw the rails and the chat read the columns, so none of them can
 * disagree about where the picture is.
 */
export interface StagePlan {
  shape: LayoutShape;
  /** Columns of keys in the left rail. 0 where the toolbar holds the controls instead (everything but a landscape phone). */
  leftColumns: RailColumns;
  /** Columns of keys in the right rail. 0 when there is none: the chat has taken its place, or the deck is off. */
  rightColumns: RailColumns;
  /** The left rail is folded to icons (56 px) because the chat is docked beside the picture. */
  leftFolded: boolean;
  /** What the left side takes from the row, in px, the notch's inset included (a rail's face paints under the notch). */
  left: number;
  /** What the right side takes: the right rail, or the docked chat, or only the notch's inset, or nothing. */
  right: number;
  /** The width the chat dock has when it is open (inset included): its slide-out travels this far. 0 in portrait. */
  chatPanel: number;
  /** The width the chat holds now: `chatPanel` while it is docked open, otherwise 0. */
  chatDocked: number;
  /** The picture's box. In landscape the container of `#game-container` is exactly this size. */
  stage: StageSize;
  /**
   * Where the picture's box starts in the page's row, in whole px: the middle of the screen where the rails leave room for
   * it, pushed aside only as far as a rail or the chat requires. Integers, so no canvas is ever drawn on half a pixel, and
   * the same wherever the rails are or are not: turning the deck off does not slide the picture.
   */
  offset: { x: number; y: number };
}

const NONE: StageInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const ORIGIN = { x: 0, y: 0 };

/**
 * The stage: the box the 4:3 picture lives in, as a pure function, shared by the host's page and the spectator's.
 *
 * **The contract (CLAUDE.md, *The stage*): the stage's size depends on the box, the shape of the window, the safe areas,
 * whether the deck is shown (key rails), whether the chat is docked open and the view mode. It does NOT depend on what is
 * inside a panel, on the OS keyboard, on the chat's own state (its scroll, its roster), or on a transform.** Nothing in
 * here reads the DOM, a clock or a setting, so the table of real viewports is a table of numbers.
 *
 * It exists because the landscape picture used to be a by-product: `.game-stream-container` was `flex: 1`, js-dos fitted its
 * canvas inside whatever width the siblings left, and the gutters on either side of the picture belonged to the container,
 * so anything in them had to be an overlay on it. Now the container IS the picture and the gutters are rails.
 */
export class StageHelper {

  /** A value out of storage is just another input: anything that is not 'wide' is the default. */
  static normaliseView(stored: unknown): StageView {
    return stored === 'wide' ? 'wide' : 'fit';
  }

  static labelView(view: StageView): string {
    return view === 'wide' ? 'Ampliar' : 'Ajustar';
  }

  /**
   * The dialog's radio: the name, then what it does and no more. Today neither view changes the picture (measured at every
   * landscape phone, CLAUDE.md, *The stage*), so the words say columns of keys and never promise a bigger picture. The day the
   * camera gives `wide` a stage to grow, this is the sentence to change.
   */
  static describeView(view: StageView): string {
    return view === 'wide' ? 'Ampliar: uma coluna de teclas' : 'Ajustar: duas colunas de teclas onde cabem';
  }

  static views(): StageView[] {
    return ['fit', 'wide'];
  }

  /**
   * The largest box of the given ratio that fits `box` less the `reserved` edges, in whole pixels on both sides (a multiple
   * of the ratio's two integers, so 520x390 and never 521x390.75). Zero size when nothing fits.
   *
   * RATIO-based on purpose, like the spectator's `fitVideoToContainer`: it is the frame's shape that is fitted, never its
   * pixel count.
   */
  static fitStage(box: StageSize, ratio: StageRatio = STAGE_RATIO, reserved: StageInsets = NONE): StageSize {
    const width = Math.max(0, box.width - reserved.left - reserved.right);
    const height = Math.max(0, box.height - reserved.top - reserved.bottom);
    const unit = Math.floor(Math.min(width / ratio.width, height / ratio.height));
    return unit > 0 ? { width: unit * ratio.width, height: unit * ratio.height } : { width: 0, height: 0 };
  }

  /**
   * The width a picture as tall as the box would have: what no rail may take from it. Not `fitStage`, which also honours
   * the box's width: on a box narrower than that, even the thinnest rail costs picture and the question is moot.
   */
  static fullWidth(box: StageSize, ratio: StageRatio = STAGE_RATIO): number {
    return Math.floor(box.height / ratio.height) * ratio.width;
  }

  /** What a rail of `columns` keys takes, without the notch: padding, keys and the gaps between them. */
  static railWidth(columns: 1 | 2): number {
    const key = columns === 1 ? STAGE.RAIL_KEY_WIDTH_ONE_COLUMN : STAGE.RAIL_KEY_WIDTH_TWO_COLUMNS;
    return columns * key + (columns - 1) * STAGE.RAIL_GAP + 2 * STAGE.RAIL_PAD;
  }

  /** The left rail folded to icons while the chat is docked: one column of the narrowest keys there are, 56 px. */
  static foldedRailWidth(): number {
    return STAGE.RAIL_KEY_WIDTH_FOLDED + 2 * STAGE.RAIL_PAD;
  }

  /**
   * The chat dock of a window with no rails (a tablet, a laptop): what global.scss always gave it, 320 px, or 40% of
   * the window up to 300 px where that is 900 px wide or less.
   */
  static wideDock(viewportWidth: number): number {
    return viewportWidth <= STAGE.CHAT_NARROW_MAX_VIEWPORT
      ? Math.round(Math.min(STAGE.CHAT_NARROW, viewportWidth * STAGE.CHAT_NARROW_SHARE))
      : STAGE.CHAT_WIDE;
  }

  /**
   * The portrait stage: the width of the box and the 4:3 height under it, which is what `flex: 0 0 75vw` with a
   * `max-height: 100%` has always made of it. The page still pins it in CSS (a rule that needs no JavaScript to be right
   * on the first frame); this is the same answer for the log and for the spec.
   */
  static portraitStage(box: StageSize, ratio: StageRatio = STAGE_RATIO): StageSize {
    const height = Math.min(box.height, Math.round(box.width * ratio.height / ratio.width));
    return { width: Math.max(0, box.width), height: Math.max(0, height) };
  }

  /**
   * The whole layout of one page, from the few things it depends on.
   *
   * - **Portrait**: no rails, no dock; the chat goes under the picture. The stage is the width of the box.
   * - **Landscape, regular** (a tablet, a laptop: the toolbar stays): no rails. The chat docks on the right and the stage
   *   is what is left, exactly the picture js-dos used to fit into the same space.
   * - **Landscape, compact** (a phone: the toolbar is dropped): a left rail always (the menu, the room, the chat button
   *   live there), and where the deck is shown a right rail of keys, with two columns each when both fit in the gutters
   *   without costing the picture and in the view `fit`, otherwise one. With the chat docked open, the chat REPLACES the
   *   right rail and the left rail folds to icons (56 px); the chat takes what the gutters leave (200 to 240 px) and the
   *   picture is the one thing that may shrink.
   */
  static plan(input: StageInput): StagePlan {
    const { box, shape, insets, keys, chat, view } = input;

    if (shape === 'portrait') {
      return { shape, leftColumns: 0, rightColumns: 0, leftFolded: false, left: 0, right: 0, chatPanel: 0, chatDocked: 0, stage: StageHelper.portraitStage(box), offset: ORIGIN };
    }

    if (shape === 'landscape-regular') {
      const chatPanel = StageHelper.wideDock(box.width);
      const chatDocked = chat ? chatPanel : 0;
      const stage = StageHelper.fitStage(box, STAGE_RATIO, { ...NONE, right: chatDocked });
      const offset = StageHelper.place(box, stage, 0, chatDocked);
      return { shape, leftColumns: 0, rightColumns: 0, leftFolded: false, left: 0, right: chatDocked, chatPanel, chatDocked, stage, offset };
    }

    // Landscape, compact.
    const full = StageHelper.fullWidth(box);
    const sides = (columns: 1 | 2) => ({ left: insets.left + StageHelper.railWidth(columns), right: insets.right + StageHelper.railWidth(columns) });
    const fits = (columns: 1 | 2) => box.width - sides(columns).left - sides(columns).right >= full;

    // The left rail folded to icons is what the chat leaves of the left side whether it is open or not, so the width the
    // chat has when open (and the distance its slide-out travels) never depends on whether it is open.
    const folded = insets.left + StageHelper.foldedRailWidth();
    const room = box.width - folded - full - insets.right;
    const chatPanel = Math.max(STAGE.CHAT_PHONE_MIN, Math.min(STAGE.CHAT_PHONE_MAX, room)) + insets.right;

    let leftColumns: RailColumns;
    let rightColumns: RailColumns;
    let leftFolded = false;
    let left: number;
    let right: number;
    let chatDocked = 0;

    if (chat) {
      leftColumns = 1;
      leftFolded = true;
      rightColumns = 0;
      left = folded;
      right = chatPanel;
      chatDocked = chatPanel;
    } else if (keys) {
      const columns: 1 | 2 = view === 'fit' && fits(2) ? 2 : 1;
      leftColumns = columns;
      rightColumns = columns;
      ({ left, right } = sides(columns));
    } else {
      // No deck: the left rail still holds the menu and the room code, and the right side keeps only the notch clear.
      leftColumns = 1;
      rightColumns = 0;
      left = insets.left + StageHelper.railWidth(1);
      right = insets.right;
    }

    const stage = StageHelper.fitStage(box, STAGE_RATIO, { ...NONE, left, right });
    const offset = StageHelper.place(box, stage, left, right);
    return { shape, leftColumns, rightColumns, leftFolded, left, right, chatPanel, chatDocked, stage, offset };
  }

  /**
   * Where a stage goes in its box: centred on the screen, in whole pixels, and pushed sideways only as far as the rails or
   * the chat on either side demand. Centring on the SCREEN and not on the room the rails leave is what keeps the picture
   * where it was when the deck is turned off (the right rail goes, and the room to its right with it).
   */
  static place(box: StageSize, stage: StageSize, left: number, right: number): { x: number; y: number } {
    const centred = Math.floor((box.width - stage.width) / 2);
    const x = Math.max(left, Math.min(centred, box.width - right - stage.width));
    const y = Math.max(0, Math.floor((box.height - stage.height) / 2));
    return { x, y };
  }

  /** Two plans that lay the page out the same way. */
  static samePlan(a: StagePlan | null, b: StagePlan | null): boolean {
    if (!a || !b) return a === b;
    return a.shape === b.shape
      && a.leftColumns === b.leftColumns && a.rightColumns === b.rightColumns && a.leftFolded === b.leftFolded
      && a.left === b.left && a.right === b.right
      && a.chatPanel === b.chatPanel && a.chatDocked === b.chatDocked
      && a.stage.width === b.stage.width && a.stage.height === b.stage.height
      && a.offset.x === b.offset.x && a.offset.y === b.offset.y;
  }

  /** How much of the height-fit picture a plan gives up, as a fraction (0 = none). For the log and for the spec. */
  static loss(plan: StagePlan, box: StageSize): number {
    const full = StageHelper.fullWidth(box);
    if (full <= 0 || plan.stage.width <= 0) return 0;
    return Math.max(0, 1 - plan.stage.width / full);
  }
}
