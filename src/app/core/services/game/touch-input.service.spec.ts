import { NgZone } from '@angular/core';
import { fakeAsync, tick } from '@angular/core/testing';
import { TOUCH_INPUT } from '../../models/constants';
import { DosCI } from '../../typings/jsdos';
import { silentDiagnostics } from '../shared/diagnostics.testing';
import { TouchInputService } from './touch-input.service';

/**
 * Only what the specs of the pure parts cannot say: that the layer is wired to the DOM the way
 * the design needs. The surface is real elements at 1 px per guest pixel, js-dos's handlers are a
 * bubbling listener on the overlay that records what reaches it, and the emulator is a recorder.
 */
interface Rig {
  service: TouchInputService;
  root: HTMLElement;
  overlay: HTMLElement;
  canvas: HTMLElement;
  keyboard: HTMLElement;
  /** Event types that reached js-dos's own (bubbling) handlers on the overlay. */
  reached: string[];
  motions: Array<[number, number]>;
  buttons: boolean[];
}

let host: HTMLElement | undefined;
let rig: Rig;

function build(): Rig {
  host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;width:640px;height:480px';
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
  service.attach(dosCI, { root, overlay, canvas });
  return { service, root, overlay, canvas, keyboard, reached, motions, buttons };
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
const scenario = (body: () => void) => fakeAsync(() => {
  rig = build();
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
});
