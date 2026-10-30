import { NgZone } from '@angular/core';
import { fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { AUDIO_HEALTH } from '../../models/constants';
import { AudioStatus } from '../../helpers/audio-health.helper';
import { logRecorder, silentDiagnostics } from '../shared/diagnostics.testing';
import { AudioContextLike, AudioHealthService, AudioSessionLike, VolumeTargetLike } from './audio-health.service';

const GRACE = AUDIO_HEALTH.BLOCKED_GRACE_MS;

/** js-dos's AudioContext as the service sees it: a state, a resume() the spec decides the fate of, and statechange. */
class FakeContext implements AudioContextLike {
  state = 'running';
  resumes = 0;
  /** What resume() does: wake the context ('wake'), leave it asleep and never answer ('never', WebKit without a gesture), or refuse. */
  mode: 'wake' | 'never' | 'refuse' = 'wake';
  private readonly listeners = new Set<() => void>();

  resume(): Promise<void> {
    this.resumes++;
    if (this.mode === 'never') return new Promise<void>(() => undefined);
    if (this.mode === 'refuse') return Promise.reject(new DOMException('no gesture', 'NotAllowedError'));
    this.setState('running');
    return Promise.resolve();
  }
  addEventListener(_type: 'statechange', listener: () => void): void { this.listeners.add(listener); }
  removeEventListener(_type: 'statechange', listener: () => void): void { this.listeners.delete(listener); }
  get listening(): number { return this.listeners.size; }
  /** The browser changes the state by itself (a call, a lock) and says so. */
  setState(state: string): void {
    this.state = state;
    for (const listener of [...this.listeners]) listener();
  }
}

class TestAudioHealthService extends AudioHealthService {
  fake: FakeContext | null = new FakeContext();
  isVisible = true;
  session: AudioSessionLike | undefined = undefined;
  target: VolumeTargetLike | undefined = undefined;
  protected override node(): { context: unknown } | null { return this.fake ? { context: this.fake } : null; }
  protected override visible(): boolean { return this.isVisible; }
  protected override audioSession(): AudioSessionLike | undefined { return this.session; }
  protected override jsdos(): VolumeTargetLike | undefined { return this.target; }
}

function rig(diagnostics: unknown = silentDiagnostics()) {
  const service = new TestAudioHealthService(new NgZone({ enableLongStackTrace: false }), diagnostics as never);
  const seen: AudioStatus[] = [];
  service.status$.subscribe(status => seen.push(status));
  const hide = () => { service.isVisible = false; document.dispatchEvent(new Event('visibilitychange')); };
  const show = () => { service.isVisible = true; document.dispatchEvent(new Event('visibilitychange')); };
  const touch = () => document.dispatchEvent(new Event('pointerup'));
  return { service, seen, hide, show, touch, context: service.fake! };
}

/** fakeAsync that fails on a timer left behind: the grace timer must not outlive stop(). */
const strict = (body: () => void) => fakeAsync(body, { flush: false });

describe('AudioHealthService', () => {
  describe('a context that runs', () => {
    it('says nothing and listens for nothing but the page', strict(() => {
      const r = rig();
      const adds = spyOn(document, 'addEventListener').and.callThrough();

      r.service.start();

      expect(r.service.status).toEqual({ state: 'running', blocked: false });
      expect(r.context.resumes).toBe(0);
      expect(adds.calls.allArgs().some(([type]) => type === 'pointerup')).toBeFalse(); // no gesture listener while there is nothing to wake
      r.service.stop();
    }));
  });

  describe('a context asleep when the game starts', () => {
    it('asks it to resume, and the chip appears only once the page has had its grace', strict(() => {
      const r = rig();
      r.context.state = 'suspended';
      r.context.mode = 'never'; // Safari, no gesture yet

      r.service.start();
      expect(r.context.resumes).toBe(1);
      expect(r.service.status).toEqual({ state: 'suspended', blocked: false });

      tick(GRACE - 1);
      expect(r.service.status.blocked).toBeFalse();
      tick(1);
      expect(r.service.status).toEqual({ state: 'suspended', blocked: true });
      r.service.stop();
    }));

    it('never shows the chip for a context that wakes at once', strict(() => {
      const r = rig();
      r.context.state = 'suspended';

      r.service.start();
      flushMicrotasks();
      tick(GRACE * 3);

      expect(r.service.status).toEqual({ state: 'running', blocked: false });
      expect(r.seen.some(status => status.blocked)).toBeFalse();
      r.service.stop();
    }));
  });

  describe('after a call, a lock or a Bluetooth change', () => {
    it('resumes when the page comes back visible', strict(() => {
      const r = rig();
      r.service.start();
      r.hide();
      r.context.setState('interrupted'); // WebKit puts it to sleep

      r.show();
      flushMicrotasks();

      expect(r.context.resumes).toBe(1);
      expect(r.service.status).toEqual({ state: 'running', blocked: false });
      r.service.stop();
    }));

    it('does not resume a hidden page, and does not count its hours towards the chip', strict(() => {
      const r = rig();
      r.service.start();

      r.hide();
      r.context.setState('suspended');
      tick(GRACE * 10);

      expect(r.context.resumes).toBe(0);
      expect(r.service.status.blocked).toBeFalse();
      r.service.stop();
    }));

    it('resumes on the first tap when the page\'s own attempt was refused, and the chip goes', strict(() => {
      const r = rig();
      r.context.mode = 'never';
      r.service.start();
      r.hide();
      r.context.setState('interrupted');
      r.show();
      tick(GRACE);
      expect(r.service.status.blocked).toBeTrue();

      r.context.mode = 'wake'; // the gesture is what WebKit wanted
      r.touch();
      flushMicrotasks();

      expect(r.service.status).toEqual({ state: 'running', blocked: false });
      r.service.stop();
    }));

    it('resumes from the chip, inside the tap', strict(() => {
      const r = rig();
      r.context.state = 'suspended';
      r.context.mode = 'never';
      r.service.start();
      tick(GRACE);
      expect(r.service.status.blocked).toBeTrue();
      const before = r.context.resumes;

      r.context.mode = 'wake';
      r.service.activate();
      flushMicrotasks();

      expect(r.context.resumes).toBe(before + 1);
      expect(r.service.status).toEqual({ state: 'running', blocked: false });
      r.service.stop();
    }));

    it('stays blocked, and says so, while the browser refuses the resume', strict(() => {
      const r = rig();
      r.context.state = 'suspended';
      r.context.mode = 'refuse';
      r.service.start();
      flushMicrotasks();
      tick(GRACE);

      r.touch();
      flushMicrotasks();

      expect(r.service.status).toEqual({ state: 'suspended', blocked: true });
      r.service.stop();
    }));

    it('follows the context\'s own state changes, and does not answer them with a resume of its own', strict(() => {
      const r = rig();
      r.service.start();

      r.context.setState('suspended');
      expect(r.service.status).toEqual({ state: 'suspended', blocked: false });
      expect(r.context.resumes).toBe(0); // a state change is not a gesture, and a resume answered by another is a loop

      tick(GRACE);
      expect(r.service.status.blocked).toBeTrue();
      r.context.setState('running');
      expect(r.service.status).toEqual({ state: 'running', blocked: false });
      r.service.stop();
    }));
  });

  describe('listeners', () => {
    it('listens for taps only while the context is asleep on a visible page', strict(() => {
      const r = rig();
      const adds = spyOn(document, 'addEventListener').and.callThrough();
      const removes = spyOn(document, 'removeEventListener').and.callThrough();
      const taps = () => adds.calls.allArgs().filter(([type]) => type === 'pointerup').length
        - removes.calls.allArgs().filter(([type]) => type === 'pointerup').length;
      r.service.start();
      expect(taps()).toBe(0);

      r.context.setState('suspended');
      expect(taps()).toBe(1);
      r.hide();
      expect(taps()).toBe(0); // hidden: nobody is going to tap
      r.context.mode = 'never';
      r.show();
      expect(taps()).toBe(1);
      r.context.setState('running');
      expect(taps()).toBe(0);
      r.service.stop();
    }));

    it('lets go of everything on stop(): the page, the taps, the context and the grace timer', strict(() => {
      const r = rig();
      r.context.state = 'suspended';
      r.context.mode = 'never';
      r.service.start();
      expect(r.context.listening).toBe(1);

      r.service.stop();

      expect(r.context.listening).toBe(0);
      expect(r.service.status).toEqual({ state: null, blocked: false });
      const resumes = r.context.resumes;
      r.show();
      r.touch();
      r.context.setState('interrupted');
      tick(GRACE * 5);
      expect(r.context.resumes).toBe(resumes);
    }));

    it('follows a new context if js-dos ever builds another, and lets go of the old one', strict(() => {
      const r = rig();
      r.service.start();
      const first = r.context;

      r.service.fake = new FakeContext();
      r.service.fake.state = 'suspended';
      r.show();
      flushMicrotasks();

      expect(first.listening).toBe(0);
      expect(r.service.fake.listening).toBe(1);
      r.service.stop();
    }));

    it('asks on each of the events of one tap (any of them may be the one WebKit counts) but writes one line to the log', strict(() => {
      const { diagnostics, messages } = logRecorder();
      const r = rig(diagnostics);
      r.context.state = 'suspended';
      r.context.mode = 'never';
      r.service.start();
      tick(5000);
      const asked = r.context.resumes;

      for (const type of ['pointerup', 'touchend', 'click']) document.dispatchEvent(new Event(type));

      expect(r.context.resumes).toBe(asked + 3);
      expect(messages().filter(m => m === 'audio: resume asked').length).toBe(2); // the start's, and one for the whole tap
      r.service.stop();
    }));

    it('is safe to start twice, to stop twice and to stop what never started', strict(() => {
      const r = rig();
      r.service.stop();
      r.service.start();
      r.service.start();
      expect(r.context.listening).toBe(1);
      r.service.stop();
      r.service.stop();
    }));
  });

  describe('a game with no sound', () => {
    it('is no state at all, and nothing is shown', strict(() => {
      const r = rig();
      r.service.fake = null;

      r.service.start();
      r.show();
      r.touch();
      tick(GRACE * 5);

      expect(r.service.status).toEqual({ state: null, blocked: false });
      r.service.stop();
    }));

    it('treats a context js-dos closed (the game exited) as nothing to wake', strict(() => {
      const r = rig();
      r.context.state = 'closed';

      r.service.start();
      tick(GRACE * 5);

      expect(r.context.resumes).toBe(0);
      expect(r.service.status.blocked).toBeFalse();
      r.service.stop();
    }));
  });

  describe('the volume', () => {
    it('sets js-dos\'s gain: the volume, or zero when muted', strict(() => {
      const r = rig();
      const calls: number[] = [];
      r.service.target = { setVolume: volume => { calls.push(volume); } };

      r.service.applyVolume(0.4, false);
      r.service.applyVolume(0.4, true);
      r.service.applyVolume(2, false);

      expect(calls).toEqual([0.4, 0, 1]);
    }));

    it('never touches the context itself: a mute is a gain on a context that keeps running', strict(() => {
      const r = rig();
      r.service.target = { setVolume: () => undefined };
      r.service.start();

      r.service.applyVolume(0, true);
      flushMicrotasks();

      expect(r.context.resumes).toBe(0);
      expect(r.context.state).toBe('running');
      expect(r.service.status.blocked).toBeFalse();
      r.service.stop();
    }));

    it('survives js-dos not being there, not having the call, or the call failing', strict(() => {
      const r = rig();
      r.service.target = undefined;
      expect(() => r.service.applyVolume(0.5, false)).not.toThrow();

      r.service.target = {};
      expect(() => r.service.applyVolume(0.5, false)).not.toThrow();

      r.service.target = { setVolume: () => { throw new Error('worker gone'); } };
      expect(() => r.service.applyVolume(0.5, false)).not.toThrow();

      r.service.target = { setVolume: () => Promise.reject(new Error('worker gone')) };
      expect(() => r.service.applyVolume(0.5, false)).not.toThrow();
      flushMicrotasks();
    }));
  });

  describe('the silent-mode setting (navigator.audioSession)', () => {
    it('is unsupported where the browser has no audioSession, and says so', strict(() => {
      const r = rig();
      expect(r.service.playbackSupported).toBeFalse();
      expect(r.service.setPlayback(true)).toBeFalse();
    }));

    it('sets the session to playback when chosen and back to auto when not', strict(() => {
      const r = rig();
      r.service.session = { type: 'auto' };

      expect(r.service.playbackSupported).toBeTrue();
      expect(r.service.setPlayback(true)).toBeTrue();
      expect(r.service.session.type).toBe('playback');
      r.service.setPlayback(false);
      expect(r.service.session.type).toBe('auto');
    }));

    it('reports a browser that refuses the value instead of throwing', strict(() => {
      const r = rig();
      r.service.session = Object.defineProperty({}, 'type', { set() { throw new TypeError('bad'); }, get() { return 'auto'; } }) as AudioSessionLike;

      expect(r.service.setPlayback(true)).toBeFalse();
    }));
  });

  describe('the diagnostics log', () => {
    it('notes every state the context goes through, what was asked of it and what came of that, under "platform"', strict(() => {
      const { diagnostics, calls, messages } = logRecorder();
      const r = rig(diagnostics);
      r.service.start();

      r.hide();
      r.context.setState('interrupted');
      r.show();
      flushMicrotasks();

      expect(messages()).toEqual(jasmine.arrayContaining(['audio: state', 'audio: resume asked', 'audio: resume answered']));
      expect(calls.every(([cat]) => cat === 'platform')).toBeTrue();
      const states = calls.filter(([, msg]) => msg === 'audio: state').map(([, , data]) => `${data?.['from']}>${data?.['to']}`);
      expect(states).toEqual(['null>running', 'running>interrupted', 'interrupted>running']);
      r.service.stop();
    }));
  });
});
