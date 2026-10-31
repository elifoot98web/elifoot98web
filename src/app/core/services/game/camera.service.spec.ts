import { NgZone } from '@angular/core';
import { fakeAsync, flush, tick } from '@angular/core/testing';
import { CameraOrientation } from '../../helpers/viewport-transform.helper';
import { CAMERA, STORAGE_KEY } from '../../models/constants';
import { logRecorder, memoryStorage } from '../shared/diagnostics.testing';
import { LocalStorageService } from '../shared/local-storage.service';
import { CameraService, CameraView } from './camera.service';

/** The service with the two things the browser answers made into plain fields, so a spec can turn the phone and pick the density. */
class TestCamera extends CameraService {
  heldAs: CameraOrientation = 'portrait';
  density = 2;
  protected override orientationNow(): CameraOrientation { return this.heldAs; }
  protected override devicePixelRatio(): number { return this.density; }
}

interface Rig {
  camera: TestCamera;
  stage: HTMLElement;
  root: HTMLElement;
  canvas: HTMLElement;
  storage: ReturnType<typeof memoryStorage>;
  log: ReturnType<typeof logRecorder>;
  activity: jasmine.Spy;
  views: CameraView[];
  writes: () => number;
}

let host: HTMLElement | undefined;
let sheet: HTMLStyleElement | undefined;
let rig: Rig;

/** A 393x295 picture (640x480 at 0.614) in a clip of the same box, 56 px down the page, as a portrait phone has it. */
function build(options: { enabled?: boolean; stored?: unknown; rootSize?: [number, number] } = {}): Rig {
  host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:56px;width:393px;height:600px';
  const stage = document.createElement('div');
  stage.style.cssText = 'position:relative;overflow:hidden;width:393px;height:295px';
  // The picture's size comes from a class, like the page's: the root has NO style attribute until the camera writes one (and a spec can
  // check that it is given back as it was). A spec that resizes it, or starts it unlaid-out, writes an inline size over the class.
  sheet = document.createElement('style');
  sheet.textContent = '.camera-spec-root{position:relative;width:393px;height:295px}';
  document.head.append(sheet);
  const root = document.createElement('div');
  root.className = 'camera-spec-root';
  if (options.rootSize) root.style.cssText = `width:${options.rootSize[0]}px;height:${options.rootSize[1]}px`;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%';
  root.append(canvas);
  stage.append(root);
  host.append(stage);
  document.body.append(host);

  const storage = memoryStorage();
  const sets = jasmine.createSpy('set').and.callFake((key: string, value: unknown) => { storage.values.set(key, value); return Promise.resolve(); });
  (storage as { set: unknown }).set = sets;
  const log = logRecorder();
  const camera = new TestCamera(new NgZone({ enableLongStackTrace: false }), log.diagnostics as never, storage as unknown as LocalStorageService);
  const activity = jasmine.createSpy('activity');
  const views: CameraView[] = [];
  camera.view$.subscribe(view => views.push(view));
  camera.configure(options.enabled ?? true, options.stored ?? {});
  camera.attach({ stage, root, canvas, frame: () => ({ width: 640, height: 480 }) }, { activity, now: () => Date.now() });
  return { camera, stage, root, canvas, storage, log, activity, views, writes: () => sets.calls.count() };
}

/** A spec body on a fresh rig, inside fakeAsync with nothing allowed to be left scheduled (`flush: false`). */
const scenario = (body: () => void, options: Parameters<typeof build>[0] = {}) => fakeAsync(() => {
  rig = build(options);
  try {
    body();
  } finally {
    rig.camera.detach('spec');
    cleanUp();
  }
}, { flush: false });

function cleanUp() {
  host?.remove();
  host = undefined;
  sheet?.remove();
  sheet = undefined;
}

const transform = () => rig.root.style.transform;

describe('CameraService', () => {

  describe('with the setting off', () => {

    it('writes nothing to the picture, whatever it is asked', scenario(() => {
      rig.camera.zoomTo(2);
      rig.camera.zoomStep(1);
      rig.camera.nudge('right');
      rig.camera.gestureStart();
      rig.camera.gestureStep({ from: { x: 150, y: 156 }, to: { x: 150, y: 156 }, factor: 2 });
      rig.camera.gestureEnd('spec');

      expect(rig.root.getAttribute('style')).toBeNull();
      expect(transform()).toBe('');
      expect(rig.root.style.transformOrigin).toBe('');
      expect(rig.camera.enabled).toBeFalse();
      expect(rig.activity).not.toHaveBeenCalled();
    }, { enabled: false }));

    it('is not enabled before there is a picture to put it on', fakeAsync(() => {
      const camera = new TestCamera(new NgZone({ enableLongStackTrace: false }), logRecorder().diagnostics as never, memoryStorage() as unknown as LocalStorageService);
      camera.configure(true, {});
      expect(camera.enabled).toBeFalse();
    }, { flush: false }));
  });

  describe('the presets and the buttons', () => {

    it('2x puts a translate and a scale on the picture\'s root, from its corner, and nothing else', scenario(() => {
      rig.camera.zoomTo(2);

      // About the middle of the view (196.5, 147.5): the picture\'s middle stays in the middle.
      expect(transform()).toBe('translate(-196.5px, -147.5px) scale(2)');
      expect(rig.root.style.transformOrigin).toContain('0px');
      expect(rig.camera.zoomed).toBeTrue();
      // The canvas is never touched on its own.
      expect(rig.canvas.style.transform).toBe('');
    }));

    it('leaves the picture\'s own box alone: nothing the layout or js-dos reads changes', scenario(() => {
      const before = [rig.root.offsetWidth, rig.root.offsetHeight, rig.canvas.offsetWidth, rig.canvas.offsetHeight, rig.canvas.offsetLeft, rig.canvas.offsetTop];
      rig.camera.zoomTo(1.5);
      rig.camera.zoomTo(2);
      rig.camera.zoomTo(3);

      expect([rig.root.offsetWidth, rig.root.offsetHeight, rig.canvas.offsetWidth, rig.canvas.offsetHeight, rig.canvas.offsetLeft, rig.canvas.offsetTop]).toEqual(before);
      expect(rig.stage.clientWidth).toBe(393);
      expect(rig.stage.clientHeight).toBe(295);
    }));

    it('Ajustar sets NO transform (not scale(1)) and gives the element its attribute back as it was', scenario(() => {
      rig.camera.zoomTo(2);
      expect(transform()).not.toBe('');

      rig.camera.fit();

      expect(transform()).toBe('');
      expect(rig.root.style.transformOrigin).toBe('');
      expect(rig.root.style.getPropertyValue('--camera-unscale')).toBe('');
      expect(rig.root.getAttribute('style')).toBeNull();
    }));

    it('writes the inverse scale for the tap rings while the picture is magnified', scenario(() => {
      rig.camera.zoomTo(2);
      expect(rig.root.style.getPropertyValue('--camera-unscale')).toBe('0.5');
      rig.camera.zoomTo(1.5);
      expect(rig.root.style.getPropertyValue('--camera-unscale')).toBe('0.6667');
    }));

    it('climbs and descends the ladder with + and -, and stops at the ends', scenario(() => {
      rig.camera.zoomStep(1);
      expect(rig.camera.current.scale).toBe(1.25);
      rig.camera.zoomStep(1);
      rig.camera.zoomStep(1);
      expect(rig.camera.current.scale).toBe(1.75);
      for (let i = 0; i < 8; i++) rig.camera.zoomStep(1);
      expect(rig.camera.current.scale).toBe(CAMERA.MAX_SCALE);
      for (let i = 0; i < 12; i++) rig.camera.zoomStep(-1);
      expect(rig.camera.current.scale).toBe(1);
      expect(transform()).toBe('');
    }));

    it('zooms about the last click when it was recent and is on the view, otherwise about the middle', scenario(() => {
      // Guest (100, 100) of the 640x480 frame, the centre of that pixel, on the 393x295 picture.
      const at = { x: 100.5 / 640 * 393, y: 100.5 / 480 * 295 };
      rig.camera.clicked({ x: 100, y: 100 });
      rig.camera.zoomTo(2);
      expect(rig.camera.current.x).toBeCloseTo(-at.x, 6);
      expect(rig.camera.current.y).toBeCloseTo(-at.y, 6);

      rig.camera.fit();
      tick(CAMERA.FOCUS_CLICK_MS + 1);
      rig.camera.zoomTo(2);
      expect(rig.camera.current.x).toBe(-196.5);
      expect(rig.camera.current.y).toBe(-147.5);
    }));

    it('wakes the guest for every press of a button', scenario(() => {
      rig.camera.zoomTo(2);
      rig.camera.nudge('right');
      rig.camera.zoomStep(-1);
      expect(rig.activity).toHaveBeenCalledTimes(3);
    }));

    it('moves the view with the pad, and does nothing to a picture that is not magnified', scenario(() => {
      rig.camera.nudge('right');
      expect(transform()).toBe('');

      rig.camera.zoomTo(2);
      const before = rig.camera.current.x;
      rig.camera.nudge('right');
      expect(rig.camera.current.x).toBeLessThan(before);
      rig.camera.nudge('left');
      expect(rig.camera.current.x).toBe(before);
    }));
  });

  describe('two fingers', () => {

    const spread = (x: number, y: number, factor: number) => ({ from: { x, y }, to: { x, y }, factor });

    it('zooms about the fingers\' midpoint in the view\'s own space (the clip is 56 px down the page)', scenario(() => {
      rig.camera.gestureStart();
      // Page (150, 156) is the view point (150, 100).
      rig.camera.gestureStep(spread(150, 156, 2));

      expect(rig.camera.current.scale).toBe(2);
      expect(rig.camera.current.x).toBe(-150);
      expect(rig.camera.current.y).toBe(-100);
      expect(transform()).toBe('translate(-150px, -100px) scale(2)');
    }));

    it('pans with a step whose factor is 1', scenario(() => {
      rig.camera.zoomTo(2);
      const start = { ...rig.camera.current };
      rig.camera.gestureStart();
      rig.camera.gestureStep({ from: { x: 200, y: 200 }, to: { x: 170, y: 230 }, factor: 1 });

      expect(rig.camera.current.x).toBe(start.x - 30);
      expect(rig.camera.current.y).toBe(start.y + 30);
    }));

    it('stops at the edges of the picture', scenario(() => {
      rig.camera.zoomTo(2);
      rig.camera.gestureStart();
      // Fingers dragged up and to the left drag the picture with them, further than it goes.
      rig.camera.gestureStep({ from: { x: 300, y: 300 }, to: { x: 20, y: 56 }, factor: 1 });
      expect(rig.camera.current.x).toBe(-393);
      expect(rig.camera.current.y).toBe(-295);

      // And back down and to the right, further than the whole range.
      rig.camera.gestureStep({ from: { x: 20, y: 56 }, to: { x: 600, y: 500 }, factor: 1 });
      expect(rig.camera.current.x).toBe(0);
      expect(rig.camera.current.y).toBe(0);
    }));

    it('a pinch that ends near the fit is the fit: the transform goes', scenario(() => {
      rig.camera.gestureStart();
      rig.camera.gestureStep(spread(150, 156, 1.04));
      expect(rig.camera.current.scale).toBe(1.04);

      rig.camera.gestureEnd('finger lifted');

      expect(rig.camera.current.scale).toBe(1);
      expect(transform()).toBe('');
    }));

    it('keeps a pinch that ended past the fit where it is', scenario(() => {
      rig.camera.gestureStart();
      rig.camera.gestureStep(spread(150, 156, 1.6));
      rig.camera.gestureEnd('finger lifted');
      expect(rig.camera.current.scale).toBe(1.6);
    }));

    it('tells the page about the zoom once, and about its label when the fingers lift, not at every step', scenario(() => {
      const before = rig.views.length;
      rig.camera.gestureStart();
      for (let i = 0; i < 60; i++) rig.camera.gestureStep(spread(150, 156, 1.01));
      const during = rig.views.slice(before);
      rig.camera.gestureEnd('finger lifted');
      const after = rig.views.slice(before);

      expect(during.length).toBe(1);
      expect(during[0].zoomed).toBeTrue();
      expect(after.length).toBe(2);
      expect(after[1].label).toBe(`${String(Math.round(Math.pow(1.01, 60) * 100) / 100).replace('.', ',')}x`);
    }));

    it('ignores steps with no pinch in progress, and a pinch with the setting off', scenario(() => {
      rig.camera.gestureStep(spread(150, 156, 2));
      expect(transform()).toBe('');

      rig.camera.setEnabled(false);
      rig.camera.gestureStart();
      rig.camera.gestureStep(spread(150, 156, 2));
      expect(transform()).toBe('');
    }));

    it('lets go of a pinch when the setting is switched off in the middle of it', scenario(() => {
      rig.camera.gestureStart();
      rig.camera.gestureStep(spread(150, 156, 2));
      rig.camera.setEnabled(false);

      expect(transform()).toBe('');
      rig.camera.gestureStep(spread(150, 156, 2));
      expect(transform()).toBe('');
    }));

    it('logs the pinch: its start, the throttled steps, a clamp and its end', scenario(() => {
      rig.camera.gestureStart();
      rig.camera.gestureStep(spread(150, 156, 1.5));
      tick(CAMERA.LOG_PINCH_EVERY_MS + 1);
      rig.camera.gestureStep(spread(150, 156, 1.1));
      tick(CAMERA.LOG_PINCH_EVERY_MS + 1);
      rig.camera.gestureStep(spread(150, 156, 5));
      rig.camera.gestureEnd('finger lifted');

      const messages = rig.log.messages();
      expect(messages).toContain('camera pinch start');
      expect(messages).toContain('camera pinch');
      expect(messages).toContain('camera clamp');
      expect(messages).toContain('camera pinch end');
    }));

    it('does not log every step of a pinch', scenario(() => {
      rig.camera.gestureStart();
      for (let i = 0; i < 100; i++) rig.camera.gestureStep(spread(150, 156, 1.001));
      rig.camera.gestureEnd('finger lifted');
      expect(rig.log.messages().filter(message => message === 'camera pinch').length).toBeLessThanOrEqual(1);
    }));

    it('wakes the guest when two fingers land', scenario(() => {
      rig.camera.gestureStart();
      expect(rig.activity).toHaveBeenCalledTimes(1);
    }));
  });

  describe('following a click', () => {

    it('leaves the view alone for a click well inside it', scenario(() => {
      rig.camera.zoomTo(2);
      const before = { ...rig.camera.current };
      // The middle of the frame.
      rig.camera.clicked({ x: 320, y: 240 });

      expect(rig.camera.current).toEqual(before);
      expect(rig.log.messages()).not.toContain('camera follow');
    }));

    it('moves the view for a click near its edge, by the least that gives the click its margin', scenario(() => {
      rig.camera.zoomTo(2);
      rig.camera.nudge('left');
      rig.camera.nudge('left');
      rig.camera.nudge('up');
      rig.camera.nudge('up');
      expect(rig.camera.current.x).toBe(0);
      // Guest (310, 100) is at x = 190.7 on the picture, 381.3 on the view at 2x: 12 px from the right edge of 393.
      rig.camera.clicked({ x: 310, y: 100 });

      const margin = 393 * CAMERA.FOLLOW_MARGIN;
      expect(rig.camera.current.x + 310.5 / 640 * 393 * 2).toBeCloseTo(393 - margin, 6);
      expect(rig.log.messages()).toContain('camera follow');
    }));

    it('does not move the picture under a finger that landed since: a click that settles during a pinch, or with a finger down, is only remembered', scenario(() => {
      rig.camera.zoomTo(2);
      rig.camera.nudge('left');
      rig.camera.nudge('left');
      rig.camera.nudge('up');
      rig.camera.nudge('up');
      const before = { ...rig.camera.current };

      // The same click that moves the view above (12 px from the right edge), told that a finger is down by the time it settles.
      rig.camera.clicked({ x: 310, y: 100 }, { follow: false });
      expect(rig.camera.current).toEqual(before);

      // And a pinch that has started, whatever the layer said.
      rig.camera.gestureStart();
      rig.camera.clicked({ x: 310, y: 100 });
      expect(rig.camera.current).toEqual(before);
      rig.camera.gestureEnd('spec');
      expect(rig.log.messages()).not.toContain('camera follow');

      // It was still remembered: a button zooms about it.
      rig.camera.zoomTo(3);
      const click = { x: 310.5 / 640 * 393, y: 100.5 / 480 * 295 };
      expect(rig.camera.current.x + click.x * 3).toBeCloseTo(before.x + click.x * 2, 6);
    }));

    it('does nothing at the fit, and with the setting off', scenario(() => {
      rig.camera.clicked({ x: 630, y: 470 });
      expect(transform()).toBe('');

      rig.camera.setEnabled(false);
      rig.camera.clicked({ x: 630, y: 470 });
      expect(transform()).toBe('');
    }));
  });

  describe('when the window changes', () => {

    it('keeps the camera valid when the view grows (the band under the picture)', scenario(() => {
      rig.camera.zoomTo(2);
      rig.camera.nudge('right');
      rig.camera.nudge('right');
      rig.camera.nudge('right');
      rig.camera.nudge('right');
      rig.camera.nudge('down');
      rig.camera.nudge('down');
      rig.camera.nudge('down');
      rig.camera.nudge('down');
      expect(rig.camera.current.y).toBe(-295);

      // The clip grows down to 500: the 590 px picture can only be moved 90 px now.
      rig.stage.style.height = '500px';
      rig.camera.refresh();

      expect(rig.camera.current.y).toBe(-90);
      expect(transform()).toContain('-90px');
    }));

    it('keeps the camera as it is when the view shrinks', scenario(() => {
      rig.camera.zoomTo(2);
      const before = { ...rig.camera.current };
      rig.stage.style.height = '200px';
      rig.camera.refresh();
      expect(rig.camera.current).toEqual(before);
    }));

    it('keeps one camera per orientation: a rotation swaps the other one in, and back', scenario(() => {
      rig.camera.zoomTo(2);
      const portrait = { ...rig.camera.current };

      // Turn the phone: a 524x393 picture in a clip of the same box.
      rig.camera.heldAs = 'landscape';
      rig.stage.style.width = '524px';
      rig.stage.style.height = '393px';
      rig.root.style.width = '524px';
      rig.root.style.height = '393px';
      rig.camera.refresh();

      expect(rig.camera.current.scale).toBe(1);
      expect(transform()).toBe('');
      rig.camera.zoomTo(1.5);
      expect(rig.camera.current.scale).toBe(1.5);

      // And back: the portrait camera is where it was left.
      rig.camera.heldAs = 'portrait';
      rig.stage.style.width = '393px';
      rig.stage.style.height = '295px';
      rig.root.style.width = '393px';
      rig.root.style.height = '295px';
      rig.camera.refresh();

      expect(rig.camera.current.scale).toBe(2);
      expect(rig.camera.current.x).toBeCloseTo(portrait.x, 0);
      expect(rig.camera.current.y).toBeCloseTo(portrait.y, 0);
      expect(rig.log.messages()).toContain('camera rotation');
    }));

    it('stores the camera it leaves against the window it was made for, not the new one', scenario(() => {
      rig.camera.zoomTo(2);
      rig.camera.heldAs = 'landscape';
      rig.stage.style.width = '524px';
      rig.stage.style.height = '393px';
      rig.root.style.width = '524px';
      rig.root.style.height = '393px';
      rig.camera.refresh();

      const stored = rig.storage.values.get(STORAGE_KEY.CAMERA_VIEWS) as { portrait: { scale: number; cx: number; cy: number } };
      expect(stored.portrait.scale).toBe(2);
      // 2x about the middle: the view's centre is the picture's centre.
      expect(stored.portrait.cx).toBeCloseTo(0.5, 3);
      expect(stored.portrait.cy).toBeCloseTo(0.5, 3);
    }));
  });

  describe('what is kept', () => {

    it('writes the camera a little after the last change, once', scenario(() => {
      rig.camera.zoomTo(1.5);
      rig.camera.zoomTo(2);
      rig.camera.nudge('right');
      expect(rig.writes()).toBe(0);

      tick(CAMERA.SAVE_DEBOUNCE_MS - 1);
      expect(rig.writes()).toBe(0);
      tick(2);
      expect(rig.writes()).toBe(1);
      expect((rig.storage.values.get(STORAGE_KEY.CAMERA_VIEWS) as Record<string, { scale: number }>)['portrait'].scale).toBe(2);
    }));

    it('does not write at every step of a pinch, only after it', scenario(() => {
      rig.camera.gestureStart();
      for (let i = 0; i < 30; i++) rig.camera.gestureStep({ from: { x: 150, y: 156 }, to: { x: 150, y: 156 }, factor: 1.02 });
      tick(CAMERA.SAVE_DEBOUNCE_MS * 2);
      expect(rig.writes()).toBe(0);

      rig.camera.gestureEnd('finger lifted');
      tick(CAMERA.SAVE_DEBOUNCE_MS + 1);
      expect(rig.writes()).toBe(1);
    }));

    it('writes at once when the camera is taken off the page', fakeAsync(() => {
      rig = build();
      rig.camera.zoomTo(2);
      expect(rig.writes()).toBe(0);
      rig.camera.detach('spec');
      expect(rig.writes()).toBe(1);
      cleanUp();
    }, { flush: false }));

    it('forgets a camera put back at the fit', scenario(() => {
      rig.camera.zoomTo(2);
      tick(CAMERA.SAVE_DEBOUNCE_MS + 1);
      rig.camera.fit();
      tick(CAMERA.SAVE_DEBOUNCE_MS + 1);
      expect(rig.storage.values.get(STORAGE_KEY.CAMERA_VIEWS)).toEqual({});
    }));

    it('puts the camera back where it was left, in this orientation', scenario(() => {
      expect(rig.camera.current.scale).toBe(2);
      expect(rig.camera.current.x).toBeCloseTo(-196.5, 0);
      expect(transform()).toContain('scale(2)');
      expect(rig.log.messages()).toContain('camera restored');
    }, { stored: { portrait: { scale: 2, cx: 0.5, cy: 0.5 }, landscape: { scale: 1.5, cx: 0.1, cy: 0.1 } } }));

    it('reads a bad value as no camera', scenario(() => {
      expect(rig.camera.current.scale).toBe(1);
      expect(transform()).toBe('');
    }, { stored: { portrait: { scale: 'enorme' }, landscape: 7 } }));

    it('waits for the picture to have a size, then puts it back (the page attaches while the game is hidden)', scenario(() => {
      expect(rig.camera.current.scale).toBe(1);

      rig.root.style.width = '393px';
      rig.root.style.height = '295px';
      rig.camera.refresh();

      expect(rig.camera.current.scale).toBe(2);
      expect(transform()).toContain('scale(2)');
    }, { stored: { portrait: { scale: 2, cx: 0.5, cy: 0.5 } }, rootSize: [0, 0] }));

    it('does not put an old camera back over one the player has just chosen', scenario(() => {
      rig.root.style.width = '393px';
      rig.root.style.height = '295px';
      rig.camera.zoomTo(1.5);
      rig.camera.refresh();
      expect(rig.camera.current.scale).toBe(1.5);
    }, { stored: { portrait: { scale: 2, cx: 0.5, cy: 0.5 } }, rootSize: [0, 0] }));
  });

  describe('the switch', () => {

    it('off puts the picture back exactly, and keeps the camera for when it is on again', scenario(() => {
      rig.camera.zoomTo(2);
      rig.camera.setEnabled(false);

      expect(transform()).toBe('');
      expect(rig.camera.enabled).toBeFalse();
      expect(rig.storage.values.get(STORAGE_KEY.CAMERA_VIEWS)).toEqual({ portrait: jasmine.objectContaining({ scale: 2 }) });

      rig.camera.setEnabled(true);
      expect(rig.camera.current.scale).toBe(2);
      expect(transform()).toContain('scale(2)');
    }));

    it('tells the page', scenario(() => {
      rig.camera.zoomTo(2);
      expect(rig.views[rig.views.length - 1]).toEqual(jasmine.objectContaining({ enabled: true, zoomed: true, label: '2x' }));

      rig.camera.setEnabled(false);
      expect(rig.views[rig.views.length - 1]).toEqual(jasmine.objectContaining({ enabled: false, zoomed: false, label: 'Ajustar' }));
    }));
  });

  describe('leaving', () => {

    it('takes everything off the page: the transform, the property and the attribute', scenario(() => {
      rig.camera.zoomTo(2);
      rig.camera.detach('spec');

      expect(rig.root.getAttribute('style')).toBeNull();
      expect(rig.camera.enabled).toBeFalse();
      expect(rig.views[rig.views.length - 1].attached).toBeFalse();
    }));

    it('attaching again lets go of the first attachment', scenario(() => {
      rig.camera.zoomTo(2);
      rig.camera.attach({ stage: rig.stage, root: rig.root, canvas: rig.canvas, frame: () => ({ width: 640, height: 480 }) }, { now: () => Date.now() });
      // The camera that was left is put back from storage, not carried over by accident.
      expect(rig.camera.current.scale).toBe(2);
      expect(rig.log.messages().filter(message => message === 'camera detached').length).toBe(1);
    }));

    it('leaves nothing scheduled', fakeAsync(() => {
      rig = build();
      rig.camera.zoomTo(2);
      rig.camera.detach('spec');
      // flush() answers with the virtual milliseconds it had to advance to run what was pending: 0 is "nothing was scheduled".
      // (fakeAsync with flush:false would also fail on a leftover timer, but only implicitly, and Jasmine calls that "no expectations".)
      expect(flush()).toBe(0);
      cleanUp();
    }, { flush: false }));
  });
});
