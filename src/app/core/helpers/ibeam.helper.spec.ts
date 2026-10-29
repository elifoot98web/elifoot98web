import { FIELD_HINT } from '../models/constants';
import { FrameName, loadFrame } from './field-hint.fixtures';
import { IBeamHelper } from './ibeam.helper';

type Frame = Awaited<ReturnType<typeof loadFrame>>;

/**
 * The fixtures are real frames of the guest at 640x480 (scripts/frame-fixtures): the cursor drawn
 * into the frame over a focused field, a white one, the dialog's face, a button, the backdrop and,
 * the case that matters, a white list, where the arrow's black edge looks like the I-beam's stem.
 * The positions are where the touch layer had sent the cursor (the model's idea, within 3 px).
 */
describe('IBeamHelper', () => {
  const frames = {} as Record<FrameName, Frame>;
  const NAMES: FrameName[] = [
    'ibeamYellow640', 'ibeamWhite640', 'ibeamField1640',
    'arrowFace640', 'arrowButton640', 'arrowBackdrop640', 'arrowList640', 'arrowListText640',
  ];

  beforeAll(async () => {
    for (const name of NAMES) frames[name] = await loadFrame(name);
  });

  describe('the I-beam', () => {

    it('is found over the focused (yellow) field after a tap, where it is blue', () => {
      const look = IBeamHelper.look(frames.ibeamYellow640, 254, 183);
      expect(look.found).toBeTrue();
      expect(look.x).toBe(254);
      expect(look.serif).not.toBeNull();
      expect(look.stemRows).toBeGreaterThanOrEqual(FIELD_HINT.IBEAM_STEM_MIN_ROWS);
    });

    it('is found over an unfocused (white) field, where it is black', () => {
      expect(IBeamHelper.look(frames.ibeamWhite640, 254, 231).found).toBeTrue();
    });

    it('is found near the edge of a field', () => {
      expect(IBeamHelper.look(frames.ibeamField1640, 230, 158).found).toBeTrue();
    });

    it('is found with the model a few pixels off, as it can be (3 px measured)', () => {
      for (const [dx, dy] of [[3, 0], [-3, 0], [0, 3], [0, -3], [3, 3], [-3, -3]]) {
        expect(IBeamHelper.look(frames.ibeamYellow640, 254 + dx, 183 + dy).found).withContext(`${dx},${dy}`).toBeTrue();
      }
    });

    it('is not found where the cursor is not', () => {
      expect(IBeamHelper.look(frames.ibeamYellow640, 100, 100).found).toBeFalse();
      expect(IBeamHelper.look(frames.ibeamYellow640, 254, 300).found).toBeFalse();
    });
  });

  describe('the arrow', () => {

    const ARROWS: Array<[FrameName, number, number, string]> = [
      ['arrowFace640', 180, 329, 'the dialog\'s grey face'],
      ['arrowButton640', 320, 357, 'a button and its caption'],
      ['arrowBackdrop640', 80, 440, 'the green backdrop'],
      ['arrowList640', 150, 249, 'a white list'],
      ['arrowListText640', 300, 201, 'a white list, over a caption'],
    ];

    for (const [name, x, y, where] of ARROWS) {
      it(`is not an I-beam over ${where}`, () => {
        expect(IBeamHelper.look(frames[name], x, y).found).toBeFalse();
      });
    }

    it('has a black left edge that passes for a stem over a white list, and only the serif turns it down', () => {
      // The arrow over the country list: its edge is a column unlike its neighbours on both sides,
      // which are white, for most of 15 rows. A test of the stem alone would call it a field.
      let longest = 0;
      for (let column = 146; column <= 154; column++) {
        for (let from = 238; from <= 250; from++) {
          longest = Math.max(longest, IBeamHelper.stemRows(frames.arrowList640, column, from));
        }
      }
      expect(longest).toBeGreaterThanOrEqual(FIELD_HINT.IBEAM_STEM_MIN_ROWS);
      expect(IBeamHelper.look(frames.arrowList640, 150, 249).found).toBeFalse();
    });
  });

  describe('where the geometry alone would not save the arrow', () => {

    // The model puts an I-beam's stem window 8 rows below the hotspot, and the arrow's hotspot is at
    // the TOP of its edge, so an arrow is out of the window by construction when the model is right.
    // The model is only right to 3 px, and a window can be asked about a cursor anywhere: moved down
    // by the amount that lines the arrow's edge up with the stem's rows, only the serif is left.
    const ALIGNED = FIELD_HINT.IBEAM_TOP_ROWS_ABOVE_HOTSPOT - 1;

    for (const [name, x, y] of [['arrowList640', 150, 249], ['arrowListText640', 300, 201]] as Array<[FrameName, number, number]>) {
      it(`turns down ${name}\'s edge with the stem rows lined up, which only the serif can do`, () => {
        let stem = 0;
        for (let column = x - 4; column <= x + 4; column++) stem = Math.max(stem, IBeamHelper.stemRows(frames[name], column, y));
        expect(stem).withContext('the edge passes the stem test where the window starts at the tip').toBeGreaterThanOrEqual(FIELD_HINT.IBEAM_STEM_MIN_ROWS);
        expect(IBeamHelper.look(frames[name], x, y + ALIGNED).found).toBeFalse();
      });
    }
  });

  describe('the edges of the frame', () => {

    it('does not read outside it', () => {
      for (const [x, y] of [[0, 0], [639, 479], [-5, -5], [700, 500]]) {
        expect(() => IBeamHelper.look(frames.ibeamYellow640, x, y)).not.toThrow();
        expect(IBeamHelper.look(frames.ibeamYellow640, x, y).found).toBeFalse();
      }
    });
  });
});
