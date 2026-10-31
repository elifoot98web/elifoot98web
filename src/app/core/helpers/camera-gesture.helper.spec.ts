import { CAMERA } from '../models/constants';
import { CameraGesture, CameraGestureIntent } from './camera-gesture.helper';
import { PinchStep, ViewportTransform as V } from './viewport-transform.helper';

/** The page is 393x295 at the origin, so page px and view px are the same. */
const GEOMETRY = { view: { width: 393, height: 295 }, content: { width: 393, height: 295 } };

const steps = (intents: CameraGestureIntent[]): PinchStep[] =>
  intents.filter((intent): intent is Extract<CameraGestureIntent, { type: 'step' }> => intent.type === 'step').map(intent => intent.step);
const kinds = (intents: CameraGestureIntent[]) => intents.map(intent => intent.type);

describe('CameraGesture', () => {

  let gesture: CameraGesture;
  beforeEach(() => { gesture = new CameraGesture(); });

  describe('starting', () => {

    it('does nothing for one finger', () => {
      expect(gesture.down({ id: 1, x: 100, y: 100 })).toEqual([]);
      expect(gesture.active).toBeFalse();
      expect(gesture.touching).toBeTrue();
    });

    it('starts when the second finger lands, at the midpoint and the distance', () => {
      gesture.down({ id: 1, x: 100, y: 100 });
      const intents = gesture.down({ id: 2, x: 200, y: 100 });

      expect(intents).toEqual([{ type: 'start', midpoint: { x: 150, y: 100 }, distance: 100 }]);
      expect(gesture.active).toBeTrue();
    });

    it('ignores a palm as the second finger', () => {
      gesture.down({ id: 1, x: 100, y: 100 });
      expect(gesture.down({ id: 2, x: 200, y: 100, radius: 120 })).toEqual([]);
      expect(gesture.active).toBeFalse();
      // And the palm is not remembered as a finger: the next real one still makes the pair.
      expect(kinds(gesture.down({ id: 3, x: 200, y: 100, radius: 10 }))).toEqual(['start']);
    });

    it('counts the same finger once', () => {
      gesture.down({ id: 1, x: 100, y: 100 });
      expect(gesture.down({ id: 1, x: 100, y: 100 })).toEqual([]);
      expect(gesture.active).toBeFalse();
    });

    it('ignores a third finger while the first two are down', () => {
      gesture.down({ id: 1, x: 100, y: 100 });
      gesture.down({ id: 2, x: 200, y: 100 });
      expect(gesture.down({ id: 3, x: 150, y: 200 })).toEqual([]);
      expect(gesture.active).toBeTrue();
      // Its movement is nobody's.
      expect(gesture.move({ id: 3, x: 10, y: 10 })).toEqual([]);
    });
  });

  describe('the steps', () => {

    beforeEach(() => {
      gesture.down({ id: 1, x: 100, y: 100 });
      gesture.down({ id: 2, x: 200, y: 100 });
    });

    it('says nothing while the fingers have not moved', () => {
      expect(gesture.move({ id: 1, x: 100, y: 100 })).toEqual([]);
    });

    it('is a pan when both fingers travel together: the midpoint moves and the factor is 1', () => {
      expect(gesture.move({ id: 1, x: 110, y: 120 })).not.toEqual([]); // one finger first: a small spread, inside the band
      const step = steps(gesture.move({ id: 2, x: 210, y: 120 }))[0];

      expect(step.to).toEqual({ x: 160, y: 120 });
      expect(step.factor).toBe(1);
    });

    it('is a zoom when they spread: the factor is the ratio of the distances, from where the band ends', () => {
      // Spread from 100 to 160 px around the same midpoint (150): 60 px, 52 of them beyond the band.
      const out = [...steps(gesture.move({ id: 1, x: 70, y: 100 })), ...steps(gesture.move({ id: 2, x: 230, y: 100 }))];
      const product = out.reduce((total, step) => total * step.factor, 1);

      expect(out[out.length - 1].to).toEqual({ x: 150, y: 100 });
      expect(product).toBeCloseTo((100 + 60 - CAMERA.PINCH_SLOP_PX) / 100, 9);
    });

    it('the product of the factors of every step is the ratio of the distances', () => {
      let product = 1;
      const sequence: Array<[number, number, number]> = [[1, 92, 100], [2, 208, 100], [1, 80, 100], [2, 220, 100], [1, 60, 100], [2, 240, 100]];
      for (const [id, x, y] of sequence) {
        for (const step of steps(gesture.move({ id, x, y }))) product *= step.factor;
      }
      // Final distance 180, start 100, dead band 8: (100 + 72) / 100.
      expect(product).toBeCloseTo(1.72, 9);
    });

    it('is a pinch when they close: a factor under 1', () => {
      const out = [...steps(gesture.move({ id: 1, x: 130, y: 100 })), ...steps(gesture.move({ id: 2, x: 170, y: 100 }))];
      const product = out.reduce((total, step) => total * step.factor, 1);

      expect(out.every(step => step.factor < 1)).toBeTrue();
      // 100 px apart become 40: 60 closer, 52 of them beyond the band.
      expect(product).toBeCloseTo((100 - (60 - CAMERA.PINCH_SLOP_PX)) / 100, 9);
    });

    it('does not shimmer: a drift inside the dead band is no zoom at all', () => {
      const out = [
        ...steps(gesture.move({ id: 1, x: 97, y: 100 })),
        ...steps(gesture.move({ id: 2, x: 204, y: 100 })),
        ...steps(gesture.move({ id: 1, x: 103, y: 101 })),
      ];
      expect(out.length).toBeGreaterThan(0);
      for (const step of out) expect(step.factor).toBe(1);
    });

    it('is continuous where the band ends: crossing it does not jump', () => {
      const slop = CAMERA.PINCH_SLOP_PX;
      const before = steps(gesture.move({ id: 2, x: 200 + slop, y: 100 })).pop();
      const after = steps(gesture.move({ id: 2, x: 200 + slop + 1, y: 100 })).pop()!;
      // 1 px beyond the band is a 1% change, not a jump to 1.08.
      expect(before?.factor ?? 1).toBe(1);
      expect(after.factor).toBeCloseTo(101 / 100, 9);
    });

    it('measures from a sane base when the fingers start touching', () => {
      const close = new CameraGesture();
      close.down({ id: 1, x: 100, y: 100 });
      close.down({ id: 2, x: 110, y: 100 });
      const step = steps(close.move({ id: 2, x: 150, y: 100 })).pop()!;
      // 10 px apart become 50: with the base at 40 px that is (40 + 32) / 40, not (10 + 32) / 10.
      expect(step.factor).toBeCloseTo(72 / 40, 9);
    });

    it('feeds the camera: spreading about a point zooms about it and the content under it stays under it', () => {
      // Already at 1.5x, so that the early steps are not clamped at the fit; a spread from 100 to 200 px about the midpoint (150, 100).
      const start = V.zoomAbout(V.IDENTITY, GEOMETRY, { x: 150, y: 100 }, 1.5);
      const under = V.contentAt(start, { x: 150, y: 100 });
      let camera = start;
      const feed = (intents: CameraGestureIntent[]) => { for (const step of steps(intents)) camera = V.pinch(camera, GEOMETRY, step); };
      for (let i = 1; i <= 10; i++) {
        feed(gesture.move({ id: 1, x: 100 - i * 5, y: 100 }));
        feed(gesture.move({ id: 2, x: 200 + i * 5, y: 100 }));
      }
      expect(camera.scale).toBeCloseTo(1.5 * (100 + (100 - CAMERA.PINCH_SLOP_PX)) / 100, 6);
      expect(V.viewAt(camera, under).x).toBeCloseTo(150, 6);
      expect(V.viewAt(camera, under).y).toBeCloseTo(100, 6);
    });

    it('feeds the camera: both fingers travelling together carry the content with them and do not zoom', () => {
      const start = V.zoomAbout(V.IDENTITY, GEOMETRY, { x: 150, y: 100 }, 2);
      let camera = start;
      for (let i = 1; i <= 8; i++) {
        for (const step of [...steps(gesture.move({ id: 1, x: 100 - i * 4, y: 100 + i * 3 })), ...steps(gesture.move({ id: 2, x: 200 - i * 4, y: 100 + i * 3 }))]) {
          camera = V.pinch(camera, GEOMETRY, step);
        }
      }
      expect(camera.scale).toBe(2);
      // 32 px left and 24 px down: the picture follows the fingers.
      expect(camera.x).toBeCloseTo(start.x - 32, 6);
      expect(camera.y).toBeCloseTo(start.y + 24, 6);
    });
  });

  describe('ending', () => {

    beforeEach(() => {
      gesture.down({ id: 1, x: 100, y: 100 });
      gesture.down({ id: 2, x: 200, y: 100 });
    });

    it('ends when either finger lifts', () => {
      expect(gesture.up(2)).toEqual([{ type: 'end', reason: 'finger lifted' }]);
      expect(gesture.active).toBeFalse();
      expect(gesture.touching).toBeTrue();
    });

    it('ends when the browser takes one away', () => {
      expect(gesture.cancel(1)).toEqual([{ type: 'end', reason: 'pointercancel' }]);
    });

    it('stays dead until every finger is up: the finger that is left cannot pair with the next', () => {
      gesture.up(2);
      expect(gesture.down({ id: 3, x: 220, y: 100 })).toEqual([]);
      expect(gesture.active).toBeFalse();
      expect(gesture.move({ id: 1, x: 90, y: 100 })).toEqual([]);

      gesture.up(1);
      expect(gesture.touching).toBeTrue(); // id 3 is still down
      gesture.up(3);
      expect(gesture.touching).toBeFalse();

      gesture.down({ id: 4, x: 100, y: 100 });
      expect(kinds(gesture.down({ id: 5, x: 200, y: 100 }))).toEqual(['start']);
    });

    it('lets the third finger go without ending the pinch', () => {
      gesture.down({ id: 3, x: 150, y: 200 });
      expect(gesture.up(3)).toEqual([]);
      expect(gesture.active).toBeTrue();
    });

    it('ends everything, once, when the page is hidden or the layer detached', () => {
      expect(gesture.cancelAll('visibility change')).toEqual([{ type: 'end', reason: 'visibility change' }]);
      expect(gesture.active).toBeFalse();
      expect(gesture.touching).toBeFalse();
      expect(gesture.cancelAll('again')).toEqual([]);
    });

    it('forgets a finger it never knew', () => {
      expect(gesture.up(99)).toEqual([]);
      expect(gesture.cancel(99)).toEqual([]);
      expect(gesture.move({ id: 99, x: 1, y: 1 })).toEqual([]);
    });
  });

  describe('effectiveDistance', () => {

    it('is the start distance inside the band and the change beyond it outside', () => {
      expect(CameraGesture.effectiveDistance(100, 100, 8, 40)).toBe(100);
      expect(CameraGesture.effectiveDistance(100, 107, 8, 40)).toBe(100);
      expect(CameraGesture.effectiveDistance(100, 93, 8, 40)).toBe(100);
      expect(CameraGesture.effectiveDistance(100, 130, 8, 40)).toBe(122);
      expect(CameraGesture.effectiveDistance(100, 60, 8, 40)).toBe(68);
    });

    it('never reaches zero, however far the fingers close', () => {
      expect(CameraGesture.effectiveDistance(100, 0, 8, 40)).toBeGreaterThanOrEqual(1);
      expect(CameraGesture.effectiveDistance(10, 0, 8, 40)).toBeGreaterThanOrEqual(1);
    });
  });
});
