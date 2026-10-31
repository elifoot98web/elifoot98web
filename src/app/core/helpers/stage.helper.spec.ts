import { LayoutShapeHelper } from './layout-shape.helper';
import { StageHelper, StageInput, StageInsets, StagePlan, StageSize } from './stage.helper';
import { DECK, STAGE } from '../models/constants';

const NO_INSETS: StageInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const sides = (left: number, right = left): StageInsets => ({ top: 0, right, bottom: 0, left });

/**
 * A real window, as the page sees it: the viewport, the notch on either side of a phone held sideways, and the box the
 * stage lives in (the viewport, less the 56 px toolbar wherever the page keeps one; a landscape phone drops it).
 */
interface Screen {
  name: string;
  width: number;
  height: number;
  insets?: StageInsets;
}

const boxOf = (screen: Screen): StageSize => {
  const shape = LayoutShapeHelper.of(screen.width, screen.height);
  return { width: screen.width, height: shape === 'landscape-compact' ? screen.height : screen.height - DECK.HEADER_HEIGHT };
};

const input = (screen: Screen, over: Partial<StageInput> = {}): StageInput => ({
  box: boxOf(screen),
  shape: LayoutShapeHelper.of(screen.width, screen.height),
  insets: screen.insets ?? NO_INSETS,
  keys: true,
  chat: false,
  view: 'fit',
  ...over,
});

const plan = (screen: Screen, over: Partial<StageInput> = {}): StagePlan => StageHelper.plan(input(screen, over));

/** The thirteen viewports the control deck was verified on, and the ones the stage was asked about besides. */
const PORTRAIT: Screen[] = [
  { name: '360x640 (A07-class)', width: 360, height: 640 },
  { name: '375x667', width: 375, height: 667 },
  { name: '393x852', width: 393, height: 852 },
  { name: '412x915', width: 412, height: 915 },
  { name: '430x932 (iPhone 15 Pro Max)', width: 430, height: 932 },
  { name: '820x1180', width: 820, height: 1180 },
  { name: '768x1024', width: 768, height: 1024 },
];

const REGULAR: Screen[] = [
  { name: '1180x820', width: 1180, height: 820 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1366x768', width: 1366, height: 768 },
];

/** Phones held sideways: where the toolbar is dropped and the gutters hold rails. The insets are the notch's, where there is one. */
const PHONES: Screen[] = [
  { name: '844x390 with a notch (iPhone 13/14)', width: 844, height: 390, insets: sides(47) },
  { name: '844x390 without one', width: 844, height: 390 },
  { name: '915x412 (A07-class)', width: 915, height: 412 },
  { name: '932x430 with the Dynamic Island (iPhone 15 Pro Max)', width: 932, height: 430, insets: sides(59) },
  { name: '852x393 with the Dynamic Island (iPhone 15 Pro)', width: 852, height: 393, insets: sides(59) },
  { name: '812x375 with a notch (iPhone X/11 Pro)', width: 812, height: 375, insets: sides(44) },
  { name: '667x375 (iPhone SE/8)', width: 667, height: 375 },
  { name: '640x360', width: 640, height: 360 },
];

const ALL: Screen[] = [...PORTRAIT, ...REGULAR, ...PHONES];

describe('StageHelper', () => {

  describe('fitStage', () => {

    it('is the largest 4:3 box that fits, in whole pixels on both sides', () => {
      expect(StageHelper.fitStage({ width: 844, height: 390 })).toEqual({ width: 520, height: 390 });
      expect(StageHelper.fitStage({ width: 500, height: 600 })).toEqual({ width: 500, height: 375 });
      // 521 would need a 390.75 px height: the stage gives up the pixel instead.
      expect(StageHelper.fitStage({ width: 521, height: 400 })).toEqual({ width: 520, height: 390 });
    });

    it('takes the reserved edges off first, on all four sides', () => {
      expect(StageHelper.fitStage({ width: 844, height: 390 }, undefined, { top: 0, right: 162, bottom: 0, left: 162 })).toEqual({ width: 520, height: 390 });
      expect(StageHelper.fitStage({ width: 844, height: 390 }, undefined, { top: 10, right: 242, bottom: 20, left: 242 })).toEqual({ width: 360, height: 270 });
    });

    it('is nothing at all when nothing fits, never a negative size', () => {
      expect(StageHelper.fitStage({ width: 100, height: 400 }, undefined, { top: 0, right: 60, bottom: 0, left: 60 })).toEqual({ width: 0, height: 0 });
      expect(StageHelper.fitStage({ width: 0, height: 0 })).toEqual({ width: 0, height: 0 });
      expect(StageHelper.fitStage({ width: 800, height: 2 })).toEqual({ width: 0, height: 0 });
    });

    it('is a function of the RATIO, so a 3:2 frame gets a 3:2 box', () => {
      expect(StageHelper.fitStage({ width: 900, height: 400 }, { width: 3, height: 2 })).toEqual({ width: 600, height: 400 });
    });

    it('fits every box in the matrix, exactly 4:3 and never larger than the box', () => {
      for (const screen of ALL) {
        const box = boxOf(screen);
        const stage = StageHelper.fitStage(box);
        expect(stage.width * 3).withContext(screen.name).toBe(stage.height * 4);
        expect(stage.width).withContext(screen.name).toBeLessThanOrEqual(box.width);
        expect(stage.height).withContext(screen.name).toBeLessThanOrEqual(box.height);
        // It leaves less than one unit (4 px) unused on the axis that binds.
        const bound = Math.min(box.width - stage.width, (box.height - stage.height) * 4 / 3);
        expect(bound).withContext(screen.name).toBeLessThan(4);
      }
    });
  });

  describe('railWidth', () => {

    it('is padding, keys and gaps: 112 px for two columns, 68 for one', () => {
      expect(StageHelper.railWidth(2)).toBe(2 * 6 + 2 * 48 + 4);
      expect(StageHelper.railWidth(2)).toBe(112);
      expect(StageHelper.railWidth(1)).toBe(2 * 6 + 56);
      expect(StageHelper.railWidth(1)).toBe(68);
    });

    it('leaves room for 44 px keys: a key is never narrower than the touch floor', () => {
      expect(STAGE.RAIL_KEY_WIDTH_TWO_COLUMNS).toBeGreaterThanOrEqual(44);
      expect(STAGE.RAIL_KEY_WIDTH_ONE_COLUMN).toBeGreaterThanOrEqual(44);
    });
  });

  describe('portrait', () => {

    it('has no rails and no dock: the stage is the width of the box and its 4:3 height, what flex: 0 0 75vw makes of it', () => {
      for (const screen of PORTRAIT) {
        const p = plan(screen);
        const box = boxOf(screen);
        expect(p.leftColumns).withContext(screen.name).toBe(0);
        expect(p.rightColumns).withContext(screen.name).toBe(0);
        expect(p.left + p.right + p.chatPanel + p.chatDocked).withContext(screen.name).toBe(0);
        expect(p.stage.width).withContext(screen.name).toBe(box.width);
        expect(Math.abs(p.stage.height - box.width * 0.75)).withContext(screen.name).toBeLessThanOrEqual(0.5);
      }
    });

    it('does not move for the deck, the chat or the view mode', () => {
      for (const screen of PORTRAIT) {
        const base = plan(screen);
        expect(plan(screen, { keys: false }).stage).withContext(screen.name).toEqual(base.stage);
        expect(plan(screen, { chat: true }).stage).withContext(screen.name).toEqual(base.stage);
        expect(plan(screen, { view: 'wide' }).stage).withContext(screen.name).toEqual(base.stage);
      }
    });

    it('is clamped by a box that is shorter than 75vw (a near-square window), as the CSS clamps it', () => {
      expect(StageHelper.portraitStage({ width: 700, height: 500 })).toEqual({ width: 700, height: 500 });
    });
  });

  describe('landscape, regular (a tablet or a laptop keeps its toolbar)', () => {

    it('has no rails, and a closed chat leaves the whole box to the picture', () => {
      for (const screen of REGULAR) {
        const p = plan(screen);
        expect(p.leftColumns + p.rightColumns).withContext(screen.name).toBe(0);
        expect(p.left + p.right).withContext(screen.name).toBe(0);
        expect(p.stage).withContext(screen.name).toEqual(StageHelper.fitStage(boxOf(screen)));
      }
    });

    it('docks the chat at the widths global.scss always gave it, and the picture takes what is left', () => {
      expect(StageHelper.wideDock(1280)).toBe(320);
      expect(StageHelper.wideDock(1024)).toBe(320);
      expect(StageHelper.wideDock(900)).toBe(300);
      expect(StageHelper.wideDock(700)).toBe(280);
      expect(StageHelper.wideDock(780)).toBe(300);

      const open = plan({ name: '1280x800', width: 1280, height: 800 }, { chat: true });
      expect(open.chatDocked).toBe(320);
      expect(open.right).toBe(320);
      // 960 wide and 744 tall is left: width-bound, and 960 is a whole number of 4:3 units (240 of them).
      expect(open.stage).toEqual({ width: 960, height: 720 });
      expect(open.stage.width + open.right).toBeLessThanOrEqual(1280);
    });

    it('is a pure function of the shape: the deck and the view mode do not move the picture', () => {
      for (const screen of REGULAR) {
        const base = plan(screen);
        expect(plan(screen, { keys: false }).stage).withContext(screen.name).toEqual(base.stage);
        expect(plan(screen, { view: 'wide' }).stage).withContext(screen.name).toEqual(base.stage);
      }
    });
  });

  describe('landscape, compact (a phone held sideways)', () => {

    it('gives 844x390 and 915x412 two columns in each rail and the whole height-fit picture', () => {
      const notch = plan(PHONES[0]);
      expect(notch.leftColumns).toBe(2);
      expect(notch.rightColumns).toBe(2);
      expect(notch.leftFolded).toBeFalse();
      expect(notch.left).toBe(47 + 112);
      expect(notch.right).toBe(47 + 112);
      expect(notch.stage).toEqual({ width: 520, height: 390 });

      const plain = plan(PHONES[1]);
      expect(plain.leftColumns).toBe(2);
      expect(plain.stage).toEqual({ width: 520, height: 390 });

      const android = plan(PHONES[2]);
      expect(android.leftColumns).toBe(2);
      expect(android.left).toBe(112);
      expect(android.stage).toEqual({ width: 548, height: 411 });
    });

    it('gives the iPhone 15 Pro Max two columns as well: 932x430 with 59 px on each side', () => {
      const p = plan(PHONES[3]);
      expect(p.leftColumns).toBe(2);
      expect(p.left).toBe(59 + 112);
      expect(p.stage).toEqual({ width: 572, height: 429 });
      expect(StageHelper.loss(p, boxOf(PHONES[3]))).toBeLessThan(0.01);
    });

    it('gives 667x375 one column: two would cost the picture 12%', () => {
      const p = plan(PHONES[6]);
      expect(p.leftColumns).toBe(1);
      expect(p.rightColumns).toBe(1);
      expect(p.left).toBe(68);
      expect(p.right).toBe(68);
      expect(p.stage).toEqual({ width: 500, height: 375 });

      // The proof: forced to two columns the same window would lose 12% of the picture (440 of 500 px).
      const full = StageHelper.fullWidth(boxOf(PHONES[6]));
      const twoColumns = StageHelper.fitStage(boxOf(PHONES[6]), undefined, { top: 0, bottom: 0, left: 112, right: 112 });
      expect(twoColumns).toEqual({ width: 440, height: 330 });
      expect(1 - twoColumns.width / full).toBeCloseTo(0.12, 2);
    });

    it('keeps two columns where they fit EXACTLY: 812x375 with 44 px notches leaves a 500 px zone for a 500 px picture', () => {
      const p = plan(PHONES[5]);
      expect(812 - 2 * (44 + StageHelper.railWidth(2))).toBe(StageHelper.fullWidth(boxOf(PHONES[5])));
      expect(p.leftColumns).toBe(2);
      expect(p.stage).toEqual({ width: 500, height: 375 });
    });

    it('drops to one column where the notch leaves the gutters too thin: 852x393 with 59 px on each side', () => {
      const p = plan(PHONES[4]);
      expect(p.leftColumns).toBe(1);
      expect(p.left).toBe(59 + 68);
      expect(p.stage).toEqual({ width: 524, height: 393 });
    });

    it('never lets a rail cost the picture when it does not have to (no chat): every phone keeps the whole height-fit stage', () => {
      for (const screen of PHONES) {
        const p = plan(screen);
        expect(StageHelper.loss(p, boxOf(screen))).withContext(screen.name).toBe(0);
        expect(p.left + p.stage.width + p.right).withContext(screen.name).toBeLessThanOrEqual(screen.width);
        expect(p.stage.height).withContext(screen.name).toBe(Math.floor(screen.height / 3) * 3);
      }
    });

    it('is NOT free in a window that is short and nearly square (half of a split screen): a known limit, no launcher takes the rails\' place yet', () => {
      // Every phone of the matrix is about 1.67:1 or wider, where the gutters beside a height-fit picture are free. A window as
      // wide as it is tall has no gutters: the one-column rails (68 px a side) come out of the picture, and the host's deck makes
      // its picture smaller than a spectator's, who has no keys (CLAUDE.md, *The stage*, known limits).
      const half: Screen = { name: '457x412 (half of a 915x412 split screen)', width: 457, height: 412 };
      const withKeys = plan(half);
      expect(withKeys.leftColumns).toBe(1);
      expect(withKeys.stage).toEqual({ width: 320, height: 240 });
      expect(StageHelper.loss(withKeys, boxOf(half))).toBeGreaterThan(0.4);
      expect(plan(half, { keys: false }).stage.width).toBeGreaterThan(withKeys.stage.width);
    });

    it('puts the picture in the middle of the screen, in whole pixels, and keeps it there wherever the rails are', () => {
      const notch = plan(PHONES[0]);
      expect(notch.offset).toEqual({ x: 162, y: 0 });
      // The same picture, the same place, with the deck off (the right rail gone) and in Ampliar (narrower rails).
      expect(plan(PHONES[0], { keys: false }).offset).toEqual(notch.offset);
      expect(plan(PHONES[0], { view: 'wide' }).offset).toEqual(notch.offset);
      // 915 less 548 is 367: half of it is 183.5, and a canvas is never drawn on a half pixel.
      expect(plan(PHONES[2]).offset).toEqual({ x: 183, y: 0 });
      for (const screen of PHONES) {
        const p = plan(screen);
        expect(Number.isInteger(p.offset.x) && Number.isInteger(p.offset.y)).withContext(screen.name).toBeTrue();
      }
    });

    it('pushes the picture aside only as far as the chat requires', () => {
      const p = plan(PHONES[1], { chat: true });
      // 844 less the chat's 240 and the picture's 520 leaves 84 for its left edge, where the middle would have been 162.
      expect(p.offset.x).toBe(84);
      expect(p.offset.x).toBeGreaterThanOrEqual(p.left);
      expect(p.offset.x + p.stage.width + p.right).toBeLessThanOrEqual(844);
    });

    it('keeps every picture between its rails: never under one, never past the chat, never below the box', () => {
      for (const screen of [...REGULAR, ...PHONES]) {
        for (const chat of [false, true]) {
          const p = plan(screen, { chat });
          const box = boxOf(screen);
          expect(p.offset.x).withContext(screen.name).toBeGreaterThanOrEqual(p.left);
          expect(p.offset.x + p.stage.width).withContext(screen.name).toBeLessThanOrEqual(box.width - p.right);
          expect(p.offset.y + p.stage.height).withContext(screen.name).toBeLessThanOrEqual(box.height);
        }
      }
    });

    it('fits the rails in the gutters the picture leaves: the stage is never narrower than the zone between them wants', () => {
      for (const screen of PHONES) {
        const p = plan(screen);
        const zone = screen.width - p.left - p.right;
        expect(p.stage.width).withContext(screen.name).toBeLessThanOrEqual(zone);
        expect(zone - p.stage.width).withContext(screen.name).toBeGreaterThanOrEqual(0);
      }
    });

    it('keeps the left rail without the deck (the menu and the room code live there), and the right side only clear of the notch', () => {
      const p = plan(PHONES[0], { keys: false });
      expect(p.leftColumns).toBe(1);
      expect(p.rightColumns).toBe(0);
      expect(p.left).toBe(47 + 68);
      expect(p.right).toBe(47);
      expect(p.stage).toEqual({ width: 520, height: 390 });
    });

    it('is the same stage with the deck on and off wherever the rails fit: turning the deck off gives nothing back', () => {
      for (const screen of PHONES) {
        const on = plan(screen).stage;
        const off = plan(screen, { keys: false }).stage;
        expect(off).withContext(screen.name).toEqual(on);
      }
    });

    describe('Ampliar', () => {

      it('is one column everywhere', () => {
        for (const screen of PHONES) {
          const p = plan(screen, { view: 'wide' });
          expect(p.leftColumns).withContext(screen.name).toBe(1);
          expect(p.rightColumns).withContext(screen.name).toBe(1);
        }
      });

      it('never crops: the stage is the largest picture that fits whole, so it gains nothing a phone with room already had', () => {
        for (const screen of PHONES) {
          const wide = plan(screen, { view: 'wide' }).stage;
          const fit = plan(screen).stage;
          expect(wide.width).withContext(screen.name).toBeGreaterThanOrEqual(fit.width);
          expect(wide.height).withContext(screen.name).toBeLessThanOrEqual(boxOf(screen).height);
          expect(wide.width * 3).withContext(screen.name).toBe(wide.height * 4);
        }
      });

      it('gains nothing on any phone of the matrix, because Ajustar already falls back to one column wherever two would cost picture', () => {
        // The gain the roadmap modelled (8% to 52%) needs a stage taller than the screen, which is a camera's job.
        const gains = PHONES.filter(screen => plan(screen, { view: 'wide' }).stage.width > plan(screen).stage.width);
        expect(gains.map(screen => screen.name)).toEqual([]);
      });
    });

    describe('with the chat docked open', () => {

      it('replaces the right rail and folds the left one to a single column of icons, 56 px wide', () => {
        for (const screen of PHONES) {
          const p = plan(screen, { chat: true });
          expect(p.leftColumns).withContext(screen.name).toBe(1);
          expect(p.leftFolded).withContext(screen.name).toBeTrue();
          expect(p.rightColumns).withContext(screen.name).toBe(0);
          expect(p.left).withContext(screen.name).toBe((screen.insets?.left ?? 0) + 56);
          expect(p.right).withContext(screen.name).toBe(p.chatDocked);
          expect(p.chatDocked).withContext(screen.name).toBe(p.chatPanel);
        }
      });

      it('is between 200 and 240 px wide, plus the notch it sits under', () => {
        for (const screen of PHONES) {
          const p = plan(screen, { chat: true });
          const inset = screen.insets?.right ?? 0;
          expect(p.chatPanel - inset).withContext(screen.name).toBeGreaterThanOrEqual(STAGE.CHAT_PHONE_MIN);
          expect(p.chatPanel - inset).withContext(screen.name).toBeLessThanOrEqual(STAGE.CHAT_PHONE_MAX);
        }
      });

      it('costs the picture nothing on the Android phones, whose gutters are wide and have no notch', () => {
        for (const screen of [PHONES[1], PHONES[2]]) {
          const p = plan(screen, { chat: true });
          expect(StageHelper.loss(p, boxOf(screen))).withContext(screen.name).toBe(0);
          expect(p.chatPanel).withContext(screen.name).toBe(STAGE.CHAT_PHONE_MAX);
        }
      });

      it('costs the notch phones their measured share: 5% at 844x390, 3% at 932x430', () => {
        // The notch is paid on both sides (the folded rail's face and the chat's go under it), which the wireframe's 3% did
        // not count: only the phone with the roomier gutters (932x430) gets there.
        const small = plan(PHONES[0], { chat: true });
        expect(small.chatPanel).toBe(200 + 47);
        expect(small.stage).toEqual({ width: 492, height: 369 });
        expect(StageHelper.loss(small, boxOf(PHONES[0]))).toBeCloseTo(0.054, 2);

        const big = plan(PHONES[3], { chat: true });
        expect(big.chatPanel).toBe(200 + 59);
        expect(big.stage).toEqual({ width: 556, height: 417 });
        expect(StageHelper.loss(big, boxOf(PHONES[3]))).toBeCloseTo(0.028, 2);
      });

      it('costs 667x375 less than the chat did before the rails: 408 px of picture where a 267 px chat left 400', () => {
        const p = plan(PHONES[6], { chat: true });
        expect(p.chatPanel).toBe(STAGE.CHAT_PHONE_MIN);
        expect(p.stage).toEqual({ width: 408, height: 306 });
        // The chat used to be min(300, 40vw) = 267 px wide beside a 400 px container: a 400x300 picture.
        expect(p.stage.width).toBeGreaterThanOrEqual(400);
        expect(StageHelper.loss(p, boxOf(PHONES[6]))).toBeLessThan(0.19);
      });

      it('has the width the slide-out travels whether or not it is open', () => {
        for (const screen of PHONES) {
          expect(plan(screen).chatPanel).withContext(screen.name).toBe(plan(screen, { chat: true }).chatPanel);
          expect(plan(screen).chatDocked).withContext(screen.name).toBe(0);
        }
      });

      it('is the same whether the deck is on or off', () => {
        for (const screen of PHONES) {
          expect(plan(screen, { chat: true, keys: false })).withContext(screen.name).toEqual(plan(screen, { chat: true }));
        }
      });
    });
  });

  describe('the contract', () => {

    it('is a function of its input alone: the same input is the same plan, however many times it is asked', () => {
      for (const screen of ALL) {
        expect(plan(screen)).withContext(screen.name).toEqual(plan(screen));
      }
    });

    it('draws every landscape stage at exactly 4:3, inside the box, between its rails', () => {
      for (const screen of [...REGULAR, ...PHONES]) {
        for (const chat of [false, true]) {
          for (const keys of [false, true]) {
            for (const view of ['fit', 'wide'] as const) {
              const p = plan(screen, { chat, keys, view });
              const box = boxOf(screen);
              const where = `${screen.name} chat=${chat} keys=${keys} ${view}`;
              expect(p.stage.width * 3).withContext(where).toBe(p.stage.height * 4);
              expect(p.stage.height).withContext(where).toBeLessThanOrEqual(box.height);
              expect(p.left + p.stage.width + p.right).withContext(where).toBeLessThanOrEqual(box.width);
            }
          }
        }
      }
    });

    it('never draws a stage under the minimum on any window of the matrix', () => {
      for (const screen of ALL) {
        for (const chat of [false, true]) {
          expect(plan(screen, { chat }).stage.width).withContext(screen.name).toBeGreaterThanOrEqual(STAGE.MIN_STAGE_WIDTH);
        }
      }
    });
  });

  describe('samePlan', () => {

    it('tells the plans that lay the page out the same way', () => {
      expect(StageHelper.samePlan(plan(PHONES[0]), plan(PHONES[0]))).toBeTrue();
      expect(StageHelper.samePlan(plan(PHONES[0]), plan(PHONES[0], { chat: true }))).toBeFalse();
      expect(StageHelper.samePlan(plan(PHONES[0]), plan(PHONES[0], { view: 'wide' }))).toBeFalse();
      // Same size, different place: still a different layout.
      const moved = { ...plan(PHONES[0]), offset: { x: 100, y: 0 } };
      expect(StageHelper.samePlan(plan(PHONES[0]), moved)).toBeFalse();
      expect(StageHelper.samePlan(null, null)).toBeTrue();
      expect(StageHelper.samePlan(plan(PHONES[0]), null)).toBeFalse();
    });
  });

  describe('the view mode setting', () => {

    it('is Ajustar unless the stored word is exactly "wide"', () => {
      expect(StageHelper.normaliseView('wide')).toBe('wide');
      expect(StageHelper.normaliseView('fit')).toBe('fit');
      expect(StageHelper.normaliseView(undefined)).toBe('fit');
      expect(StageHelper.normaliseView(null)).toBe('fit');
      expect(StageHelper.normaliseView('WIDE')).toBe('fit');
      expect(StageHelper.normaliseView(true)).toBe('fit');
    });

    it('is named in Portuguese, with the default first', () => {
      expect(StageHelper.views()).toEqual(['fit', 'wide']);
      expect(StageHelper.labelView('fit')).toBe('Ajustar');
      expect(StageHelper.labelView('wide')).toBe('Ampliar');
      expect(StageHelper.describeView('fit')).toContain('duas colunas');
      expect(StageHelper.describeView('wide')).toContain('uma coluna');
    });
  });
});
