import { fakeAsync, tick } from '@angular/core/testing';
import { DIAGNOSTICS } from '../models/constants';
import { DiagnosticsCategory } from '../models/diagnostics.models';
import { DiagnosticsCapture, DiagnosticsCaptureScope } from './diagnostics-capture.helper';

interface Logged {
  cat: DiagnosticsCategory;
  msg: string;
  data: unknown;
}

/** Event targets with just the members the capture reads, so nothing touches the real window. */
function scope(options: { lifecycle?: boolean; visualViewport?: boolean } = {}) {
  const win = Object.assign(new EventTarget(), {
    innerWidth: 412, innerHeight: 780, devicePixelRatio: 2,
    screen: { width: 412, height: 915, orientation: { type: 'portrait-primary', angle: 0 } },
    visualViewport: options.visualViewport === false ? null : Object.assign(new EventTarget(), { width: 412, height: 700, scale: 1, offsetLeft: 0, offsetTop: 0 }),
  });
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' }, options.lifecycle === false ? {} : { onfreeze: null, onresume: null });
  return { win, doc, scope: { window: win, document: doc } as unknown as DiagnosticsCaptureScope };
}

function sink() {
  const logged: Logged[] = [];
  const flush = jasmine.createSpy('flush');
  return {
    logged, flush,
    // Evaluates a data thunk the way the service does, so the specs read what would be recorded.
    log: (cat: DiagnosticsCategory, msg: string, data?: unknown) =>
      logged.push({ cat, msg, data: typeof data === 'function' ? (data as () => unknown)() : data }),
  };
}

const messages = (s: ReturnType<typeof sink>) => s.logged.map(l => `${l.cat}:${l.msg}`);

describe('DiagnosticsCapture', () => {

  it('adds no listener until it is installed, and none remain once it is stopped', () => {
    const { win, doc, scope: s } = scope();
    const adds = spyOn(win, 'addEventListener').and.callThrough();
    const removes = spyOn(win, 'removeEventListener').and.callThrough();
    const docRemoves = spyOn(doc, 'removeEventListener').and.callThrough();
    const docAdds = spyOn(doc, 'addEventListener').and.callThrough();

    expect(adds).not.toHaveBeenCalled();
    const stop = DiagnosticsCapture.install(s, sink());
    const installed = adds.calls.count() + docAdds.calls.count();
    expect(installed).toBeGreaterThan(5);

    stop();
    expect(removes.calls.count() + docRemoves.calls.count()).toBe(installed);
  });

  describe('errors', () => {

    it('logs an uncaught error with where it happened', () => {
      const { win, scope: s } = scope();
      const out = sink();
      DiagnosticsCapture.install(s, out);

      win.dispatchEvent(new ErrorEvent('error', { message: 'x is not a function', filename: 'main.js', lineno: 12, colno: 7, error: new TypeError('x is not a function') }));

      expect(messages(out)).toEqual(['error:window.error']);
      expect(out.logged[0].data).toEqual(jasmine.objectContaining({ message: 'x is not a function', file: 'main.js', line: 12, col: 7 }));
    });

    it('logs a resource that failed to load, which is not an ErrorEvent', () => {
      const { win, scope: s } = scope();
      const out = sink();
      DiagnosticsCapture.install(s, out);
      const script = document.createElement('script');
      script.src = 'https://example.invalid/wdosbox.js';

      // A failed load fires a plain Event at the element; the capture phase is what sees it on the window.
      win.dispatchEvent(Object.defineProperty(new Event('error'), 'target', { value: script }));

      expect(messages(out)).toEqual(['error:resource.error']);
      expect(out.logged[0].data).toEqual({ tag: 'SCRIPT', url: 'https://example.invalid/wdosbox.js' });
    });

    it('logs a rejection nobody handled, with its reason', () => {
      const { win, scope: s } = scope();
      const out = sink();
      DiagnosticsCapture.install(s, out);
      const event = Object.assign(new Event('unhandledrejection'), { reason: new Error('db closed') });

      win.dispatchEvent(event);

      expect(messages(out)).toEqual(['error:unhandledrejection']);
      expect((out.logged[0].data as { reason: Error }).reason.message).toBe('db closed');
    });
  });

  describe('the page lifecycle', () => {

    it('logs visibility changes, and asks for a flush only when the page went hidden', () => {
      const { doc, scope: s } = scope();
      const out = sink();
      DiagnosticsCapture.install(s, out);

      doc.visibilityState = 'hidden';
      doc.dispatchEvent(new Event('visibilitychange'));
      expect(out.flush).toHaveBeenCalledTimes(1);

      doc.visibilityState = 'visible';
      doc.dispatchEvent(new Event('visibilitychange'));
      expect(out.flush).toHaveBeenCalledTimes(1);
      expect(out.logged.map(l => l.data)).toEqual([{ state: 'hidden' }, { state: 'visible' }]);
    });

    it('logs pagehide with whether the page may be restored, and flushes', () => {
      const { win, scope: s } = scope();
      const out = sink();
      DiagnosticsCapture.install(s, out);

      win.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }));

      expect(out.logged).toEqual([{ cat: 'page', msg: 'pagehide', data: { persisted: true } }]);
      expect(out.flush).toHaveBeenCalledTimes(1);
    });

    it('logs pageshow without flushing', () => {
      const { win, scope: s } = scope();
      const out = sink();
      DiagnosticsCapture.install(s, out);

      win.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }));

      expect(messages(out)).toEqual(['page:pageshow']);
      expect(out.flush).not.toHaveBeenCalled();
    });

    it('logs freeze and resume where the browser has the Page Lifecycle API', () => {
      const { doc, scope: s } = scope();
      const out = sink();
      DiagnosticsCapture.install(s, out);

      doc.dispatchEvent(new Event('freeze'));
      doc.dispatchEvent(new Event('resume'));

      expect(messages(out)).toEqual(['page:freeze', 'page:resume']);
      expect(out.flush).toHaveBeenCalledTimes(1);
    });

    it('does not listen for them where it does not (Safari)', () => {
      const { doc, scope: s } = scope({ lifecycle: false });
      const out = sink();
      DiagnosticsCapture.install(s, out);

      doc.dispatchEvent(new Event('freeze'));
      doc.dispatchEvent(new Event('resume'));

      expect(out.logged).toEqual([]);
    });
  });

  describe('the viewport', () => {

    it('turns a burst of resize and rotation events into one entry after a quiet moment', fakeAsync(() => {
      const { win, scope: s } = scope();
      const out = sink();
      const stop = DiagnosticsCapture.install(s, out);

      win.dispatchEvent(new Event('orientationchange'));
      win.dispatchEvent(new Event('resize'));
      tick(DIAGNOSTICS.VIEWPORT_COALESCE_MS - 1);
      win.dispatchEvent(new Event('resize'));
      tick(DIAGNOSTICS.VIEWPORT_COALESCE_MS - 1);
      expect(out.logged).toEqual([]);

      tick(1);
      expect(out.logged.length).toBe(1);
      expect(out.logged[0].msg).toBe('viewport');
      expect(out.logged[0].data).toEqual(jasmine.objectContaining({
        why: ['orientationchange', 'resize'], inner: '412x780', visual: '412x700@1 off(0,0)', dpr: 2,
      }));
      stop();
    }));

    it('hears the visual viewport, which is what the soft keyboard resizes', fakeAsync(() => {
      const { win, scope: s } = scope();
      const out = sink();
      const stop = DiagnosticsCapture.install(s, out);

      (win.visualViewport as unknown as EventTarget).dispatchEvent(new Event('resize'));
      tick(DIAGNOSTICS.VIEWPORT_COALESCE_MS);

      expect(out.logged[0].data).toEqual(jasmine.objectContaining({ why: ['resize'] }));
      stop();
    }));

    it('copes with a browser that has no visualViewport', fakeAsync(() => {
      const { win, scope: s } = scope({ visualViewport: false });
      const out = sink();
      const stop = DiagnosticsCapture.install(s, out);

      win.dispatchEvent(new Event('resize'));
      tick(DIAGNOSTICS.VIEWPORT_COALESCE_MS);

      expect(out.logged.length).toBe(1);
      stop();
    }));

    it('leaves nothing on the clock when stopped in the middle of a burst, and logs nothing more', fakeAsync(() => {
      const { win, scope: s } = scope();
      const out = sink();
      const stop = DiagnosticsCapture.install(s, out);

      win.dispatchEvent(new Event('resize'));
      stop();

      tick(DIAGNOSTICS.VIEWPORT_COALESCE_MS * 4);
      win.dispatchEvent(new Event('resize'));
      expect(out.logged).toEqual([]);
    }));
  });

  it('logs nothing after it is stopped', () => {
    const { win, doc, scope: s } = scope();
    const out = sink();
    const stop = DiagnosticsCapture.install(s, out);
    stop();

    win.dispatchEvent(new ErrorEvent('error', { message: 'late' }));
    win.dispatchEvent(new Event('pagehide'));
    doc.dispatchEvent(new Event('visibilitychange'));

    expect(out.logged).toEqual([]);
    expect(out.flush).not.toHaveBeenCalled();
  });
});
