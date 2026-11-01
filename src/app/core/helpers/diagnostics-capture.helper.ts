import { DIAGNOSTICS } from '../models/constants';
import { DiagnosticsCategory } from '../models/diagnostics.models';

/** What the viewport entry reads off the window; every member is optional so a stand-in can be small. */
export interface DiagnosticsViewportSource {
  innerWidth?: number;
  innerHeight?: number;
  devicePixelRatio?: number;
  visualViewport?: { width?: number; height?: number; scale?: number; offsetLeft?: number; offsetTop?: number } | null;
  screen?: { width?: number; height?: number; orientation?: { type?: string; angle?: number } };
}

export type DiagnosticsCaptureScope = {
  window: EventTarget & DiagnosticsViewportSource;
  document: EventTarget & { visibilityState?: string };
};

export interface DiagnosticsCaptureSink {
  log(cat: DiagnosticsCategory, msg: string, data?: unknown): void;
  /** The page may be about to go away: write whatever is not saved yet. Must not throw. */
  flush(): void;
}

/**
 * The window-level listeners that are on only while diagnostics is: uncaught errors, the page's
 * own lifecycle, and the viewport.
 *
 * Why these and not more. Errors that nobody caught are the first thing a report on a phone has to
 * show, and the browser's console is out of reach there. (Errors Angular itself catches, and
 * rejections of zone.js's own promises, never reach a window listener; DiagnosticsErrorHandler
 * logs those.) The lifecycle events are what explain the
 * failure that looks like "the game reloaded by itself" on iOS: the OS hides, freezes and then
 * evicts a tab, and the only trace is `visibilitychange`, `pagehide` and `freeze` in the page that
 * is about to die (the next page reads them back, see DiagnosticsTail). The viewport events
 * explain the layout problems the touch and type-bar work will have: a soft keyboard changes
 * `visualViewport`, not `innerHeight`. Pointer, touch, key and IME events are NOT captured here;
 * the code that handles them logs what it does with them.
 *
 * `install` is the only place a listener is added and the returned function the only place one is
 * removed, so a log that is off has no listeners and no timers, by construction. The one timer is
 * the viewport coalescing: a rotation fires `resize` a dozen times and one entry is enough.
 *
 * Takes its scope as arguments so a spec drives it with plain event targets.
 */
export class DiagnosticsCapture {

  static install(scope: DiagnosticsCaptureScope, sink: DiagnosticsCaptureSink): () => void {
    const { window: win, document: doc } = scope;
    const undo: Array<() => void> = [];
    const on = (target: EventTarget, type: string, listener: (event: Event) => void, capture = false) => {
      target.addEventListener(type, listener, capture);
      undo.push(() => target.removeEventListener(type, listener, capture));
    };

    // Capturing, so that a failed <script>/<img>/<link> load is seen: those errors do not bubble.
    on(win, 'error', event => {
      if ('message' in event) {
        const failure = event as ErrorEvent;
        sink.log('error', 'window.error', () => ({
          message: failure.message, file: failure.filename, line: failure.lineno, col: failure.colno, error: failure.error,
        }));
      } else {
        const element = event.target as { tagName?: string; src?: string; href?: string } | null;
        sink.log('error', 'resource.error', () => ({ tag: element?.tagName, url: element?.src || element?.href }));
      }
    }, true);
    on(win, 'unhandledrejection', event => {
      sink.log('error', 'unhandledrejection', () => ({ reason: (event as PromiseRejectionEvent).reason }));
    });

    on(doc, 'visibilitychange', () => {
      sink.log('page', 'visibilitychange', () => ({ state: doc.visibilityState }));
      if (doc.visibilityState === 'hidden') sink.flush();
    });
    on(win, 'pagehide', event => {
      sink.log('page', 'pagehide', () => ({ persisted: (event as PageTransitionEvent).persisted }));
      sink.flush();
    });
    on(win, 'pageshow', event => {
      sink.log('page', 'pageshow', () => ({ persisted: (event as PageTransitionEvent).persisted }));
    });
    // Page Lifecycle API: Chromium only, and where it exists it is the one that says "frozen".
    if ('onfreeze' in doc) {
      on(doc, 'freeze', () => {
        sink.log('page', 'freeze');
        sink.flush();
      });
      on(doc, 'resume', () => sink.log('page', 'resume'));
    }

    let quiet: ReturnType<typeof setTimeout> | undefined;
    const reasons = new Set<string>();
    const settleViewport = () => {
      quiet = undefined;
      const why = Array.from(reasons);
      reasons.clear();
      sink.log('page', 'viewport', () => DiagnosticsCapture.viewport(win, why));
    };
    const viewportChanged = (event: Event) => {
      reasons.add(event.type);
      clearTimeout(quiet);
      quiet = setTimeout(settleViewport, DIAGNOSTICS.VIEWPORT_COALESCE_MS);
    };
    on(win, 'resize', viewportChanged);
    on(win, 'orientationchange', viewportChanged);
    // The soft keyboard resizes this one and leaves `innerHeight` alone on iOS.
    if (win.visualViewport && typeof (win.visualViewport as unknown as EventTarget).addEventListener === 'function') {
      on(win.visualViewport as unknown as EventTarget, 'resize', viewportChanged);
    }

    return () => {
      clearTimeout(quiet);
      quiet = undefined;
      reasons.clear();
      for (const remove of undo.splice(0)) remove();
    };
  }

  /** The sizes a layout bug needs: both viewports, the screen and its orientation. */
  static viewport(win: DiagnosticsViewportSource, why: readonly string[]): Record<string, unknown> {
    const visual = win.visualViewport;
    return {
      why,
      inner: `${win.innerWidth}x${win.innerHeight}`,
      visual: visual ? `${visual.width}x${visual.height}@${visual.scale} off(${visual.offsetLeft},${visual.offsetTop})` : undefined,
      screen: win.screen ? `${win.screen.width}x${win.screen.height}` : undefined,
      orientation: win.screen?.orientation ? `${win.screen.orientation.type} ${win.screen.orientation.angle}` : undefined,
      dpr: win.devicePixelRatio,
    };
  }
}
