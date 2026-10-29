import { fakeAsync, tick } from '@angular/core/testing';
import { DosCI } from '../typings/jsdos';
import { GuestFrame, GuestPoint, GuestPointer, GuestPointerMath, GuestPointerOptions } from './guest-pointer.helper';

/** The quiet gap, in the fake clock's ms, that the fake guest treats as one frame. */
const FRAME_MS = 16;

interface Send {
  at: number;
  dx: number;
  dy: number;
}

interface ButtonEvent {
  at: number;
  pressed: boolean;
  /** Where the guest's cursor was when it happened. */
  cursor: GuestPoint;
}

interface FakeGuest {
  ci: DosCI;
  sends: Send[];
  buttons: ButtonEvent[];
  position(): GuestPoint;
  resize(width: number, height: number): void;
  /** Make the next calls to sendMouseRelativeMotion throw, as an exited emulator does. */
  failMotion(fail: boolean): void;
}

/**
 * A stand-in for Windows 3.1 behind DOSBox, written from the measurements and independently of
 * the code under test: per axis 1 px per unit up to 2 units and 2 px per unit beyond, a clip to the
 * frame, a wrap of a positive sum at 256, and, the part that matters, sends that arrive within
 * one frame of each other are SUMMED before the gain and the wrap are applied.
 */
function fakeGuest(start: GuestPoint = { x: 320, y: 240 }): FakeGuest {
  let frame: GuestFrame = { width: 640, height: 480 };
  let position = { ...start };
  let groupBase = { ...start };
  let groupUnits = { x: 0, y: 0 };
  let lastSendAt = Number.NEGATIVE_INFINITY;
  let failing = false;
  const sends: Send[] = [];
  const buttons: ButtonEvent[] = [];

  const gain = (units: number) => (Math.abs(units) <= 2 ? units : units * 2);
  const wrap = (units: number) => (units >= 256 ? units % 256 : units);
  const clip = (value: number, size: number) => Math.min(Math.max(value, 0), size - 1);

  const ci = {
    width: () => frame.width,
    height: () => frame.height,
    sendMouseRelativeMotion: (dx: number, dy: number) => {
      if (failing) throw new Error('emulator exited');
      const at = Date.now();
      sends.push({ at, dx, dy });
      if (at - lastSendAt >= FRAME_MS) {
        groupBase = { ...position };
        groupUnits = { x: 0, y: 0 };
      }
      lastSendAt = at;
      groupUnits = { x: groupUnits.x + dx, y: groupUnits.y + dy };
      position = {
        x: clip(groupBase.x + gain(wrap(groupUnits.x)), frame.width),
        y: clip(groupBase.y + gain(wrap(groupUnits.y)), frame.height),
      };
    },
    sendMouseButton: (_button: number, pressed: boolean) => {
      buttons.push({ at: Date.now(), pressed, cursor: { ...position } });
    },
  } as unknown as DosCI;

  return {
    ci,
    sends,
    buttons,
    position: () => ({ ...position }),
    resize: (width, height) => { frame = { width, height }; },
    failMotion: fail => { failing = fail; },
  };
}

const newPointer = (guest: FakeGuest, options: Partial<GuestPointerOptions> = {}) =>
  new GuestPointer(guest.ci, { now: () => Date.now(), ...options });

/** fakeAsync without its default of draining the timers left at the end: a leftover timer is a leak. */
const strict = (body: () => void) => fakeAsync(body, { flush: false });

const distance = (a: GuestPoint, b: GuestPoint) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/** A small seeded generator, so the grids below are the same on every run. */
const seeded = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

describe('GuestPointerMath', () => {

  describe('applied', () => {

    it('is one pixel per unit up to two units, and two pixels per unit beyond', () => {
      expect([0, 1, 2].map(GuestPointerMath.applied)).toEqual([0, 1, 2]);
      expect([3, 4, 5, 90].map(GuestPointerMath.applied)).toEqual([6, 8, 10, 180]);
    });

    it('treats a negative send the same way', () => {
      expect([-1, -2, -3, -100].map(GuestPointerMath.applied)).toEqual([-1, -2, -6, -200]);
    });
  });

  describe('isSendable', () => {

    it('refuses what poisons or wraps the guest: NaN, infinity, fractions and 256 or more', () => {
      expect(GuestPointerMath.isSendable(NaN, 0)).toBeFalse();
      expect(GuestPointerMath.isSendable(0, Infinity)).toBeFalse();
      expect(GuestPointerMath.isSendable(1.5, 0)).toBeFalse();
      expect(GuestPointerMath.isSendable(256, 0)).toBeFalse();
      expect(GuestPointerMath.isSendable(0, -300)).toBeFalse();
    });

    it('accepts whole numbers in range, the homing send included', () => {
      expect(GuestPointerMath.isSendable(0, 0)).toBeTrue();
      expect(GuestPointerMath.isSendable(-200, -200)).toBeTrue();
      expect(GuestPointerMath.isSendable(255, -255)).toBeTrue();
    });
  });

  describe('unitsFor', () => {

    it('sends one unit per pixel up to two pixels', () => {
      expect(GuestPointerMath.unitsFor(1)).toBe(1);
      expect(GuestPointerMath.unitsFor(2)).toBe(2);
      expect(GuestPointerMath.unitsFor(-2)).toBe(-2);
    });

    it('has no exact answer for 3 px: 2 units move 2 and 3 units already move 6', () => {
      expect(GuestPointerMath.unitsFor(3)).toBe(2);
      expect(GuestPointerMath.applied(GuestPointerMath.unitsFor(3))).toBe(2);
    });

    it('lands within a pixel of any distance one chunk can cover, in either direction, except 4 px', () => {
      for (let delta = -180; delta <= 180; delta++) {
        const units = GuestPointerMath.unitsFor(delta);
        const reached = GuestPointerMath.applied(units);
        // 4 px sits between what 2 units (2 px) and 3 units (6 px) can move: two sends.
        const allowed = Math.abs(delta) === 4 ? 2 : 1;
        expect(Math.abs(delta - reached)).withContext(`delta ${delta}`).toBeLessThanOrEqual(allowed);
        expect(Math.abs(units)).toBeLessThanOrEqual(90);
      }
    });

    it('caps a long distance at the chunk size instead of overflowing', () => {
      expect(GuestPointerMath.unitsFor(1000)).toBe(90);
      expect(GuestPointerMath.unitsFor(-1000)).toBe(-90);
      expect(GuestPointerMath.unitsFor(1000, 50)).toBe(50);
    });

    it('never turns something that is not a number into a send', () => {
      expect(GuestPointerMath.unitsFor(NaN)).toBe(0);
      expect(GuestPointerMath.unitsFor(Infinity)).toBe(0);
      expect(GuestPointerMath.unitsFor(-Infinity)).toBe(0);
    });
  });

  describe('nextChunk', () => {
    const frame = { width: 640, height: 480 };

    it('is done when both axes are within a pixel', () => {
      expect(GuestPointerMath.nextChunk({ x: 10, y: 10 }, { x: 11, y: 9 }, frame)).toBeNull();
    });

    it('moves both axes in one send', () => {
      const chunk = GuestPointerMath.nextChunk({ x: 0, y: 0 }, { x: 100, y: 60 }, frame);
      expect(chunk).toEqual({ dx: 50, dy: 30, to: { x: 100, y: 60 } });
    });

    it('keeps the axes independent: a small error beside a big one stays small', () => {
      const chunk = GuestPointerMath.nextChunk({ x: 0, y: 0 }, { x: 2, y: 200 }, frame);
      expect(chunk).toEqual({ dx: 2, dy: 90, to: { x: 2, y: 180 } });
    });

    it('clips the predicted position to the frame, as the guest clips the cursor', () => {
      // 5 px is 3 units, which move 6: past the last column and row.
      const chunk = GuestPointerMath.nextChunk({ x: 634, y: 474 }, { x: 639, y: 479 }, frame)!;
      expect(chunk).toEqual({ dx: 3, dy: 3, to: { x: 639, y: 479 } });
    });

    it('reaches any point of the frame from any other within a pixel, and in few sends', () => {
      const rnd = seeded(5);
      for (let i = 0; i < 200; i++) {
        let at = { x: Math.floor(rnd() * 640), y: Math.floor(rnd() * 480) };
        const target = { x: Math.floor(rnd() * 640), y: Math.floor(rnd() * 480) };
        let sends = 0;
        for (let chunk = GuestPointerMath.nextChunk(at, target, frame); chunk; chunk = GuestPointerMath.nextChunk(at, target, frame)) {
          at = chunk.to;
          expect(++sends).withContext(`${JSON.stringify(target)}`).toBeLessThanOrEqual(5);
        }
        expect(distance(at, target)).toBeLessThanOrEqual(1);
      }
    });
  });
});

describe('GuestPointer', () => {

  describe('moving', () => {

    it('parks the cursor in the corner first, because that is the one place the model knows', strict(() => {
      const guest = fakeGuest({ x: 400, y: 300 });
      const pointer = newPointer(guest);

      void pointer.moveTo({ x: 100, y: 100 });
      tick(500);

      expect(guest.sends.slice(0, 4).map(s => [s.dx, s.dy])).toEqual([[-200, -200], [-200, -200], [-200, -200], [-200, -200]]);
      expect(distance(guest.position(), { x: 100, y: 100 })).toBeLessThanOrEqual(1);
      pointer.dispose();
    }));

    it('lands on the target and the model agrees with the guest', strict(() => {
      const guest = fakeGuest();
      const pointer = newPointer(guest);

      void pointer.moveTo({ x: 523, y: 77 });
      tick(500);

      expect(distance(guest.position(), { x: 523, y: 77 })).toBeLessThanOrEqual(1);
      expect(pointer.position).toEqual(guest.position());
      pointer.dispose();
    }));

    it('never sends twice within the spacing, homing included', strict(() => {
      const guest = fakeGuest();
      const pointer = newPointer(guest, { spacingMs: 24 });

      void pointer.moveTo({ x: 600, y: 450 });
      tick(300);
      void pointer.moveTo({ x: 10, y: 10 });
      tick(300);
      void pointer.moveTo({ x: 300, y: 200 });
      void pointer.click();
      tick(500);

      const gaps = guest.sends.slice(1).map((send, i) => send.at - guest.sends[i].at);
      expect(gaps.length).toBeGreaterThan(8);
      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(24);
      pointer.dispose();
    }));

    it('keeps every chunk under the size that wraps, however far it has to go', strict(() => {
      const guest = fakeGuest();
      const pointer = newPointer(guest);

      void pointer.moveTo({ x: 639, y: 479 });
      tick(1000);

      const moves = guest.sends.filter(s => s.dx > 0 || s.dy > 0);
      expect(moves.length).toBeGreaterThanOrEqual(3);
      for (const send of moves) {
        expect(Math.abs(send.dx)).toBeLessThanOrEqual(90);
        expect(Math.abs(send.dy)).toBeLessThanOrEqual(90);
      }
      expect(distance(guest.position(), { x: 639, y: 479 })).toBeLessThanOrEqual(1);
      pointer.dispose();
    }));

    it('stays within a pixel of 60 random targets in a row on a guest that follows the measured rules', strict(() => {
      const guest = fakeGuest();
      const pointer = newPointer(guest);
      const rnd = seeded(11);

      for (let i = 0; i < 60; i++) {
        const target = { x: Math.floor(rnd() * 640), y: Math.floor(rnd() * 480) };
        void pointer.moveTo(target);
        tick(400);
        expect(distance(guest.position(), target)).withContext(`target ${i}`).toBeLessThanOrEqual(1);
      }
      pointer.dispose();
    }));

    it('only heads for the latest target when several arrive before it has moved', strict(() => {
      const guest = fakeGuest();
      const pointer = newPointer(guest);

      for (let i = 0; i < 20; i++) void pointer.moveTo({ x: 30 * i, y: 20 * i });
      void pointer.moveTo({ x: 250, y: 400 });
      tick(500);

      expect(distance(guest.position(), { x: 250, y: 400 })).toBeLessThanOrEqual(1);
      // 4 to home and at most 3 to get there: nothing was spent on the 20 targets that were replaced.
      expect(guest.sends.length).toBeLessThanOrEqual(7);
      pointer.dispose();
    }));

    it('retargets a move that is already under way', strict(() => {
      const guest = fakeGuest();
      const pointer = newPointer(guest);

      void pointer.moveTo({ x: 600, y: 400 });
      tick(100);
      void pointer.moveTo({ x: 40, y: 30 });
      tick(500);

      expect(distance(guest.position(), { x: 40, y: 30 })).toBeLessThanOrEqual(1);
      pointer.dispose();
    }));

    it('refuses a target that is not a number and sends nothing for it', strict(() => {
      const guest = fakeGuest();
      const pointer = newPointer(guest);

      void pointer.moveTo({ x: NaN, y: 10 });
      void pointer.moveTo({ x: 10, y: Infinity });
      tick(500);

      expect(guest.sends).toEqual([]);
      expect(pointer.stats.refused).toBe(2);
      pointer.dispose();
    }));

    it('would lose the cursor if the sends were closer than a frame, which is what the spacing is for', strict(() => {
      // The control for the specs above: the fake guest really does punish a short spacing.
      const guest = fakeGuest();
      const pointer = newPointer(guest, { spacingMs: 2 });

      void pointer.moveTo({ x: 639, y: 479 });
      tick(500);

      expect(distance(guest.position(), { x: 639, y: 479 })).toBeGreaterThan(3);
      pointer.dispose();
    }));
  });

  describe('clicking', () => {

    it('presses, holds and releases, in that order, after the cursor has settled', strict(() => {
      const guest = fakeGuest();
      const pointer = newPointer(guest);

      void pointer.moveTo({ x: 200, y: 150 });
      void pointer.click();
      tick(1000);

      expect(guest.buttons.map(b => b.pressed)).toEqual([true, false]);
      expect(guest.buttons[1].at - guest.buttons[0].at).toBeGreaterThanOrEqual(50);
      expect(distance(guest.buttons[0].cursor, { x: 200, y: 150 })).toBeLessThanOrEqual(1);
      const lastSend = guest.sends[guest.sends.length - 1];
      expect(guest.buttons[0].at - lastSend.at).toBeGreaterThanOrEqual(24);
      expect(pointer.buttonDown).toBeFalse();
      pointer.dispose();
    }));

    it('clicks at once when the cursor is already there, which is what a pre-aimed tap does', strict(() => {
      const guest = fakeGuest();
      const pointer = newPointer(guest);

      void pointer.moveTo({ x: 200, y: 150 });
      tick(300);
      const releasedAt = Date.now();
      void pointer.click();
      tick(0);

      expect(guest.buttons.length).toBe(1);
      expect(guest.buttons[0].at - releasedAt).toBeLessThan(5);
      tick(100);
      pointer.dispose();
    }));

    it('never presses a button that is already down', strict(() => {
      const guest = fakeGuest();
      const pointer = newPointer(guest);

      void pointer.press();
      void pointer.click();
      tick(500);

      expect(guest.buttons.map(b => b.pressed)).toEqual([true]);
      void pointer.release();
      tick(100);
      expect(guest.buttons.map(b => b.pressed)).toEqual([true, false]);
      pointer.dispose();
    }));
  });

  describe('dragging', () => {

    it('presses where the finger landed, follows it, and releases where it lifted', strict(() => {
      const guest = fakeGuest();
      const pointer = newPointer(guest);

      void pointer.moveTo({ x: 100, y: 100 });
      void pointer.press();
      for (let i = 1; i <= 10; i++) void pointer.moveTo({ x: 100 + i * 30, y: 100 + i * 10 });
      void pointer.release();
      tick(1000);

      expect(guest.buttons.map(b => b.pressed)).toEqual([true, false]);
      expect(distance(guest.buttons[0].cursor, { x: 100, y: 100 })).toBeLessThanOrEqual(1);
      expect(distance(guest.buttons[1].cursor, { x: 400, y: 200 })).toBeLessThanOrEqual(1);
      pointer.dispose();
    }));

    it('holds the button across the whole drag, however long the finger takes', strict(() => {
      const guest = fakeGuest();
      const pointer = newPointer(guest);

      void pointer.moveTo({ x: 100, y: 100 });
      void pointer.press();
      tick(300);
      void pointer.moveTo({ x: 300, y: 300 });
      tick(5000);

      expect(guest.buttons.map(b => b.pressed)).toEqual([true]);
      expect(pointer.buttonDown).toBeTrue();
      void pointer.release();
      tick(300);
      pointer.dispose();
    }));
  });

  describe('letting go', () => {

    it('abort() releases a button that is down in the same tick', strict(() => {
      const guest = fakeGuest();
      const pointer = newPointer(guest);
      void pointer.moveTo({ x: 100, y: 100 });
      void pointer.press();
      tick(500);
      expect(pointer.buttonDown).toBeTrue();

      pointer.abort('test');

      expect(guest.buttons.map(b => b.pressed)).toEqual([true, false]);
      expect(pointer.buttonDown).toBeFalse();
      pointer.dispose();
    }));

    it('abort() in the middle of a click releases once, and the click does not release again later', strict(() => {
      const guest = fakeGuest();
      const pointer = newPointer(guest);
      void pointer.click();
      tick(10);
      expect(pointer.buttonDown).toBeTrue();

      pointer.abort('test');
      tick(500);

      expect(guest.buttons.map(b => b.pressed)).toEqual([true, false]);
      pointer.dispose();
    }));

    it('abort() drops what was queued and stops what was moving', strict(() => {
      const guest = fakeGuest();
      const pointer = newPointer(guest);
      void pointer.moveTo({ x: 600, y: 400 });
      void pointer.click();
      tick(60);
      const sent = guest.sends.length;

      pointer.abort('test');
      tick(1000);

      expect(guest.sends.length).toBe(sent);
      expect(guest.buttons).toEqual([]);
      expect(pointer.pending).toBe(0);
      pointer.dispose();
    }));

    it('a click that was aborted does not release the press of the one after it', strict(() => {
      const guest = fakeGuest();
      const pointer = newPointer(guest);
      void pointer.click();
      tick(10);
      pointer.abort('first');
      void pointer.click();

      // The second click starts when the first one's hold has run out, which must leave the new
      // press alone: both ends of the stale hold are at about 50 ms.
      tick(60);
      expect(pointer.buttonDown).toBeTrue();
      tick(100);
      expect(guest.buttons.map(b => b.pressed)).toEqual([true, false, true, false]);
      pointer.dispose();
    }));

    it('dispose() releases the button and leaves nothing scheduled', strict(() => {
      const guest = fakeGuest();
      const pointer = newPointer(guest);
      void pointer.press();
      tick(100);

      pointer.dispose();

      expect(guest.buttons.map(b => b.pressed)).toEqual([true, false]);
      void pointer.moveTo({ x: 5, y: 5 });
      tick(1000);
      expect(guest.sends).toEqual([]);
    }));

    it('survives an emulator that throws: the button is released and the next move still works', strict(() => {
      const guest = fakeGuest();
      const pointer = newPointer(guest);
      void pointer.moveTo({ x: 100, y: 100 });
      void pointer.press();
      tick(300);
      guest.failMotion(true);

      void pointer.moveTo({ x: 400, y: 300 });
      tick(300);

      expect(pointer.buttonDown).toBeFalse();
      expect(guest.buttons.map(b => b.pressed)).toEqual([true, false]);

      guest.failMotion(false);
      void pointer.moveTo({ x: 50, y: 60 });
      tick(500);
      expect(distance(guest.position(), { x: 50, y: 60 })).toBeLessThanOrEqual(1);
      pointer.dispose();
    }));
  });

  describe('knowing where the cursor is', () => {

    it('homes again when the frame changes size, because the corner is another corner', strict(() => {
      const guest = fakeGuest();
      const pointer = newPointer(guest);
      void pointer.moveTo({ x: 100, y: 100 });
      tick(300);
      const before = guest.sends.length;

      guest.resize(800, 600);
      void pointer.moveTo({ x: 700, y: 500 });
      tick(500);

      expect(guest.sends.slice(before, before + 4).map(s => [s.dx, s.dy])).toEqual([[-200, -200], [-200, -200], [-200, -200], [-200, -200]]);
      expect(distance(guest.position(), { x: 700, y: 500 })).toBeLessThanOrEqual(1);
      pointer.dispose();
    }));

    it('homes again after invalidate(), which is what a real mouse moving the cursor calls for', strict(() => {
      const guest = fakeGuest();
      const pointer = newPointer(guest);
      void pointer.moveTo({ x: 100, y: 100 });
      tick(300);
      expect(pointer.stats.homes).toBe(1);

      pointer.invalidate('real mouse');
      expect(pointer.position).toBeNull();
      void pointer.moveTo({ x: 300, y: 300 });
      tick(500);

      expect(pointer.stats.homes).toBe(2);
      expect(distance(guest.position(), { x: 300, y: 300 })).toBeLessThanOrEqual(1);
      pointer.dispose();
    }));

    it('does not home again for a frame of the same size', strict(() => {
      const guest = fakeGuest();
      const pointer = newPointer(guest);
      for (let i = 0; i < 5; i++) {
        void pointer.moveTo({ x: 50 * i, y: 40 * i });
        tick(300);
      }
      expect(pointer.stats.homes).toBe(1);
      pointer.dispose();
    }));

    it('homes at once, while nobody is touching, when asked to prime', strict(() => {
      const guest = fakeGuest({ x: 500, y: 400 });
      const pointer = newPointer(guest);

      void pointer.prime();
      tick(300);

      expect(guest.position()).toEqual({ x: 0, y: 0 });
      expect(pointer.position).toEqual({ x: 0, y: 0 });
      void pointer.prime();
      tick(300);
      expect(pointer.stats.homes).toBe(1);
      pointer.dispose();
    }));
  });

  describe('re-homing while idle', () => {

    /** `count` separate moves, 150 ms apart: close enough together that the idle timer never gets to run. */
    const moveAround = (pointer: GuestPointer, count: number) => {
      const rnd = seeded(3);
      let last = { x: 0, y: 0 };
      for (let i = 0; i < count; i++) {
        last = { x: 20 + Math.floor(rnd() * 600), y: 20 + Math.floor(rnd() * 440) };
        void pointer.moveTo(last);
        tick(150);
      }
      return last;
    };

    it('does so after more than 12 moves and a quiet second, and puts the cursor back where it was', strict(() => {
      const guest = fakeGuest();
      const pointer = newPointer(guest);
      const last = moveAround(pointer, 13);
      expect(pointer.stats.homes).toBe(1);
      const before = guest.sends.length;

      tick(2000);

      expect(pointer.stats.homes).toBe(2);
      expect(guest.sends.slice(before, before + 4).map(s => [s.dx, s.dy])).toEqual([[-200, -200], [-200, -200], [-200, -200], [-200, -200]]);
      expect(distance(guest.position(), last)).toBeLessThanOrEqual(1);
      pointer.dispose();
    }));

    it('leaves a cursor alone that has moved only 12 times', strict(() => {
      const guest = fakeGuest();
      const pointer = newPointer(guest);
      moveAround(pointer, 12);

      tick(5000);

      expect(pointer.stats.homes).toBe(1);
      pointer.dispose();
    }));

    it('waits for the full quiet time: not 800 ms after the last move', strict(() => {
      const guest = fakeGuest();
      const pointer = newPointer(guest);
      moveAround(pointer, 13);
      // moveAround ends 150 ms after the last move was asked for.
      tick(600);
      expect(pointer.stats.homes).toBe(1);

      tick(400);
      expect(pointer.stats.homes).toBe(2);
      pointer.dispose();
    }));

    it('never while a button is down', strict(() => {
      const guest = fakeGuest();
      const pointer = newPointer(guest);
      moveAround(pointer, 13);
      void pointer.press();

      tick(10000);

      expect(pointer.stats.homes).toBe(1);
      void pointer.release();
      tick(100);
      pointer.dispose();
    }));

    it('never while a finger is down, button or not: an aim-mode finger is quiet to the engine', strict(() => {
      const guest = fakeGuest();
      const pointer = newPointer(guest);
      moveAround(pointer, 13);
      pointer.setFingerDown(true);

      tick(10000);
      expect(pointer.stats.homes).toBe(1);

      // And the quiet time starts at the lift, not at the last send before a long hold.
      pointer.setFingerDown(false);
      tick(600);
      expect(pointer.stats.homes).toBe(1);
      tick(400);
      expect(pointer.stats.homes).toBe(2);
      tick(500);
      pointer.dispose();
    }));

    it('hands a finger that lands during the trip back the new target, not the old one', strict(() => {
      const guest = fakeGuest();
      const pointer = newPointer(guest);
      moveAround(pointer, 13);
      tick(900);
      tick(50);
      // The corner trip has started.
      expect(pointer.stats.homes).toBeGreaterThanOrEqual(1);

      void pointer.moveTo({ x: 77, y: 66 });
      tick(1000);

      expect(distance(guest.position(), { x: 77, y: 66 })).toBeLessThanOrEqual(1);
      pointer.dispose();
    }));

    it('also goes home on its own after the send budget, mid-use', strict(() => {
      const guest = fakeGuest();
      const pointer = newPointer(guest, { forcedRehomeSends: 20 });
      const rnd = seeded(9);

      for (let i = 0; i < 12; i++) {
        void pointer.moveTo({ x: Math.floor(rnd() * 640), y: Math.floor(rnd() * 480) });
        tick(250);
      }

      expect(pointer.stats.homes).toBeGreaterThanOrEqual(2);
      pointer.dispose();
    }));

    it('but not with the button down: a drag never sees the cursor fly to the corner, the next move pays the budget', strict(() => {
      const guest = fakeGuest();
      const pointer = newPointer(guest, { forcedRehomeSends: 3 });
      void pointer.moveTo({ x: 100, y: 100 });
      void pointer.press();
      tick(200);
      const homed = pointer.stats.homes;

      // Separate moves, so each one sends: well over the budget of 3 while the button is held.
      for (let i = 1; i <= 6; i++) {
        void pointer.moveTo({ x: 100 + i * 80, y: 100 + i * 50 });
        tick(250);
      }

      expect(pointer.stats.homes).toBe(homed);
      expect(guest.sends.filter(s => s.dx === -200).length).toBe(4);
      expect(pointer.buttonDown).toBeTrue();
      void pointer.release();
      tick(200);
      void pointer.moveTo({ x: 50, y: 50 });
      tick(500);
      expect(pointer.stats.homes).toBe(homed + 1);
      pointer.dispose();
    }));

    it('lets go of a press whose position is lost, instead of homing with the button down', strict(() => {
      const guest = fakeGuest();
      const pointer = newPointer(guest);
      void pointer.moveTo({ x: 100, y: 100 });
      void pointer.press();
      tick(200);
      expect(guest.buttons.map(b => b.pressed)).toEqual([true]);
      const sent = guest.sends.length;

      pointer.invalidate('real mouse');
      void pointer.moveTo({ x: 300, y: 300 });
      tick(500);

      expect(guest.buttons.map(b => b.pressed)).toEqual([true, false]);
      expect(pointer.buttonDown).toBeFalse();
      expect(guest.sends.length).toBe(sent);
      pointer.dispose();
    }));

    it('does the same when the frame changes size under a held button', strict(() => {
      const guest = fakeGuest();
      const pointer = newPointer(guest);
      void pointer.moveTo({ x: 100, y: 100 });
      void pointer.press();
      tick(200);

      guest.resize(800, 600);
      void pointer.moveTo({ x: 300, y: 300 });
      tick(500);

      expect(guest.buttons.map(b => b.pressed)).toEqual([true, false]);
      expect(guest.sends.filter(s => s.dx === -200).length).toBe(4);
      pointer.dispose();
    }));
  });
});
