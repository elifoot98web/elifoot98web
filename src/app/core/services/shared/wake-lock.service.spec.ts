import { NgZone } from '@angular/core';
import { fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { WAKE_LOCK } from '../../models/constants';
import { logRecorder, silentDiagnostics } from './diagnostics.testing';
import { WakeLockApiLike, WakeLockOptions, WakeLockService, WakeLockSentinelLike } from './wake-lock.service';

/** What the browser hands back: a lock that can be let go of, or taken back. */
class FakeSentinel implements WakeLockSentinelLike {
  released = false;
  private readonly listeners = new Set<() => void>();
  addEventListener(_type: 'release', listener: () => void): void { this.listeners.add(listener); }
  removeEventListener(_type: 'release', listener: () => void): void { this.listeners.delete(listener); }
  get listening(): number { return this.listeners.size; }
  /** The page's own `release()`: the real one also fires the event, to whoever is still listening. */
  release(): Promise<void> {
    this.released = true;
    for (const listener of [...this.listeners]) listener();
    return Promise.resolve();
  }
  /** The browser takes the lock back (the page hid, the battery saver came on) and says so. */
  revoke(): void { this.release(); }
}

/** `navigator.wakeLock`: every request is counted, and the next answer is the spec's to choose. */
class FakeApi implements WakeLockApiLike {
  requests = 0;
  readonly sentinels: FakeSentinel[] = [];
  /** 'grant', an error to reject with, or 'hold' to keep the request in flight until `settle()`. */
  next: 'grant' | 'hold' | Error = 'grant';
  private held: Array<{ resolve: (s: WakeLockSentinelLike) => void; reject: (e: unknown) => void }> = [];

  request(_type: 'screen'): Promise<WakeLockSentinelLike> {
    this.requests++;
    if (this.next === 'hold') return new Promise((resolve, reject) => this.held.push({ resolve, reject }));
    if (this.next instanceof Error) return Promise.reject(this.next);
    const sentinel = new FakeSentinel();
    this.sentinels.push(sentinel);
    return Promise.resolve(sentinel);
  }

  /** Answer the oldest request that was held. */
  settle(answer: 'grant' | Error): void {
    const waiting = this.held.shift()!;
    if (answer instanceof Error) return waiting.reject(answer);
    const sentinel = new FakeSentinel();
    this.sentinels.push(sentinel);
    waiting.resolve(sentinel);
  }

  get last(): FakeSentinel { return this.sentinels[this.sentinels.length - 1]; }
  get held$(): number { return this.sentinels.filter(s => !s.released).length; }
}

class TestWakeLockService extends WakeLockService {
  fake: FakeApi | undefined = new FakeApi();
  isVisible = true;
  protected override api(): WakeLockApiLike | undefined { return this.fake; }
  protected override visible(): boolean { return this.isVisible; }
}

const notAllowed = () => new DOMException('The request is not allowed (battery saver)', 'NotAllowedError');

function rig(diagnostics: unknown = silentDiagnostics()) {
  const service = new TestWakeLockService(new NgZone({ enableLongStackTrace: false }), diagnostics as never);
  const world = { inRoom: false };
  const options = (setting: boolean): WakeLockOptions => ({ setting, inRoom: () => world.inRoom });
  const hide = () => { service.isVisible = false; document.dispatchEvent(new Event('visibilitychange')); };
  const show = () => { service.isVisible = true; document.dispatchEvent(new Event('visibilitychange')); };
  const tap = () => document.dispatchEvent(new Event('pointerup'));
  return { service, world, options, hide, show, tap, api: service.fake! };
}

/** fakeAsync that fails on a timer left behind: the service owns none, and must not grow one. */
const strict = (body: () => void) => fakeAsync(body, { flush: false });

describe('WakeLockService', () => {
  describe('where the browser has no Screen Wake Lock', () => {
    it('does nothing, says so, and never throws', strict(() => {
      const r = rig();
      r.service.fake = undefined;

      r.service.start(r.options(true));
      flushMicrotasks();

      expect(r.service.supported).toBeFalse();
      expect(r.service.holding).toBeFalse();
      expect(r.service.summary).toBe('Este navegador não permite manter a tela ligada.');
      r.world.inRoom = true;
      r.service.refresh();
      r.show();
      flushMicrotasks();
      expect(r.service.holding).toBeFalse();
      r.service.stop();
    }));
  });

  describe('on a phone', () => {
    it('asks for the screen when the game starts with the switch on, and holds it', strict(() => {
      const r = rig();

      r.service.start(r.options(true));
      flushMicrotasks();

      expect(r.api.requests).toBe(1);
      expect(r.service.holding).toBeTrue();
      expect(r.service.summary).toContain('Ligada');
      r.service.stop();
    }));

    it('does not ask with the switch off and no room', strict(() => {
      const r = rig();

      r.service.start(r.options(false));
      flushMicrotasks();

      expect(r.api.requests).toBe(0);
      expect(r.service.holding).toBeFalse();
      expect(r.service.summary).toContain('Desligada');
      r.service.stop();
    }));

    it('lets go when the switch is turned off, and asks again when it is turned on', strict(() => {
      const r = rig();
      r.service.start(r.options(true));
      flushMicrotasks();
      const first = r.api.last;

      r.service.setSetting(false);
      flushMicrotasks();
      expect(first.released).toBeTrue();
      expect(r.service.holding).toBeFalse();

      r.service.setSetting(true);
      flushMicrotasks();
      expect(r.api.requests).toBe(2);
      expect(r.service.holding).toBeTrue();
      r.service.stop();
    }));

    it('holds the screen for a room whatever the switch says, and lets go when the room closes', strict(() => {
      const r = rig();
      r.service.start(r.options(false));
      flushMicrotasks();
      expect(r.service.holding).toBeFalse();

      r.world.inRoom = true;
      r.service.refresh();
      flushMicrotasks();
      expect(r.service.holding).toBeTrue();
      expect(r.service.summary).toContain('sala');

      r.world.inRoom = false;
      r.service.refresh();
      flushMicrotasks();
      expect(r.service.holding).toBeFalse();
      expect(r.api.last.released).toBeTrue();
      r.service.stop();
    }));

    it('keeps one lock however often it is told the room has not changed', strict(() => {
      const r = rig();
      r.service.start(r.options(true));
      flushMicrotasks();

      for (let i = 0; i < 5; i++) r.service.refresh();
      r.service.start(r.options(true));
      flushMicrotasks();

      expect(r.api.requests).toBe(1);
      r.service.stop();
    }));
  });

  describe('as the page hides and shows', () => {
    it('does not ask while the page is hidden, and asks as soon as it is shown', strict(() => {
      const r = rig();
      r.service.isVisible = false;
      r.service.start(r.options(true));
      flushMicrotasks();
      expect(r.api.requests).toBe(0);

      r.show();
      flushMicrotasks();

      expect(r.api.requests).toBe(1);
      expect(r.service.holding).toBeTrue();
      r.service.stop();
    }));

    it('asks again when the page comes back, because the browser let go when it hid', strict(() => {
      const r = rig();
      r.service.start(r.options(true));
      flushMicrotasks();

      r.hide();
      r.api.last.revoke(); // what the browser does to a hidden page
      flushMicrotasks();
      expect(r.service.holding).toBeFalse();
      expect(r.api.requests).toBe(1); // a hidden page is not asked

      r.show();
      flushMicrotasks();

      expect(r.api.requests).toBe(2);
      expect(r.service.holding).toBeTrue();
      r.service.stop();
    }));

    it('asks again when the browser takes the lock back from a page that is still visible', strict(() => {
      const r = rig();
      r.service.start(r.options(true));
      flushMicrotasks();
      tick(WAKE_LOCK.QUICK_RELEASE_MS + 1); // held long enough that this is the system's doing, not an unstable lock

      r.api.last.revoke();
      flushMicrotasks();

      expect(r.api.requests).toBe(2);
      expect(r.service.holding).toBeTrue();
      r.service.stop();
    }));

    it('stops asking of a browser that grants and takes back at once, until the page returns', strict(() => {
      const r = rig();
      r.service.start(r.options(true));
      flushMicrotasks();

      for (let i = 0; i < 10; i++) {
        r.api.last.revoke();
        flushMicrotasks();
      }

      expect(r.api.requests).toBe(WAKE_LOCK.QUICK_RELEASE_LIMIT);
      expect(r.service.holding).toBeFalse();

      r.hide();
      r.show();
      flushMicrotasks();
      expect(r.api.requests).toBe(WAKE_LOCK.QUICK_RELEASE_LIMIT + 1);
      expect(r.service.holding).toBeTrue();
      r.service.stop();
    }));
  });

  describe('when the browser says no', () => {
    it('notes the refusal and does not ask in a loop', strict(() => {
      const r = rig();
      r.api.next = notAllowed();

      r.service.start(r.options(true));
      flushMicrotasks();
      tick(60_000);

      expect(r.api.requests).toBe(1);
      expect(r.service.holding).toBeFalse();
      expect(r.service.summary).toContain('não deixou');
      r.service.stop();
    }));

    it('tries again when the page comes back', strict(() => {
      const r = rig();
      r.api.next = notAllowed();
      r.service.start(r.options(true));
      flushMicrotasks();

      r.api.next = 'grant';
      r.hide();
      r.show();
      flushMicrotasks();

      expect(r.api.requests).toBe(2);
      expect(r.service.holding).toBeTrue();
      r.service.stop();
    }));

    it('tries again on a tap, but not on one that comes too soon after the last try', strict(() => {
      const r = rig();
      r.api.next = notAllowed();
      r.service.start(r.options(true));
      flushMicrotasks();

      r.api.next = 'grant';
      r.tap();
      flushMicrotasks();
      expect(r.api.requests).toBe(1); // too soon: a battery saver says no to every tap

      tick(WAKE_LOCK.GESTURE_RETRY_MIN_MS);
      r.tap();
      flushMicrotasks();

      expect(r.api.requests).toBe(2);
      expect(r.service.holding).toBeTrue();
      r.service.stop();
    }));

    it('listens for taps only while a refusal is waiting for one', strict(() => {
      const r = rig();
      const adds = spyOn(document, 'addEventListener').and.callThrough();
      const removes = spyOn(document, 'removeEventListener').and.callThrough();
      const taps = () => adds.calls.allArgs().filter(([type]) => type === 'pointerup').length
        - removes.calls.allArgs().filter(([type]) => type === 'pointerup').length;

      r.service.start(r.options(true));
      flushMicrotasks();
      expect(taps()).toBe(0); // granted: nothing to wait for

      r.service.setSetting(false);
      r.api.next = notAllowed();
      r.service.setSetting(true);
      flushMicrotasks();
      expect(taps()).toBe(1);

      r.service.setSetting(false); // the wish is gone: so is the wait
      expect(taps()).toBe(0);

      r.service.setSetting(true);
      flushMicrotasks();
      expect(taps()).toBe(1);
      r.service.stop();
      expect(taps()).toBe(0);
    }));

    it('does not retry a failure that is not a refusal on a tap', strict(() => {
      const r = rig();
      r.api.next = new DOMException('gone', 'AbortError');
      r.service.start(r.options(true));
      flushMicrotasks();

      r.api.next = 'grant';
      tick(WAKE_LOCK.GESTURE_RETRY_MIN_MS * 2);
      r.tap();
      flushMicrotasks();

      expect(r.api.requests).toBe(1);
      expect(r.service.summary).toContain('Não foi possível');
      r.service.stop();
    }));
  });

  describe('a request that is overtaken', () => {
    it('lets a lock go that arrives after the wish went away', strict(() => {
      const r = rig();
      r.api.next = 'hold';
      r.service.start(r.options(true));
      flushMicrotasks();

      r.service.setSetting(false);
      r.api.settle('grant');
      flushMicrotasks();

      expect(r.service.holding).toBeFalse();
      expect(r.api.last.released).toBeTrue();
      r.service.stop();
    }));

    it('keeps a lock that arrives after the wish went away and came back', strict(() => {
      const r = rig();
      r.api.next = 'hold';
      r.service.start(r.options(true));
      flushMicrotasks();

      r.service.setSetting(false);
      r.service.setSetting(true); // still in flight: nothing new is asked
      expect(r.api.requests).toBe(1);
      r.api.settle('grant');
      flushMicrotasks();

      expect(r.service.holding).toBeTrue();
      expect(r.api.held$).toBe(1);
      r.service.stop();
    }));

    it('lets a lock go that arrives after the page was left, and holds nothing of the next page', strict(() => {
      const r = rig();
      r.api.next = 'hold';
      r.service.start(r.options(true));
      flushMicrotasks();

      r.service.stop();
      r.api.settle('grant');
      flushMicrotasks();

      expect(r.service.holding).toBeFalse();
      expect(r.api.held$).toBe(0);
    }));
  });

  describe('leaving', () => {
    it('lets go of the lock, and ignores the page from then on', strict(() => {
      const r = rig();
      r.service.start(r.options(true));
      flushMicrotasks();
      const lock = r.api.last;

      r.service.stop();
      flushMicrotasks();
      expect(lock.released).toBeTrue();
      expect(lock.listening).toBe(0);

      r.hide();
      r.show();
      r.world.inRoom = true;
      r.service.refresh();
      flushMicrotasks();
      expect(r.api.requests).toBe(1);
      expect(r.service.running).toBeFalse();
    }));

    it('is safe to stop twice, and to stop what never started', strict(() => {
      const r = rig();
      r.service.stop();
      r.service.start(r.options(true));
      flushMicrotasks();
      r.service.stop();
      r.service.stop();
      expect(r.service.holding).toBeFalse();
    }));

    it('does not hold the lock of a lock the browser released itself when the page is left afterwards', strict(() => {
      const r = rig();
      r.service.start(r.options(true));
      flushMicrotasks();
      r.hide();
      r.api.last.revoke();

      r.service.stop();

      expect(r.service.holding).toBeFalse();
    }));
  });

  describe('the diagnostics log', () => {
    it('notes a grant, a refusal and a release, under "platform"', strict(() => {
      const { diagnostics, calls, messages } = logRecorder();
      const r = rig(diagnostics);

      r.service.start(r.options(true));
      flushMicrotasks();
      r.service.setSetting(false);
      flushMicrotasks();
      r.api.next = notAllowed();
      r.service.setSetting(true);
      flushMicrotasks();

      expect(messages()).toContain('wake lock: granted');
      expect(messages()).toContain('wake lock: released');
      expect(messages()).toContain('wake lock: refused');
      expect(calls.every(([cat]) => cat === 'platform')).toBeTrue();
      expect(calls.find(([, msg]) => msg === 'wake lock: refused')?.[2]).toEqual(jasmine.objectContaining({ kind: 'not-allowed' }));
      r.service.stop();
    }));
  });
});
