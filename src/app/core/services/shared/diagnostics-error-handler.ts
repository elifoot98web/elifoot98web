import { ErrorHandler, Injectable } from '@angular/core';
import { DiagnosticsService } from './diagnostics.service';

/**
 * Angular's own error handler, with one line added: what it is handed goes into the diagnostics
 * log first.
 *
 * Why the window listeners are not enough. An exception in a template event handler, or a
 * rejected promise inside the Angular zone, never reaches `window.onerror` or `unhandledrejection`:
 * NgZone catches it and routes it here, to `console.error`. zone.js also replaces `Promise`, and
 * its rejections do not raise the native event either (measured: of four unhandled rejections
 * only the one from a native `async` function reached a plain `unhandledrejection` listener). So
 * with only the window listeners the log would have shown errors from outside Angular and been
 * silent about nearly all the app's own, which is the part a phone report is for.
 *
 * The default behaviour is untouched: the error is passed on to `ErrorHandler.handleError`
 * afterwards. Off, this costs the one boolean check of `log()`.
 */
@Injectable()
export class DiagnosticsErrorHandler extends ErrorHandler {
  constructor(private diagnostics: DiagnosticsService) {
    super();
  }

  override handleError(error: unknown): void {
    this.diagnostics.log('error', 'ErrorHandler', () => ({ error }));
    super.handleError(error);
  }
}
