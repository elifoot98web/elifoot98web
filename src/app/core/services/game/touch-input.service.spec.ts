import { NgZone } from '@angular/core';
import { fakeAsync, tick } from '@angular/core/testing';
import { TOUCH_INPUT } from '../../models/constants';
import { DosCI } from '../../typings/jsdos';
import { silentDiagnostics } from '../shared/diagnostics.testing';
import { ViewportTransform } from '../../helpers/viewport-transform.helper';
import { TouchCamera, TouchInputService } from './touch-input.service';

/**
 * Only what the specs of the pure parts cannot say: that the layer is wired to the DOM the way
 * the design needs. The surface is real elements at 1 px per guest pixel, js-dos's handlers are a
 * bubbling listener on the overlay that records what reaches it, and the emulator is a recorder.
 */
interface Rig {
  service: TouchInputService;
  /** The box around the root (the page's clip). */
  host: HTMLElement;
  root: HTMLElement;
  overlay: HTMLElement;
  canvas: HTMLElement;
  keyboard: HTMLElement;
  /** Event types that reached js-dos's own (bubbling) handlers on the overlay. */
  reached: string[];
  motions: Array<[number, number]>;
  buttons: boolean[];
  dosCI: DosCI;
}

let host: HTMLElement | undefined;
let rig: Rig;

/** What `build` may be asked for: the camera and the clip are the page's, and a rig without them is the layer as it was before the camera. */
interface BuildOptions {
  camera?: TouchCamera;
  /** Listen on the host (the clip) instead of the root, and make the host bigger than the picture. */
  stage?: boolean;
}

function build(options: BuildOptions = {}): Rig {
  host = document.createElement('div');
  host.style.cssText = `position:fixed;left:0;top:0;width:640px;height:${options.stage ? 640 : 480}px`;
  const root = document.createElement('div');
  root.style.cssText = 'position:absolute;left:0;top:0;width:640px;height:480px';
  root.tabIndex = 0;
  const canvas = document.createElement('div');
  canvas.style.cssText = 'position:absolute;left:0;top:0;width:640px;height:480px';
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:absolute;left:0;top:0;width:640px;height:480px';
  // js-dos's virtual keyboard: a control inside the root that is not the picture.
  const keyboard = document.createElement('div');
  keyboard.style.cssText = 'position:absolute;left:0;top:400px;width:640px;height:80px';
  root.append(canvas, overlay, keyboard);
  host.append(root);
  document.body.append(host);

  const motions: Array<[number, number]> = [];
  const buttons: boolean[] = [];
  const dosCI = {
    width: () => 640,
    height: () => 480,
    sendMouseRelativeMotion: (dx: number, dy: number) => { motions.push([dx, dy]); },
    sendMouseButton: (_b: number, pressed: boolean) => { buttons.push(pressed); },
  } as unknown as DosCI;

  const reached: string[] = [];
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchend', 'mousedown', 'mouseup', 'click']) {
    overlay.addEventListener(type, () => reached.push(type));
  }
  keyboard.addEventListener('pointerdown', () => reached.push('keyboard:pointerdown'));

  const service = new TouchInputService(new NgZone({ enableLongStackTrace: false }), silentDiagnostics());
  service.retune({ now: () => Date.now() });
  service.attach(dosCI, { root, overlay, canvas, ...(options.stage ? { stage: host } : {}), ...(options.camera ? { camera: options.camera } : {}) });
  return { service, host, root, overlay, canvas, keyboard, reached, motions, buttons, dosCI };
}

function pointer(target: HTMLElement, type: string, x: number, y: number, init: PointerEventInit = {}) {
  target.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 1, clientX: x, clientY: y, ...init,
  }));
}

const down = (x: number, y: number, init: PointerEventInit = {}) => pointer(rig.overlay, 'pointerdown', x, y, init);
const move = (x: number, y: number, init: PointerEventInit = {}) => pointer(rig.overlay, 'pointermove', x, y, init);
const up = (x: number, y: number, init: PointerEventInit = {}) => pointer(rig.overlay, 'pointerup', x, y, init);

/**
 * A spec body that runs on a fresh layer, inside fakeAsync: attaching starts the engine's timers,
 * so the rig has to be built under the fake clock. fakeAsync is not allowed to drain what is left
 * (`flush: false`), so a timer that outlives `detach()` fails the spec.
 */
const scenario = (body: () => void, options: BuildOptions = {}) => fakeAsync(() => {
  rig = build(options);
  try {
    body();
  } finally {
    rig.service.detach();
    host?.remove();
    host = undefined;
  }
}, { flush: false });

/** A tap with a finger that stays down for `holdMs`. */
function tap(x: number, y: number, holdMs = 60) {
  down(x, y);
  tick(holdMs);
  up(x, y);
}

describe('TouchInputService', () => {

  describe('who gets the event', () => {

    it('keeps a finger away from js-dos: it never sees the touch', scenario(() => {
      down(100, 100);
      move(120, 100);
      up(120, 100);
      tick(1000);

      expect(rig.reached).toEqual([]);
    }));

    it('treats a pen as a finger', scenario(() => {
      down(100, 100, { pointerType: 'pen' });
      up(100, 100, { pointerType: 'pen' });
      tick(1000);

      expect(rig.reached).toEqual([]);
      expect(rig.buttons).toEqual([true, false]);
    }));

    it('leaves a real mouse to js-dos: desktop pointer lock is untouched', scenario(() => {
      pointer(rig.overlay, 'pointerdown', 100, 100, { pointerType: 'mouse' });
      pointer(rig.overlay, 'pointerup', 100, 100, { pointerType: 'mouse' });
      tick(1000);

      expect(rig.reached).toEqual(['pointerdown', 'pointerup']);
      expect(rig.buttons).toEqual([]);
    }));

    it('leaves js-dos\'s own controls alone: a touch on the virtual keyboard is theirs', scenario(() => {
      pointer(rig.keyboard, 'pointerdown', 100, 420);
      pointer(rig.keyboard, 'pointerup', 100, 420);
      tick(1000);

      expect(rig.reached).toEqual(['keyboard:pointerdown']);
      expect(rig.buttons).toEqual([]);
    }));

    it('hides a palm from js-dos too, without acting on it', scenario(() => {
      down(100, 100, { width: 160, height: 160 });
      up(100, 100, { width: 160, height: 160 });
      tick(1000);

      expect(rig.reached).toEqual([]);
      expect(rig.buttons).toEqual([]);
    }));

    it('drops the mouse events the browser fires after a touch, for half a second', scenario(() => {
      tap(100, 100);
      rig.overlay.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      rig.overlay.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      rig.overlay.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(rig.reached).toEqual([]);

      tick(600);
      rig.overlay.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      expect(rig.reached).toEqual(['mousedown']);
    }));

    it('cancels the touch events too, so the browser has nothing to scroll or zoom', scenario(() => {
      const start = new Event('touchstart', { bubbles: true, cancelable: true });
      rig.overlay.dispatchEvent(start);

      expect(start.defaultPrevented).toBeTrue();
      expect(rig.reached).toEqual([]);
    }));
  });

  describe('what a finger does', () => {

    it('clicks under a tap, once, when the finger lifts', scenario(() => {
      down(200, 150);
      tick(60);
      expect(rig.buttons).toEqual([]);

      up(200, 150);
      tick(500);

      expect(rig.buttons).toEqual([true, false]);
      expect(rig.service.inspect()!.position).toEqual({ x: 200, y: 150 });
    }));

    it('clicks twice at one position for a double tap, and moves the cursor only for the first', scenario(() => {
      tap(200, 150);
      tick(100);
      const sent = rig.motions.length;

      tap(212, 154);
      tick(500);

      expect(rig.buttons).toEqual([true, false, true, false]);
      expect(rig.motions.length).toBe(sent);
      expect(rig.service.inspect()!.position).toEqual({ x: 200, y: 150 });
    }));

    it('presses where the finger landed, follows it, and releases where it lifted', scenario(() => {
      down(100, 100);
      tick(40);
      move(130, 100);
      move(300, 200);
      tick(300);
      expect(rig.buttons).toEqual([true]);

      up(300, 200);
      tick(500);

      expect(rig.buttons).toEqual([true, false]);
      expect(rig.service.inspect()!.position).toEqual({ x: 300, y: 200 });
    }));

    it('holds still for aim mode: the cursor goes above the finger and the click is at release', scenario(() => {
      down(200, 300);
      tick(TOUCH_INPUT.HOLD_MS + 20);
      tick(300);
      expect(rig.buttons).toEqual([]);
      expect(rig.service.inspect()!.position).toEqual({ x: 200, y: 300 - TOUCH_INPUT.AIM_OFFSET_PX });

      up(200, 300);
      tick(500);

      expect(rig.buttons).toEqual([true, false]);
    }));

    it('does nothing for a touch that starts outside the picture', scenario(() => {
      // The picture is 640x480; this lands on the overlay, in the strip beside it.
      rig.overlay.style.width = '800px';
      down(700, 100);
      up(700, 100);
      tick(1000);

      expect(rig.buttons).toEqual([]);
    }));

    it('does not read a retry after a miss as a double tap: the second click goes where the second finger is', scenario(() => {
      // 640 wide picture inside an 800 wide overlay: the first tap lands in the strip beside it.
      rig.overlay.style.width = '800px';
      tap(646, 100);
      tick(100);
      expect(rig.buttons).toEqual([]);

      tap(626, 100);
      tick(500);

      expect(rig.buttons).toEqual([true, false]);
      expect(rig.service.inspect()!.position).toEqual({ x: 626, y: 100 });
    }));

    it('keeps a second tap that lands right after the first finger lifted: the lost-pointerup check is not for it', scenario(() => {
      tap(200, 150);
      rig.overlay.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [] }));
      tick(50);
      down(206, 152);
      // Past the 80 ms the check waits, with the second finger still down.
      tick(200);
      expect(rig.service.inspect()!.gesture).toBe('pending');
      up(206, 152);
      tick(500);

      expect(rig.buttons).toEqual([true, false, true, false]);
    }));

    it('cancels at a second finger: nothing is clicked and the first finger lifting adds nothing', scenario(() => {
      down(100, 100);
      pointer(rig.overlay, 'pointerdown', 300, 300, { pointerId: 2 });
      up(100, 100);
      pointer(rig.overlay, 'pointerup', 300, 300, { pointerId: 2 });
      tick(1000);

      expect(rig.buttons).toEqual([]);
    }));
  });

  describe('a button is never left held', () => {

    const startDrag = () => {
      down(100, 100);
      tick(40);
      move(160, 100);
      tick(200);
      expect(rig.service.inspect()!.buttonDown).toBeTrue();
    };

    it('on pointercancel', scenario(() => {
      startDrag();
      pointer(rig.overlay, 'pointercancel', 160, 100);
      expect(rig.buttons).toEqual([true, false]);
    }));

    it('when the page is hidden', scenario(() => {
      startDrag();
      const hidden = spyOnProperty(document, 'hidden', 'get').and.returnValue(true);
      document.dispatchEvent(new Event('visibilitychange'));
      expect(rig.buttons).toEqual([true, false]);
      hidden.and.returnValue(false);
    }));

    it('when the window loses focus', scenario(() => {
      startDrag();
      window.dispatchEvent(new Event('blur'));
      expect(rig.buttons).toEqual([true, false]);
    }));

    it('when the touch ends without a pointerup ever arriving', scenario(() => {
      startDrag();
      rig.overlay.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [] }));
      tick(200);
      expect(rig.buttons).toEqual([true, false]);
    }));

    it('when the finger goes silent for too long', scenario(() => {
      startDrag();
      tick(TOUCH_INPUT.GESTURE_STALL_MS + 1000);
      expect(rig.buttons).toEqual([true, false]);
    }));

    it('on detach, which also hands the finger back to js-dos and leaves no timer behind', scenario(() => {
      startDrag();
      rig.service.detach();
      expect(rig.buttons).toEqual([true, false]);
      expect(rig.service.attached).toBeFalse();

      down(100, 100);
      expect(rig.reached).toEqual(['pointerdown']);
      tick(5000);
    }));
  });

  describe('the game\'s sound', () => {

    interface FakeContext { state: string; resume: jasmine.Spy }
    let context: FakeContext;
    const w = window as unknown as { getDosAudioNode?: () => unknown };

    beforeEach(() => {
      context = { state: 'suspended', resume: jasmine.createSpy('resume').and.callFake(() => Promise.resolve()) };
      w.getDosAudioNode = () => ({ context });
    });

    afterEach(() => { delete w.getDosAudioNode; });

    it('is woken by a lifted finger, because the click js-dos waits for never reaches the document', scenario(() => {
      down(100, 100);
      expect(context.resume).not.toHaveBeenCalled();
      up(100, 100);

      expect(context.resume).toHaveBeenCalledTimes(1);
      tick(500);
    }));

    it('is woken by a touchend as well, which is the event iOS counts', scenario(() => {
      rig.overlay.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [] }));
      expect(context.resume).toHaveBeenCalledTimes(1);
      tick(500);
    }));

    it('is left alone once running, or closed, and when js-dos has no node', scenario(() => {
      context.state = 'running';
      tap(100, 100);
      context.state = 'closed';
      tick(500);
      tap(100, 100);
      w.getDosAudioNode = () => null;
      tick(500);
      tap(100, 100);
      tick(500);

      expect(context.resume).not.toHaveBeenCalled();
    }));

    it('does not mind a browser that refuses', scenario(() => {
      context.resume.and.callFake(() => Promise.reject(new Error('not allowed')));
      tap(100, 100);
      tick(500);

      expect(context.resume).toHaveBeenCalledTimes(1);
      expect(rig.buttons).toEqual([true, false]);
    }));
  });

  describe('for the live type bar', () => {

    const clicks = () => {
      const seen: Array<{ x: number; y: number }> = [];
      rig.service.clicks$.subscribe(point => seen.push(point));
      return seen;
    };

    it('tells where the cursor is once a tap has been clicked, and not before', scenario(() => {
      const seen = clicks();
      down(200, 150);
      tick(60);
      up(200, 150);
      expect(seen).toEqual([]);

      tick(500);
      expect(seen).toEqual([{ x: 200, y: 150 }]);
    }));

    it('tells for a double tap and for the end of aim mode, each time', scenario(() => {
      const seen = clicks();
      tap(200, 150);
      tick(100);
      tap(212, 154);
      tick(500);
      expect(seen).toEqual([{ x: 200, y: 150 }, { x: 200, y: 150 }]);

      down(400, 300);
      tick(TOUCH_INPUT.HOLD_MS + 20);
      tick(300);
      up(400, 300);
      tick(500);
      expect(seen.length).toBe(3);
      expect(seen[2]).toEqual({ x: 400, y: 300 - TOUCH_INPUT.AIM_OFFSET_PX });
    }));

    it('stays quiet for a drag and for a touch outside the picture', scenario(() => {
      const seen = clicks();
      down(100, 100);
      tick(40);
      move(300, 200);
      tick(300);
      up(300, 200);
      tick(500);

      rig.overlay.style.width = '800px';
      tick(1000);
      tap(700, 100);
      tick(500);
      expect(seen).toEqual([]);
    }));

    it('moves the focus to the game on a touch, as a mouse press would', scenario(() => {
      down(200, 150);
      expect(document.activeElement).toBe(rig.root);
      up(200, 150);
      tick(500);
    }));

    it('leaves the focus where it is when the page asks to keep it: the OS keyboard stays open', scenario(() => {
      const field = document.createElement('input');
      document.body.append(field);
      rig.service.attach(rig.dosCI, { root: rig.root, overlay: rig.overlay, canvas: rig.canvas, keepFocus: () => document.activeElement === field });
      field.focus();

      down(200, 150);
      expect(document.activeElement).toBe(field);
      up(200, 150);
      tick(500);
      expect(rig.buttons).withContext('the tap still clicks').toEqual([true, false]);

      field.blur();
      down(200, 150);
      expect(document.activeElement).toBe(rig.root);
      up(200, 150);
      tick(500);
      field.remove();
    }));
  });

  describe('for the battery saver (EmulatorPowerService)', () => {

    it('is busy from the finger landing until the layer has nothing left to send, and not before or after', scenario(() => {
      expect(rig.service.busy).toBeFalse();

      down(300, 300);
      expect(rig.service.busy).toBeTrue();

      tick(60);
      up(300, 300);
      tick(2000);

      expect(rig.service.busy).toBeFalse();
    }));

    it('is busy for a held button even when the finger is still, which is what aim mode and a drag look like', scenario(() => {
      down(300, 300);
      tick(TOUCH_INPUT.HOLD_MS + 200);
      expect(rig.service.busy).toBeTrue();

      up(300, 300);
      tick(2000);
      expect(rig.service.busy).toBeFalse();
    }));

    it('is not busy without a layer', () => {
      expect(new TouchInputService(new NgZone({ enableLongStackTrace: false }), silentDiagnostics()).busy).toBeFalse();
    });

    it('asks the surface to wake the guest before the first thing it sends, and before every one after', scenario(() => {
      const order: string[] = [];
      rig.dosCI.sendMouseRelativeMotion = () => { order.push('motion'); };
      rig.dosCI.sendMouseButton = (_button: number, pressed: boolean) => { order.push(pressed ? 'press' : 'release'); };
      rig.service.attach(rig.dosCI, { root: rig.root, overlay: rig.overlay, canvas: rig.canvas, beforeSend: () => order.push('wake') });

      tap(200, 150);
      tick(500);

      expect(order.filter(entry => entry !== 'wake').length).toBeGreaterThan(2);
      order.forEach((entry, i) => {
        if (entry !== 'wake') expect(order[i - 1]).toBe('wake');
      });
    }));
  });

  describe('keeping the model honest', () => {

    it('forgets where the cursor is when a real mouse moves, so the next touch homes first', scenario(() => {
      tap(200, 150);
      tick(500);
      expect(rig.service.inspect()!.position).not.toBeNull();

      pointer(rig.overlay, 'pointermove', 50, 50, { pointerType: 'mouse' });
      expect(rig.service.inspect()!.position).toBeNull();
      tick(2000);
    }));

    it('attaching again replaces the layer instead of adding a second one', scenario(() => {
      const second = {
        width: () => 640, height: () => 480,
        sendMouseRelativeMotion: () => undefined,
        sendMouseButton: (_button: number, pressed: boolean) => rig.buttons.push(pressed),
      } as unknown as DosCI;
      rig.service.attach(second, { root: rig.root, overlay: rig.overlay, canvas: rig.canvas });

      tap(200, 150);
      tick(500);

      expect(rig.buttons).toEqual([true, false]);
    }));
  });
  describe('for the camera (P11)', () => {

    /** The camera as the layer sees it: what it was told, and a switch for whether it is on. */
    function fakeCamera(on = true) {
      const calls: string[] = [];
      /** For each click, whether the camera was allowed to move the picture for it. */
      const follows: boolean[] = [];
      let enabled = on;
      const camera: TouchCamera = {
        get enabled() { return enabled; },
        gestureStart: () => { calls.push('start'); },
        gestureStep: step => { calls.push(`step x${step.factor.toFixed(2)} to ${Math.round(step.to.x)},${Math.round(step.to.y)}`); },
        gestureEnd: reason => { calls.push(`end ${reason}`); },
        clicked: (point, options) => { calls.push(`clicked ${point.x},${point.y}`); follows.push(options?.follow ?? true); },
      };
      return { camera, calls, follows, turn: (value: boolean) => { enabled = value; } };
    }

    const second = (type: string, x: number, y: number) => pointer(rig.overlay, type, x, y, { pointerId: 2 });

    describe('two fingers', () => {

      it('are a pinch: the camera is told, and a click is never made of them', () => {
        const spy = fakeCamera();
        return scenario(() => {
          down(100, 200);
          second('pointerdown', 200, 200);
          expect(spy.calls).toEqual(['start']);

          second('pointermove', 260, 200);
          move(80, 200);
          up(80, 200);
          second('pointerup', 260, 200);
          tick(1000);

          expect(spy.calls[0]).toBe('start');
          expect(spy.calls.filter(call => call.startsWith('step')).length).toBe(2);
          expect(spy.calls.filter(call => call.startsWith('end'))).toEqual(['end finger lifted']);
          expect(rig.buttons).toEqual([]);
        }, { camera: spy.camera })();
      });

      it('give the camera the steps in page px, with the factor of the spread', () => {
        const spy = fakeCamera();
        return scenario(() => {
          down(100, 200);
          second('pointerdown', 200, 200);
          second('pointermove', 280, 200);

          // 100 px apart become 180: 80 px of change, 72 beyond the dead band; the midpoint moved from 150 to 190.
          expect(spy.calls[1]).toBe(`step x${((100 + 72) / 100).toFixed(2)} to 190,200`);
        }, { camera: spy.camera })();
      });

      it('cancel a drag that is in progress: the button is released, and the pinch begins', () => {
        const spy = fakeCamera();
        return scenario(() => {
          down(100, 100);
          tick(40);
          move(160, 100);
          tick(200);
          expect(rig.service.inspect()!.buttonDown).toBeTrue();

          second('pointerdown', 300, 300);

          expect(rig.buttons).toEqual([true, false]);
          expect(rig.service.inspect()!.buttonDown).toBeFalse();
          expect(spy.calls).toEqual(['start']);
          // And no click follows from lifting them.
          up(160, 100);
          second('pointerup', 300, 300);
          tick(1000);
          expect(rig.buttons).toEqual([true, false]);
        }, { camera: spy.camera })();
      });

      it('with the camera off are what they always were: the gesture is cancelled, nothing else happens', () => {
        const spy = fakeCamera(false);
        return scenario(() => {
          down(100, 100);
          second('pointerdown', 300, 300);
          second('pointermove', 340, 300);
          up(100, 100);
          second('pointerup', 340, 300);
          tick(1000);

          expect(spy.calls).toEqual([]);
          expect(rig.buttons).toEqual([]);
        }, { camera: spy.camera })();
      });

      it('with no camera at all are what they always were', scenario(() => {
        down(100, 100);
        second('pointerdown', 300, 300);
        up(100, 100);
        second('pointerup', 300, 300);
        tick(1000);

        expect(rig.buttons).toEqual([]);
      }));

      it('end when either finger lifts, and the one that is left is dead: it neither clicks nor pairs with the next', () => {
        const spy = fakeCamera();
        return scenario(() => {
          down(100, 200);
          second('pointerdown', 200, 200);
          second('pointerup', 200, 200);
          expect(spy.calls).toEqual(['start', 'end finger lifted']);

          move(120, 200);
          pointer(rig.overlay, 'pointerdown', 300, 300, { pointerId: 3 });
          pointer(rig.overlay, 'pointermove', 340, 300, { pointerId: 3 });
          up(120, 200);
          pointer(rig.overlay, 'pointerup', 340, 300, { pointerId: 3 });
          tick(1000);

          expect(spy.calls).toEqual(['start', 'end finger lifted']);
          expect(rig.buttons).toEqual([]);
        }, { camera: spy.camera })();
      });

      it('a palm as the second finger is neither a pinch nor a cancel of the first one\'s tap', () => {
        const spy = fakeCamera();
        return scenario(() => {
          down(200, 150);
          pointer(rig.overlay, 'pointerdown', 400, 300, { pointerId: 2, width: 160, height: 160 });
          tick(60);
          up(200, 150);
          tick(500);

          expect(spy.calls.filter(call => call !== 'clicked 200,150')).toEqual([]);
          expect(rig.buttons).toEqual([true, false]);
        }, { camera: spy.camera })();
      });

      it('let go of the camera on a pointercancel, when the page is hidden, and when the layer is detached', () => {
        const spy = fakeCamera();
        return scenario(() => {
          down(100, 200);
          second('pointerdown', 200, 200);
          pointer(rig.overlay, 'pointercancel', 100, 200, { pointerId: 1 });
          expect(spy.calls).toEqual(['start', 'end pointercancel']);
          second('pointerup', 200, 200);

          down(100, 200);
          second('pointerdown', 200, 200);
          const hidden = spyOnProperty(document, 'hidden', 'get').and.returnValue(true);
          document.dispatchEvent(new Event('visibilitychange'));
          hidden.and.returnValue(false);
          expect(spy.calls.slice(-2)).toEqual(['start', 'end visibility change']);

          down(100, 200);
          second('pointerdown', 200, 200);
          rig.service.detach('spec');
          expect(spy.calls[spy.calls.length - 1]).toBe('end spec');
        }, { camera: spy.camera })();
      });
    });

    describe('the clip around the picture', () => {

      it('is where the layer listens when it is given: a touch on the part of the view the picture does not cover is the layer\'s', () => {
        const spy = fakeCamera();
        return scenario(() => {
          const start = new Event('touchstart', { bubbles: true, cancelable: true });
          rig.host.dispatchEvent(start);
          expect(start.defaultPrevented).toBeTrue();

          // A tap down there clicks nothing: it is outside the picture, like the strip beside a letterboxed one.
          pointer(rig.host, 'pointerdown', 300, 560);
          pointer(rig.host, 'pointerup', 300, 560);
          tick(1000);
          expect(rig.buttons).toEqual([]);
          expect(rig.reached).toEqual([]);
        }, { camera: spy.camera, stage: true })();
      });

      it('lets a second finger there cancel the first one\'s click and start the pinch', () => {
        const spy = fakeCamera();
        return scenario(() => {
          down(200, 150);
          pointer(rig.host, 'pointerdown', 300, 560, { pointerId: 2 });
          pointer(rig.host, 'pointerup', 300, 560, { pointerId: 2 });
          up(200, 150);
          tick(1000);

          expect(rig.buttons).toEqual([]);
          expect(spy.calls.slice(0, 1)).toEqual(['start']);
        }, { camera: spy.camera, stage: true })();
      });

      it('changes nothing for a finger on the picture: a tap still clicks once, under the finger', () => {
        const spy = fakeCamera();
        return scenario(() => {
          tap(200, 150);
          tick(500);

          expect(rig.buttons).toEqual([true, false]);
          expect(rig.service.inspect()!.position).toEqual({ x: 200, y: 150 });
          expect(rig.reached).toEqual([]);
        }, { camera: spy.camera, stage: true })();
      });

      it('leaves a real mouse to js-dos there too', scenario(() => {
        pointer(rig.overlay, 'pointerdown', 100, 100, { pointerType: 'mouse' });
        pointer(rig.overlay, 'pointerup', 100, 100, { pointerType: 'mouse' });
        expect(rig.reached).toEqual(['pointerdown', 'pointerup']);
        expect(rig.buttons).toEqual([]);
      }, { stage: true }));
    });

    describe('a click', () => {

      it('is reported to the camera, at the guest pixel the cursor is on', () => {
        const spy = fakeCamera();
        return scenario(() => {
          tap(200, 150);
          tick(500);
          expect(spy.calls).toEqual(['clicked 200,150']);
        }, { camera: spy.camera })();
      });

      it('is told when a finger has landed since, so the camera does not move the picture under it', () => {
        const spy = fakeCamera();
        return scenario(() => {
          tap(200, 150);
          // The cursor's walk and the click are paced: this finger is down before they settle.
          down(300, 300);
          tick(500);
          expect(spy.calls).toEqual(['clicked 200,150']);
          expect(spy.follows).toEqual([false]);

          up(300, 300);
          tick(2000);
          spy.calls.length = 0;
          spy.follows.length = 0;
          tap(200, 150);
          tick(500);
          expect(spy.follows).toEqual([true]);
        }, { camera: spy.camera })();
      });

      it('is reported for a double tap, and for the end of aim mode', () => {
        const spy = fakeCamera();
        return scenario(() => {
          tap(200, 150);
          tick(100);
          tap(206, 152);
          tick(500);
          down(300, 300);
          tick(TOUCH_INPUT.HOLD_MS + 20);
          up(300, 300);
          tick(500);

          expect(spy.calls).toEqual(['clicked 200,150', 'clicked 200,150', `clicked 300,${300 - TOUCH_INPUT.AIM_OFFSET_PX}`]);
        }, { camera: spy.camera })();
      });

      it('is not reported when the camera is off, or when the tap was outside the picture', () => {
        const off = fakeCamera(false);
        scenario(() => {
          tap(200, 150);
          tick(500);
          expect(off.calls).toEqual([]);
        }, { camera: off.camera })();

        const on = fakeCamera();
        return scenario(() => {
          rig.overlay.style.width = '800px';
          tap(700, 100);
          tick(500);
          expect(on.calls).toEqual([]);
        }, { camera: on.camera })();
      });
    });

    describe('with the picture magnified by a transform on its root', () => {

      /** The camera's transform as CameraService writes it: from the corner, translate and scale. */
      const magnify = (scale: number, x: number, y: number) => {
        rig.root.style.transformOrigin = '0 0';
        rig.root.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
      };

      for (const scale of [1, 1.5, 2, 3]) {
        it(`a tap lands on the guest pixel it was aimed at, at ${scale}x`, scenario(() => {
          magnify(scale, -37, -23);
          const rect = rig.canvas.getBoundingClientRect();

          for (const [gx, gy] of [[320, 240], [100, 60], [600, 400], [15, 470]]) {
            const point = ViewportTransform.guestToClient(rect, { width: 640, height: 480 }, gx, gy);
            tap(point.x, point.y);
            tick(300);
            // The engine's model is the guest's own arithmetic (1 px a unit up to 2 units, 2 px beyond), which cannot make an odd
            // distance exactly: one pixel of it is the model, a wrong scale in the mapping would be tens.
            const at = rig.service.inspect()!.position!;
            expect(Math.abs(at.x - gx)).toBeLessThanOrEqual(1);
            expect(Math.abs(at.y - gy)).toBeLessThanOrEqual(1);
            tick(1000);
          }
        }));
      }

      it('a tap outside the magnified picture is outside the picture', scenario(() => {
        magnify(2, 0, 0);
        // The picture is 1280x960 now and starts at the corner: a point left of it is not on it.
        down(-5, 100);
        up(-5, 100);
        tick(1000);
        expect(rig.buttons).toEqual([]);
      }));

      it('puts the tap ring under the finger in the picture\'s own px, and keeps it a fingertip big on the screen', scenario(() => {
        magnify(2, -100, -50);
        rig.root.style.setProperty('--camera-unscale', '0.5');
        tap(300, 200);
        tick(10);

        const ring = rig.root.querySelector('.touch-feedback') as HTMLElement;
        expect(ring).not.toBeNull();
        // (300 - (-100)) / 2 and (200 - (-50)) / 2 in the root's own space.
        expect(ring.style.left).toBe('200px');
        expect(ring.style.top).toBe('125px');
        tick(1000);
      }));
    });
  });
});
