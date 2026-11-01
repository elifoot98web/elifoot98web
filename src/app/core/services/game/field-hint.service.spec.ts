import { NgZone } from '@angular/core';
import { fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { FIELD_HINT } from '../../models/constants';
import { FieldHint } from '../../helpers/field-hint.helper';
import { FrameName, loadFrame } from '../../helpers/field-hint.fixtures';
import { GuestPoint } from '../../helpers/guest-pointer.helper';
import { DosCI } from '../../typings/jsdos';
import { silentDiagnostics } from '../shared/diagnostics.testing';
import { FieldHintService } from './field-hint.service';
import { TouchInputService } from './touch-input.service';

type Frame = Awaited<ReturnType<typeof loadFrame>>;

const strict = (body: () => void) => fakeAsync(body, { flush: false });

describe('FieldHintService', () => {
  const frames = {} as Record<FrameName, Frame>;

  beforeAll(async () => {
    for (const name of ['ibeamYellow640', 'arrowButton640', 'caretOn640', 'caretOff640'] as FrameName[]) {
      frames[name] = await loadFrame(name);
    }
  });

  interface Rig {
    service: FieldHintService;
    clicks: Subject<GuestPoint>;
    hints: FieldHint[];
    /** The frame listeners js-dos was given. */
    listeners: Array<() => void>;
    screenshots: jasmine.Spy;
    /** What the next screenshots return, in order. */
    show: (...next: Frame[]) => void;
    dosCI: DosCI;
  }

  const build = (): Rig => {
    const clicks = new Subject<GuestPoint>();
    const listeners: Array<() => void> = [];
    let queue: Frame[] = [];
    const screenshots = jasmine.createSpy('screenshot').and.callFake(() => {
      const next = queue.shift();
      return next ? Promise.resolve(next) : Promise.reject(new Error('no frame'));
    });
    const dosCI = {
      events: () => ({ onFrame: (consumer: () => void) => listeners.push(consumer) }),
      screenshot: screenshots,
    } as unknown as DosCI;
    const service = new FieldHintService(
      new NgZone({ enableLongStackTrace: false }),
      { clicks$: clicks.asObservable() } as unknown as TouchInputService,
      silentDiagnostics(),
    );
    service.clock = () => Date.now();
    const hints: FieldHint[] = [];
    service.hint$.subscribe(hint => hints.push(hint));
    return { service, clicks, hints, listeners, screenshots, dosCI, show: (...next) => { queue = next; } };
  };

  /** A frame event, 543 ms after the last, which is the blink of a caret. */
  const blinkFrames = (r: Rig, count: number) => {
    for (let i = 0; i < count; i++) {
      tick(543);
      r.listeners.forEach(listener => listener());
      flushMicrotasks();
    }
  };

  describe('the I-beam under a tap', () => {

    it('says field a moment after a tap that landed on an I-beam, and none again when the tap is stale', strict(() => {
      const r = build();
      r.service.start(r.dosCI);
      r.show(frames.ibeamYellow640);
      r.clicks.next({ x: 254, y: 183 });
      tick(FIELD_HINT.IBEAM_LOOK_DELAY_MS - 1);
      expect(r.hints).toEqual(['none']);
      tick(1);
      flushMicrotasks();
      expect(r.hints).toEqual(['none', 'field']);

      tick(FIELD_HINT.IBEAM_TTL_MS + 2);
      expect(r.hints).toEqual(['none', 'field', 'none']);
      r.service.stop();
    }));

    it('stays none after a tap that landed on an arrow', strict(() => {
      const r = build();
      r.service.start(r.dosCI);
      r.show(frames.arrowButton640);
      r.clicks.next({ x: 320, y: 357 });
      tick(FIELD_HINT.IBEAM_LOOK_DELAY_MS);
      flushMicrotasks();
      expect(r.hints).toEqual(['none']);
      r.service.stop();
    }));

    it('looks only at the last of two quick taps', strict(() => {
      const r = build();
      r.service.start(r.dosCI);
      r.show(frames.ibeamYellow640);
      r.clicks.next({ x: 10, y: 10 });
      tick(50);
      r.clicks.next({ x: 254, y: 183 });
      tick(FIELD_HINT.IBEAM_LOOK_DELAY_MS);
      flushMicrotasks();
      expect(r.screenshots).toHaveBeenCalledTimes(1);
      expect(r.hints).toEqual(['none', 'field']);
      tick(FIELD_HINT.IBEAM_TTL_MS + 2);
      r.service.stop();
    }));

    it('survives a screenshot that fails', strict(() => {
      const r = build();
      r.service.start(r.dosCI);
      r.show();
      r.clicks.next({ x: 254, y: 183 });
      tick(FIELD_HINT.IBEAM_LOOK_DELAY_MS);
      flushMicrotasks();
      expect(r.hints).toEqual(['none']);
      r.service.stop();
    }));
  });

  describe('the caret', () => {

    it('says field once the frames blink and the pair differs by a bar, and none when they stop', strict(() => {
      const r = build();
      r.service.start(r.dosCI);
      r.show(frames.caretOn640, frames.caretOff640);
      blinkFrames(r, 4);
      expect(r.hints).toEqual(['none', 'field']);
      tick(FIELD_HINT.GONE_AFTER_MS + 1);
      expect(r.hints).toEqual(['none', 'field', 'none']);
      r.service.stop();
    }));

    it('keeps field while either signal holds', strict(() => {
      const r = build();
      r.service.start(r.dosCI);
      r.show(frames.caretOn640, frames.caretOff640, frames.arrowButton640);
      blinkFrames(r, 4);
      // A tap on an arrow does not take away what the caret says.
      r.clicks.next({ x: 320, y: 357 });
      tick(FIELD_HINT.IBEAM_LOOK_DELAY_MS);
      flushMicrotasks();
      expect(r.hints).toEqual(['none', 'field']);
      r.service.stop();
    }));
  });

  describe('starting and stopping', () => {

    it('registers one frame listener per emulator, however often it is switched on and off', strict(() => {
      const r = build();
      r.service.start(r.dosCI);
      r.service.stop();
      r.service.start(r.dosCI);
      r.service.start(r.dosCI);
      r.service.stop();
      r.service.start(r.dosCI);
      expect(r.listeners.length).toBe(1);
      r.service.stop();
    }));

    it('does nothing with the frames of an emulator it was told to stop watching', strict(() => {
      const r = build();
      r.service.start(r.dosCI);
      r.service.stop();
      r.show(frames.caretOn640, frames.caretOff640);
      blinkFrames(r, 6);
      expect(r.screenshots).not.toHaveBeenCalled();
      expect(r.hints).toEqual(['none']);
    }));

    it('stops listening to taps and leaves nothing scheduled', strict(() => {
      const r = build();
      r.service.start(r.dosCI);
      r.show(frames.ibeamYellow640);
      r.clicks.next({ x: 254, y: 183 });
      r.service.stop();
      r.clicks.next({ x: 254, y: 183 });
      tick(FIELD_HINT.IBEAM_LOOK_DELAY_MS * 2);
      flushMicrotasks();
      expect(r.screenshots).not.toHaveBeenCalled();
      expect(r.hints).toEqual(['none']);
      expect(r.service.running).toBeFalse();
    }));

    it('goes back to none when it is stopped with a field detected', strict(() => {
      const r = build();
      r.service.start(r.dosCI);
      r.show(frames.ibeamYellow640);
      r.clicks.next({ x: 254, y: 183 });
      tick(FIELD_HINT.IBEAM_LOOK_DELAY_MS);
      flushMicrotasks();
      expect(r.service.hint).toBe('field');
      r.service.stop();
      expect(r.service.hint).toBe('none');
    }));
  });
});
