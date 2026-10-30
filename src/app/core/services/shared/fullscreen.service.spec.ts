import { NgZone } from '@angular/core';
import { fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { FullscreenDocumentLike } from '../../helpers/fullscreen.helper';
import { logRecorder, silentDiagnostics } from './diagnostics.testing';
import { FullscreenService, OrientationLike } from './fullscreen.service';

/** A document that goes fullscreen when asked, like one of the browsers that can. */
class FakeDocument implements FullscreenDocumentLike {
  fullscreenEnabled: boolean | undefined = true;
  fullscreenElement: Element | null = null;
  requests = 0;
  exits = 0;
  refuseWith: Error | null = null;
  documentElement = {
    requestFullscreen: (_options?: { navigationUI?: 'hide' | 'show' | 'auto' }) => {
      this.requests++;
      if (this.refuseWith) return Promise.reject(this.refuseWith);
      this.fullscreenElement = document.documentElement;
      return Promise.resolve();
    },
  };
  exitFullscreen = () => {
    this.exits++;
    this.fullscreenElement = null;
    return Promise.resolve();
  };
}

class FakeOrientation implements OrientationLike {
  locks: string[] = [];
  unlocks = 0;
  refuse = false;
  lock = (orientation: 'landscape') => {
    if (this.refuse) return Promise.reject(new DOMException('not supported', 'NotSupportedError'));
    this.locks.push(orientation);
    return Promise.resolve();
  };
  unlock = () => { this.unlocks++; };
}

class TestFullscreenService extends FullscreenService {
  fake = new FakeDocument();
  orientationFake: OrientationLike | undefined = new FakeOrientation();
  coarse = true;
  protected override doc(): FullscreenDocumentLike { return this.fake; }
  protected override orientation(): OrientationLike | undefined { return this.orientationFake; }
  protected override coarsePointer(): boolean { return this.coarse; }
}

function rig(diagnostics: unknown = silentDiagnostics()) {
  const service = new TestFullscreenService(new NgZone({ enableLongStackTrace: false }), diagnostics as never);
  const seen: boolean[] = [];
  service.active$.subscribe(active => seen.push(active));
  /** What the browser does when fullscreen ends by itself (Esc, the system Back gesture). */
  const browserLeaves = () => {
    service.fake.fullscreenElement = null;
    document.dispatchEvent(new Event('fullscreenchange'));
  };
  return { service, seen, orientation: service.orientationFake as FakeOrientation, browserLeaves };
}

describe('FullscreenService', () => {
  it('goes fullscreen on the document element, hiding the navigation UI', fakeAsync(() => {
    const r = rig();
    const request = spyOn(r.service.fake.documentElement, 'requestFullscreen').and.callThrough();
    r.service.start();

    let outcome = '';
    r.service.enter().then(value => { outcome = value; });
    flushMicrotasks();

    expect(outcome).toBe('entered');
    expect(request).toHaveBeenCalledWith({ navigationUI: 'hide' });
    expect(r.service.active).toBeTrue();
    r.service.stop();
  }));

  it('turns a finger-driven device to landscape after the fullscreen worked, and says so in the entry', fakeAsync(() => {
    const r = rig();
    r.service.start();
    expect(r.service.summary).toBe('Esconde a barra do navegador e deita a tela');

    r.service.enter();
    flushMicrotasks();

    expect(r.orientation.locks).toEqual(['landscape']);
    r.service.stop();
  }));

  it('does not touch the orientation on a desktop or where the browser has no lock', fakeAsync(() => {
    const desktop = rig();
    desktop.service.coarse = false;
    desktop.service.start();
    expect(desktop.service.summary).toBe('Esconde a barra do navegador');
    desktop.service.enter();
    flushMicrotasks();
    expect(desktop.orientation.locks).toEqual([]);
    desktop.service.stop();

    const ios = rig();
    ios.service.orientationFake = undefined;
    ios.service.start();
    ios.service.enter();
    flushMicrotasks();
    expect(ios.service.active).toBeTrue(); // fullscreen is not conditional on the lock
    ios.service.stop();
  }));

  it('is still fullscreen when the browser refuses the orientation lock (Chromium allows it in fullscreen and an installed app only)', fakeAsync(() => {
    const { diagnostics, messages } = logRecorder();
    const r = rig(diagnostics);
    r.orientation.refuse = true;
    r.service.start();

    let outcome = '';
    r.service.enter().then(value => { outcome = value; });
    flushMicrotasks();

    expect(outcome).toBe('entered');
    expect(messages()).toContain('orientation: lock refused');
    r.service.stop();
    expect(r.orientation.unlocks).toBe(0); // nothing was locked, so nothing is let go
  }));

  it('lets the orientation go when fullscreen ends by itself (Esc, the Back gesture)', fakeAsync(() => {
    const r = rig();
    r.service.start();
    r.service.enter();
    flushMicrotasks();

    r.browserLeaves();

    expect(r.orientation.unlocks).toBe(1);
    expect(r.service.active).toBeFalse();
    expect(r.seen[r.seen.length - 1]).toBeFalse();
    r.service.stop();
    expect(r.orientation.unlocks).toBe(1); // not again
  }));

  it('leaves fullscreen and lets the orientation go when asked to', fakeAsync(() => {
    const r = rig();
    r.service.start();
    r.service.enter();
    flushMicrotasks();

    let outcome = '';
    r.service.toggle().then(value => { outcome = value; });
    flushMicrotasks();

    expect(outcome).toBe('exited');
    expect(r.service.fake.exits).toBe(1);
    expect(r.orientation.unlocks).toBe(1);
    r.service.stop();
  }));

  it('toggles: enter when it is not fullscreen, leave when it is', fakeAsync(() => {
    const r = rig();
    r.service.start();

    r.service.toggle();
    flushMicrotasks();
    expect(r.service.active).toBeTrue();

    r.service.toggle();
    flushMicrotasks();
    expect(r.service.active).toBeFalse();
    r.service.stop();
  }));

  it('reports a refusal, and holds no orientation lock for it', fakeAsync(() => {
    const r = rig();
    r.service.fake.refuseWith = new TypeError('Permissions check failed');
    r.service.start();

    let outcome = '';
    r.service.enter().then(value => { outcome = value; });
    flushMicrotasks();

    expect(outcome).toBe('refused');
    expect(r.service.active).toBeFalse();
    expect(r.orientation.locks).toEqual([]);
    r.service.stop();
  }));

  it('is unsupported where the document says so (iPhone Safari), and asks for nothing', fakeAsync(() => {
    const r = rig();
    r.service.fake.fullscreenEnabled = false;
    r.service.start();

    let outcome = '';
    r.service.enter().then(value => { outcome = value; });
    flushMicrotasks();

    expect(r.service.supported).toBeFalse();
    expect(outcome).toBe('unsupported');
    expect(r.service.fake.requests).toBe(0);
    r.service.stop();
  }));

  it('follows the document\'s changes between start() and stop(), and not after', fakeAsync(() => {
    const r = rig();
    r.service.start();
    r.service.fake.fullscreenElement = document.body;
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(r.seen[r.seen.length - 1]).toBeTrue();

    r.service.stop();
    r.service.fake.fullscreenElement = null;
    document.dispatchEvent(new Event('fullscreenchange'));
    flushMicrotasks();

    expect(r.seen[r.seen.length - 1]).toBeTrue(); // nobody was listening
  }));

  it('leaves fullscreen when the page is left', fakeAsync(() => {
    const r = rig();
    r.service.start();
    r.service.enter();
    flushMicrotasks();

    r.service.stop();
    flushMicrotasks();

    expect(r.service.fake.exits).toBe(1);
    expect(r.orientation.unlocks).toBe(1);
  }));

  it('is safe to stop twice and to stop what never started', fakeAsync(() => {
    const r = rig();
    r.service.stop();
    r.service.start();
    r.service.start();
    r.service.stop();
    r.service.stop();
    flushMicrotasks();
    expect(r.service.fake.exits).toBe(0);
  }));
});
