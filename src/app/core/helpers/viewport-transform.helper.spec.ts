import { CAMERA } from '../models/constants';
import { CameraGeometry, CameraState, TallViewInput, ViewportTransform as V } from './viewport-transform.helper';

/** A 393 px wide phone in portrait: the picture is 393x295 (640x480 at 0.614), and the view is the same box. */
const PHONE: CameraGeometry = { view: { width: 393, height: 295 }, content: { width: 393, height: 295 } };
/** The same phone with the camera grown into the free band under the picture (portrait, deck folded). */
const TALL: CameraGeometry = { view: { width: 393, height: 590 }, content: { width: 393, height: 295 } };
/** A landscape phone: 524x393, the whole height. */
const SIDEWAYS: CameraGeometry = { view: { width: 524, height: 393 }, content: { width: 524, height: 393 } };

const state = (scale: number, x = 0, y = 0): CameraState => ({ scale, x, y });
const near = (actual: number, expected: number, tolerance = 1e-9) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);

describe('ViewportTransform', () => {

  describe('scale', () => {

    it('stays between the fit and the maximum, whatever it is asked for', () => {
      expect(V.clampScale(0.4)).toBe(1);
      expect(V.clampScale(1)).toBe(1);
      expect(V.clampScale(2.2)).toBe(2.2);
      expect(V.clampScale(9)).toBe(CAMERA.MAX_SCALE);
    });

    it('is the fit for anything that is not a number', () => {
      expect(V.clampScale(NaN)).toBe(1);
      expect(V.clampScale(Infinity)).toBe(1);
      expect(V.clampScale(-Infinity)).toBe(1);
    });

    it('climbs and descends the ladder one rung at a time, and stops at its ends', () => {
      expect(V.stepScale(1, 1)).toBe(1.25);
      expect(V.stepScale(1.25, 1)).toBe(1.5);
      expect(V.stepScale(2, 1)).toBe(2.5);
      expect(V.stepScale(3, 1)).toBe(3);
      expect(V.stepScale(2, -1)).toBe(1.75);
      expect(V.stepScale(1.25, -1)).toBe(1);
      expect(V.stepScale(1, -1)).toBe(1);
    });

    it('goes to the next rung from a scale between two (a pinch left it there)', () => {
      expect(V.stepScale(1.6, 1)).toBe(1.75);
      expect(V.stepScale(1.6, -1)).toBe(1.5);
      expect(V.stepScale(1.07, -1)).toBe(1);
    });

    it('has the presets on the ladder, so a preset and the buttons agree about where they are', () => {
      for (const preset of CAMERA.PRESETS) expect(CAMERA.STEPS).toContain(preset);
    });
  });

  describe('clamp', () => {

    it('keeps the picture covering the view at the edges', () => {
      // 2x of 393x295 is 786x590: the corner may go 393 left and 295 up, and no further.
      expect(V.clamp(state(2, -500, -400), PHONE)).toEqual(state(2, -393, -295));
      expect(V.clamp(state(2, 50, 20), PHONE)).toEqual(state(2, 0, 0));
      expect(V.clamp(state(2, -100, -100), PHONE)).toEqual(state(2, -100, -100));
    });

    it('allows no movement at the fit', () => {
      expect(V.clamp(state(1, -30, -30), PHONE)).toEqual(state(1, 0, 0));
    });

    it('puts a picture smaller than the view at the start of the axis (the tall view of a portrait phone)', () => {
      // 1.5x of 295 is 442 in a 590 view: there is room, and the picture stays at the top where it grew from.
      const clamped = V.clamp(state(1.5, -100, -200), TALL);
      expect(clamped.y).toBe(0);
      expect(clamped.x).toBe(-100);
      expect(V.clamp(state(2, -100, -300), TALL).y).toBe(0);
      // At 3x it is 885 tall in a 590 view and it moves again.
      expect(V.clamp(state(3, 0, -400), TALL).y).toBe(-295);
    });

    it('never produces NaN, infinities or a negative zero', () => {
      const clamped = V.clamp({ scale: NaN, x: NaN, y: Infinity }, PHONE);
      expect(clamped).toEqual(state(1, 0, 0));
      expect(Object.is(clamped.x, 0)).toBeTrue();
      expect(Object.is(V.clamp(state(2, -0, -0), PHONE).x, 0)).toBeTrue();
    });

    it('also clamps the scale', () => {
      expect(V.clamp(state(7, 0, 0), PHONE).scale).toBe(CAMERA.MAX_SCALE);
    });

    it('leaves a degenerate geometry at the fit instead of dividing by zero', () => {
      const empty: CameraGeometry = { view: { width: 0, height: 0 }, content: { width: 0, height: 0 } };
      expect(V.clamp(state(2, -5, -5), empty)).toEqual(state(2, 0, 0));
    });
  });

  describe('zooming about a point', () => {

    it('keeps the content under the focal point where it was', () => {
      const before = state(1.5, -60, -40);
      const focal = { x: 200, y: 150 };
      const under = V.contentAt(before, focal);
      const after = V.zoomAbout(before, PHONE, focal, 2.5);

      expect(after.scale).toBe(2.5);
      near(V.viewAt(after, under).x, focal.x, 1e-6);
      near(V.viewAt(after, under).y, focal.y, 1e-6);
    });

    it('from the fit, about the middle, shows the middle', () => {
      const after = V.zoomAbout(V.IDENTITY, PHONE, { x: 196.5, y: 147.5 }, 2);
      // 2x about the centre: the picture is 786x590 and its centre is at the view's centre.
      expect(after).toEqual(state(2, -196.5, -147.5));
    });

    it('about a corner stays in that corner', () => {
      expect(V.zoomAbout(V.IDENTITY, PHONE, { x: 0, y: 0 }, 2)).toEqual(state(2, 0, 0));
      const bottomRight = V.zoomAbout(V.IDENTITY, PHONE, { x: 393, y: 295 }, 2);
      expect(bottomRight).toEqual(state(2, -393, -295));
    });

    it('is clamped when the focal point cannot stay put (zooming out from a corner)', () => {
      // At the bottom-right corner of a 2x picture, zooming out about the middle would pull the corner inside the view.
      const after = V.zoomAbout(state(2, -393, -295), PHONE, { x: 196.5, y: 147.5 }, 1.2);
      near(after.x, 393 - 393 * 1.2, 1e-9);
      near(after.y, 295 - 295 * 1.2, 1e-9);
    });

    it('is reversible at a focal point while nothing is clamped', () => {
      const focal = { x: 200, y: 140 };
      const zoomed = V.zoomAbout(state(1.5, -100, -60), PHONE, focal, 2);
      const back = V.zoomAbout(zoomed, PHONE, focal, 1.5);
      near(back.x, -100, 1e-9);
      near(back.y, -60, 1e-9);
    });
  });

  describe('the presets', () => {

    it('Ajustar is the identity from anywhere', () => {
      expect(V.zoomTo(state(2.5, -300, -200), PHONE, 1, { x: 100, y: 100 })).toEqual(state(1, 0, 0));
      expect(V.zoomTo(V.IDENTITY, PHONE, 1, { x: 100, y: 100 })).toEqual(state(1, 0, 0));
    });

    it('moves fit, 1.5x, 2x and back through the same focal point', () => {
      const focal = { x: 196.5, y: 147.5 };
      const a = V.zoomTo(V.IDENTITY, PHONE, 1.5, focal);
      const b = V.zoomTo(a, PHONE, 2, focal);
      const c = V.zoomTo(b, PHONE, 1.5, focal);

      expect(a.scale).toBe(1.5);
      expect(b.scale).toBe(2);
      near(c.x, a.x);
      near(c.y, a.y);
      expect(V.zoomTo(c, PHONE, 1, focal)).toEqual(state(1, 0, 0));
    });

    it('a pinch that ends near the fit is the fit', () => {
      expect(V.settle(state(1.04, -3, -2))).toEqual(state(1, 0, 0));
      expect(V.settle(state(1.06, -3, -2))).toEqual(state(1.06, -3, -2));
      expect(V.settle(state(2, -3, -2))).toEqual(state(2, -3, -2));
    });
  });

  describe('a step of a pinch', () => {

    it('moves the content from under one midpoint to under the other', () => {
      const before = state(2, -100, -50);
      const from = { x: 150, y: 120 };
      const to = { x: 180, y: 100 };
      const under = V.contentAt(before, from);
      const after = V.pinch(before, PHONE, { from, to, factor: 1 });

      expect(after.scale).toBe(2);
      near(V.viewAt(after, under).x, to.x, 1e-9);
      near(V.viewAt(after, under).y, to.y, 1e-9);
    });

    it('a pure pan (factor 1) moves the picture by the midpoint\'s travel', () => {
      const after = V.pinch(state(2, -100, -50), PHONE, { from: { x: 150, y: 120 }, to: { x: 130, y: 135 }, factor: 1 });
      expect(after).toEqual(state(2, -120, -35));
    });

    it('a spread zooms about the midpoint', () => {
      const mid = { x: 200, y: 150 };
      const before = state(1.5, -80, -60);
      const under = V.contentAt(before, mid);
      const after = V.pinch(before, PHONE, { from: mid, to: mid, factor: 1.2 });

      near(after.scale, 1.8, 1e-12);
      near(V.viewAt(after, under).x, mid.x, 1e-9);
    });

    it('stops at the maximum and at the fit, and a pinch in at the fit does nothing', () => {
      const mid = { x: 200, y: 150 };
      expect(V.pinch(state(2.9), PHONE, { from: mid, to: mid, factor: 2 }).scale).toBe(CAMERA.MAX_SCALE);
      expect(V.pinch(state(1.2, -20, -10), PHONE, { from: mid, to: mid, factor: 0.1 })).toEqual(state(1, 0, 0));
    });

    it('treats a factor that is not a positive number as 1', () => {
      const before = state(2, -100, -50);
      expect(V.pinch(before, PHONE, { from: { x: 1, y: 1 }, to: { x: 1, y: 1 }, factor: NaN })).toEqual(before);
      expect(V.pinch(before, PHONE, { from: { x: 1, y: 1 }, to: { x: 1, y: 1 }, factor: -3 })).toEqual(before);
      expect(V.pinch(before, PHONE, { from: { x: 1, y: 1 }, to: { x: 1, y: 1 }, factor: 0 })).toEqual(before);
    });

    it('clamps at the edges: dragging past the end of the picture goes no further', () => {
      const after = V.pinch(state(2, -380, -280), PHONE, { from: { x: 100, y: 100 }, to: { x: 40, y: 20 }, factor: 1 });
      expect(after).toEqual(state(2, -393, -295));
    });
  });

  describe('the pad', () => {

    it('looks in the direction pressed: the picture goes the other way', () => {
      const middle = state(2, -200, -150);
      expect(V.nudge(middle, PHONE, 'right').x).toBeLessThan(middle.x);
      expect(V.nudge(middle, PHONE, 'left').x).toBeGreaterThan(middle.x);
      expect(V.nudge(middle, PHONE, 'down').y).toBeLessThan(middle.y);
      expect(V.nudge(middle, PHONE, 'up').y).toBeGreaterThan(middle.y);
    });

    it('moves by a quarter of the view per press', () => {
      const moved = V.nudge(state(2, -200, -150), PHONE, 'right');
      near(moved.x, -200 - 393 * CAMERA.NUDGE_FRACTION);
      expect(moved.y).toBe(-150);
    });

    it('stops at the edges and does nothing at the fit', () => {
      expect(V.nudge(state(2, -380, 0), PHONE, 'right').x).toBe(-393);
      expect(V.nudge(state(2, -5, 0), PHONE, 'left').x).toBe(0);
      expect(V.nudge(state(1), PHONE, 'right')).toEqual(state(1, 0, 0));
    });

    it('can walk the whole picture and back', () => {
      let at: CameraState = V.zoomAbout(V.IDENTITY, PHONE, { x: 0, y: 0 }, 2);
      for (let i = 0; i < 10; i++) at = V.nudge(at, PHONE, 'right');
      expect(at.x).toBe(-393);
      for (let i = 0; i < 10; i++) at = V.nudge(at, PHONE, 'left');
      expect(at.x).toBe(0);
    });
  });

  describe('following a click', () => {

    it('does not move the view for a point that is well inside it', () => {
      const at = state(2, -100, -100);
      expect(V.reveal(at, PHONE, { x: 200, y: 150 })).toBe(at);
    });

    it('moves the least that leaves the point a margin from the edge it was near', () => {
      const at = state(2, -100, -100);
      // The content point (240, 100) is at the view point (380, 100): 13 px from the right edge of 393.
      const after = V.reveal(at, PHONE, { x: 240, y: 100 });
      const margin = 393 * CAMERA.FOLLOW_MARGIN;
      near(V.viewAt(after, { x: 240, y: 100 }).x, 393 - margin, 1e-9);
      expect(after.y).toBe(-100);
    });

    it('works on the left and the top as well', () => {
      const at = state(2, -100, -100);
      const after = V.reveal(at, PHONE, { x: 55, y: 55 });
      const view = V.viewAt(after, { x: 55, y: 55 });
      near(view.x, 393 * CAMERA.FOLLOW_MARGIN, 1e-9);
      near(view.y, 295 * CAMERA.FOLLOW_MARGIN, 1e-9);
    });

    it('is clamped like everything else', () => {
      // Already at the right end of the picture: a click at its edge cannot bring more of it into view.
      const at = state(2, -393, -100);
      expect(V.reveal(at, PHONE, { x: 390, y: 150 }).x).toBe(-393);
    });

    it('does nothing at the fit', () => {
      expect(V.reveal(V.IDENTITY, PHONE, { x: 390, y: 290 })).toBe(V.IDENTITY);
    });
  });

  describe('what is written', () => {

    it('is no transform at all at the fit (not scale(1))', () => {
      expect(V.css(V.IDENTITY)).toBeNull();
      expect(V.css(state(1, 0, 0))).toBeNull();
    });

    it('is a translate and a scale, and nothing else', () => {
      expect(V.css(state(2, -196.5, -147.5))).toBe('translate(-196.5px, -147.5px) scale(2)');
      expect(V.css(state(1.25, 0, -3))).toBe('translate(0px, -3px) scale(1.25)');
    });

    it('never writes a negative zero', () => {
      expect(V.css(state(2, V.clamp(state(2, -0, -0), PHONE).x, 0))).not.toContain('-0px');
    });

    it('leaves the identity alone when snapping', () => {
      expect(V.snap(V.IDENTITY, PHONE, 2)).toBe(V.IDENTITY);
    });

    for (const dpr of [1, 1.5, 2, 3]) {
      it(`puts the translation on the device pixel grid at ${dpr}x and never lets the picture come up short`, () => {
        for (const geometry of [PHONE, TALL, SIDEWAYS]) {
          for (let scale = 1.07; scale <= 3; scale += 0.131) {
            const limits = V.limits(scale, geometry);
            for (let step = 0; step <= 7; step++) {
              const x = limits.x * step / 7 + 0.3;
              const y = limits.y * step / 7 - 0.37;
              const written = V.snap(V.clamp({ scale, x, y }, geometry), geometry, dpr);
              near(written.x * dpr, Math.round(written.x * dpr), 1e-6);
              near(written.y * dpr, Math.round(written.y * dpr), 1e-6);
              expect(written.x).toBeGreaterThanOrEqual(limits.x - 1e-9);
              expect(written.y).toBeGreaterThanOrEqual(limits.y - 1e-9);
              expect(written.x).toBeLessThanOrEqual(0);
              expect(written.y).toBeLessThanOrEqual(0);
            }
          }
        }
      });
    }

    it('rounds an inward limit toward the picture, so the edge is covered', () => {
      // 1.5x of 393 is 589.5: the lowest x is -196.5, which is half a pixel at a density of 1.
      const written = V.snap(state(1.5, -196.5, 0), PHONE, 1);
      expect(written.x).toBe(-196);
      expect(V.snap(state(1.5, -196.5, 0), PHONE, 2).x).toBe(-196.5);
    });
  });

  describe('mapping a page point to the guest, through the canvas rectangle', () => {

    const FRAME = { width: 640, height: 480 };

    /** The canvas's rectangle in the page for a camera over a stage whose corner is at `origin`, as `getBoundingClientRect` would say. */
    const rectOf = (camera: CameraState, geometry: CameraGeometry, origin = { x: 0, y: 56 }, canvas = { left: 0, top: 0, width: geometry.content.width, height: geometry.content.height }) => {
      const left = origin.x + camera.x + canvas.left * camera.scale;
      const top = origin.y + camera.y + canvas.top * camera.scale;
      const width = canvas.width * camera.scale;
      const height = canvas.height * camera.scale;
      return { left, top, width, height, right: left + width, bottom: top + height };
    };

    for (const scale of [1, 1.5, 2, 3]) {
      it(`lands on the guest pixel it was aimed at, for every column and row, at ${scale}x`, () => {
        const camera = V.zoomAbout(V.IDENTITY, PHONE, { x: 123, y: 87 }, scale);
        const rect = rectOf(camera, PHONE);
        for (let gx = 0; gx < FRAME.width; gx++) {
          const point = V.guestToClient(rect, FRAME, gx, 100);
          expect(V.clientToGuest(rect, FRAME, point.x, point.y)?.x).toBe(gx);
        }
        for (let gy = 0; gy < FRAME.height; gy++) {
          const point = V.guestToClient(rect, FRAME, 100, gy);
          expect(V.clientToGuest(rect, FRAME, point.x, point.y)?.y).toBe(gy);
        }
      });

      it(`agrees with the picture's own mapping at ${scale}x: the same finger is the same guest pixel with or without the camera`, () => {
        // The content point under a finger is the same wherever the camera put it, so the guest pixel must be too.
        const camera = V.zoomAbout(V.IDENTITY, PHONE, { x: 300, y: 200 }, scale);
        const rect = rectOf(camera, PHONE);
        const plain = rectOf(V.IDENTITY, PHONE);
        for (const [fx, fy] of [[10, 70], [200, 150], [380, 340], [50, 300]]) {
          const finger = { x: fx, y: fy };
          const content = V.contentAt(camera, { x: finger.x - 0, y: finger.y - 56 });
          // What that content point would be as a finger on the uncamera'd picture.
          const unzoomed = { x: plain.left + content.x, y: plain.top + content.y };
          const withCamera = V.clientToGuest(rect, FRAME, finger.x, finger.y);
          const without = V.clientToGuest(plain, FRAME, unzoomed.x, unzoomed.y);
          expect(withCamera?.x).toBe(without?.x as number);
          expect(withCamera?.y).toBe(without?.y as number);
        }
      });
    }

    it('round trips at every zoom between the fit and the maximum, about any focal point, on the device grid', () => {
      // A sweep rather than four rungs: the maths is continuous, and a rounding that is right at 2x and wrong at 1.37x is the bug.
      for (let scale = 1.01; scale <= 3; scale += 0.073) {
        for (const focal of [{ x: 0, y: 0 }, { x: 393, y: 295 }, { x: 117.3, y: 201.9 }]) {
          const camera = V.snap(V.zoomAbout(V.IDENTITY, PHONE, focal, scale), PHONE, 3);
          const rect = rectOf(camera, PHONE);
          for (let gx = 0; gx < FRAME.width; gx += 7) {
            const point = V.guestToClient(rect, FRAME, gx, 241);
            expect(V.clientToGuest(rect, FRAME, point.x, point.y)?.x).toBe(gx);
          }
          for (let gy = 0; gy < FRAME.height; gy += 7) {
            const point = V.guestToClient(rect, FRAME, 317, gy);
            expect(V.clientToGuest(rect, FRAME, point.x, point.y)?.y).toBe(gy);
          }
        }
      }
    });

    it('maps the same finger to a guest pixel at most one off when the translation is put on the device grid', () => {
      // snap() moves the picture by up to half a device pixel; at 3x density and 3x zoom that is a sixth of a guest pixel.
      for (const scale of [1.5, 2, 3]) {
        const exact = V.zoomAbout(V.IDENTITY, PHONE, { x: 211.37, y: 97.11 }, scale);
        const grid = V.snap(exact, PHONE, 3);
        for (const finger of [{ x: 30, y: 90 }, { x: 200, y: 150 }, { x: 380, y: 340 }]) {
          const a = V.clientToGuest(rectOf(exact, PHONE), FRAME, finger.x, finger.y)!;
          const b = V.clientToGuest(rectOf(grid, PHONE), FRAME, finger.x, finger.y)!;
          expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(1);
          expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
        }
      }
    });

    it('says "outside" for the strip beside a letterboxed picture and for the clipped part of a zoomed one', () => {
      const rect = rectOf(V.IDENTITY, PHONE, { x: 0, y: 56 }, { left: 40, top: 0, width: 313, height: 295 });
      expect(V.clientToGuest(rect, FRAME, 10, 100)?.inside).toBeFalse();
      expect(V.clientToGuest(rect, FRAME, 200, 100)?.inside).toBeTrue();
    });

    it('works in an offset canvas (a letterbox) at every zoom: the canvas rectangle already holds it', () => {
      const geometry: CameraGeometry = { view: { width: 520, height: 390 }, content: { width: 520, height: 390 } };
      const canvas = { left: 20, top: 0, width: 480, height: 390 };
      for (const scale of [1, 1.5, 2, 3]) {
        const camera = V.zoomAbout(V.IDENTITY, geometry, { x: 260, y: 195 }, scale);
        const rect = rectOf(camera, geometry, { x: 100, y: 0 }, canvas);
        const point = V.guestToClient(rect, FRAME, 321, 200);
        const hit = V.clientToGuest(rect, FRAME, point.x, point.y);
        expect([hit?.x, hit?.y, hit?.inside]).toEqual([321, 200, true]);
      }
    });

    it('puts a point on the right or the bottom edge on the last pixel, not one past it', () => {
      const rect = rectOf(V.zoomAbout(V.IDENTITY, PHONE, { x: 200, y: 150 }, 2), PHONE);
      const corner = V.clientToGuest(rect, FRAME, rect.right, rect.bottom);
      expect([corner?.x, corner?.y, corner?.inside]).toEqual([639, 479, true]);
      const outside = V.clientToGuest(rect, FRAME, rect.right + 20, rect.bottom + 20);
      expect(outside?.inside).toBeFalse();
      expect(outside?.x).toBeGreaterThan(639);
    });

    it('has no answer for a rectangle with no size (the picture is not laid out)', () => {
      expect(V.clientToGuest({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }, FRAME, 5, 5)).toBeNull();
      expect(V.clientToGuest(rectOf(V.IDENTITY, PHONE), { width: 0, height: 0 }, 5, 70)).toBeNull();
    });

    it('maps a guest pixel to the picture\'s own px for the follow, whatever the camera is', () => {
      const canvas = { left: 20, top: 0, width: 480, height: 390 };
      const content = V.guestToContent(canvas, FRAME, 0, 0);
      near(content.x, 20 + 0.5 / 640 * 480);
      near(V.guestToContent(canvas, FRAME, 639, 479).y, 390 - 0.5 / 480 * 390);
    });
  });

  describe('what is kept per orientation', () => {

    it('round trips a camera in the same window to within a hundredth of a pixel', () => {
      for (const scale of [1.25, 1.5, 2, 3]) {
        const camera = V.zoomAbout(V.IDENTITY, PHONE, { x: 311, y: 77 }, scale);
        const restored = V.fromStored(V.toStored(camera, PHONE), PHONE);
        near(restored.scale, scale, 1e-3);
        near(restored.x, camera.x, 0.1);
        near(restored.y, camera.y, 0.1);
      }
    });

    it('restores the same part of the picture in another window (a rotation, a different phone)', () => {
      const camera = V.zoomAbout(V.IDENTITY, PHONE, { x: 300, y: 150 }, 2);
      const stored = V.toStored(camera, PHONE);
      const restored = V.fromStored(stored, SIDEWAYS);
      // The centre of the view is the same fraction of the picture in both.
      const before = V.toStored(camera, PHONE);
      const after = V.toStored(restored, SIDEWAYS);
      near(after.cx, before.cx, 0.02);
      near(after.cy, before.cy, 0.02);
      expect(after.scale).toBe(2);
    });

    it('is clamped in a window that cannot show it', () => {
      const restored = V.fromStored({ scale: 3, cx: 0.99, cy: 0.99 }, PHONE);
      expect(restored.x).toBe(-786);
      expect(restored.y).toBe(-590);
    });

    it('a stored fit is the identity', () => {
      expect(V.fromStored({ scale: 1, cx: 0.3, cy: 0.9 }, PHONE)).toEqual(state(1, 0, 0));
    });

    it('is kept for each orientation on its own', () => {
      let views = V.withView({}, 'portrait', { scale: 2, cx: 0.5, cy: 0.4 });
      views = V.withView(views, 'landscape', { scale: 1.5, cx: 0.2, cy: 0.2 });
      expect(Object.keys(views).sort()).toEqual(['landscape', 'portrait']);
      views = V.withView(views, 'portrait', null);
      expect(Object.keys(views)).toEqual(['landscape']);
      views = V.withView(views, 'landscape', { scale: 1, cx: 0.5, cy: 0.5 });
      expect(views).toEqual({});
    });

    it('does not mutate the views it was given', () => {
      const views = Object.freeze({ portrait: { scale: 2, cx: 0.5, cy: 0.5 } });
      expect(() => V.withView(views, 'landscape', { scale: 2, cx: 0.1, cy: 0.1 })).not.toThrow();
      expect(Object.keys(views)).toEqual(['portrait']);
    });

    it('reads storage defensively', () => {
      expect(V.normaliseViews(null)).toEqual({});
      expect(V.normaliseViews('2x')).toEqual({});
      expect(V.normaliseViews({ portrait: 'big', landscape: null })).toEqual({});
      expect(V.normaliseViews({ portrait: { scale: 'x', cx: 0.5, cy: 0.5 } })).toEqual({});
      expect(V.normaliseViews({ portrait: { scale: NaN, cx: 0.5, cy: 0.5 } })).toEqual({});
      expect(V.normaliseViews({ portrait: { scale: 2, cx: Infinity, cy: 0.5 } })).toEqual({});
      expect(V.normaliseViews({ portrait: { scale: 1, cx: 0.5, cy: 0.5 } })).toEqual({});
      expect(V.normaliseViews({ portrait: { scale: 2 } })).toEqual({});
    });

    it('keeps what is valid, clamped into range', () => {
      expect(V.normaliseViews({ portrait: { scale: 9, cx: 4, cy: -2 }, landscape: { scale: 1.5, cx: 0.25, cy: 0.75 }, extra: 1 }))
        .toEqual({ portrait: { scale: CAMERA.MAX_SCALE, cx: 1, cy: 0 }, landscape: { scale: 1.5, cx: 0.25, cy: 0.75 } });
    });

    it('tells the orientation from the window', () => {
      expect(V.orientationOf(393, 852)).toBe('portrait');
      expect(V.orientationOf(852, 393)).toBe('landscape');
      expect(V.orientationOf(800, 800)).toBe('portrait');
    });
  });

  describe('the tall view', () => {

    const base: TallViewInput = { zoomed: true, shape: 'portrait', chatOpen: false, deck: 'band', panel: null };
    const rows: Array<[string, Partial<TallViewInput>, boolean]> = [
      ['a magnified picture over a folded band', {}, true],
      ['the camera\'s own panel is up (it is as tall as its keys)', { panel: 'camera' }, true],
      ['no deck at all', { deck: 'none' }, true],
      ['Táticas is up: the panel takes the band', { panel: 'tactics' }, false],
      ['Setas is up', { panel: 'arrows' }, false],
      ['Mais teclas is up', { panel: 'more' }, false],
      ['the chat is up in the band', { panel: 'chat' }, false],
      ['the chat is open', { chatOpen: true }, false],
      ['the picture is not magnified', { zoomed: false }, false],
      ['a landscape phone', { shape: 'landscape-compact', deck: 'rails' }, false],
      ['a landscape tablet', { shape: 'landscape-regular', deck: 'launcher' }, false],
      ['a portrait window too short for a band (the launcher)', { deck: 'launcher' }, false],
      ['portrait with rails (not a real combination)', { deck: 'rails' }, false],
    ];
    for (const [what, change, expected] of rows) {
      it(`${expected ? 'grows' : 'does not grow'} for ${what}`, () => {
        expect(V.tallView({ ...base, ...change })).toBe(expected);
      });
    }
  });

  describe('the setting', () => {

    it('is the player\'s word when there is one, on any device', () => {
      expect(V.enabled(true, false)).toBeTrue();
      expect(V.enabled(false, true, true)).toBeFalse();
    });

    it('is the default for a player who never chose, and only where a finger is the pointer', () => {
      expect(V.enabled(undefined, true, true)).toBeTrue();
      expect(V.enabled(undefined, false, true)).toBeFalse();
      expect(V.enabled(null, true, false)).toBeFalse();
    });

    it('ignores a stored value that is not a boolean', () => {
      expect(V.enabled('yes', true, false)).toBeFalse();
      expect(V.enabled(1, true, true)).toBeTrue();
    });

    it('is off as shipped: the device pass decides', () => {
      expect(CAMERA.DEFAULT_ENABLED).toBeFalse();
    });
  });

  describe('words', () => {

    it('writes a scale with a decimal comma and no trailing zeros', () => {
      expect(V.label(2)).toBe('2x');
      expect(V.label(1.5)).toBe('1,5x');
      expect(V.label(1.25)).toBe('1,25x');
      expect(V.label(1.2500001)).toBe('1,25x');
    });
  });
});
