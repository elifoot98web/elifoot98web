import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { FullscreenDocumentLike, FullscreenHelper } from '../../helpers/fullscreen.helper';
import { DiagnosticsService } from './diagnostics.service';

/** The part of `screen.orientation` this service uses; the call is missing from some browsers and from the TypeScript DOM typings. */
export interface OrientationLike {
  lock?: (orientation: 'landscape') => Promise<void>;
  unlock?: () => void;
}

export type FullscreenOutcome = 'entered' | 'exited' | 'unsupported' | 'refused';

/**
 * "Tela cheia": the page goes fullscreen, and on a phone it turns to landscape with it.
 *
 * **It is the document element that goes fullscreen, not `#game-container`.** A fullscreen element
 * is the only thing the browser paints (plus its descendants): fullscreening the emulator's box
 * would take the Ionic alerts, popovers and toasts (which live under the app root, outside it), the
 * control deck and the chat out of the picture, and js-dos has a fullscreen of its own that does
 * exactly that, which is why the app never exposes it. The page's layout does not depend on the
 * fullscreen: the viewport changes size, the resize observers that already watch `#game-container`
 * (js-dos's relayout, `OverlaySyncHelper` for the cursor overlay) see the new box, and nothing here
 * touches either.
 *
 * **The orientation lock is part of the action, not a policy.** After a fullscreen that worked, on a
 * device whose primary pointer is a finger, it asks for `landscape` inside a try/catch: Chromium on
 * Android allows it in fullscreen and refuses it elsewhere, iOS has neither call, and a desktop
 * rejects it. It is let go when fullscreen ends, however it ends (the Esc key, the system Back
 * gesture), from the `fullscreenchange` event. There is no manifest `orientation` and no lock taken
 * unasked (decision D4): a person who never pressed "Tela cheia" keeps portrait.
 *
 * **Where it does not exist it is not offered.** iPhone Safari has no Fullscreen API for elements, so
 * `supported` is false and the menu hides the entry; the way to chrome-free play there is to install
 * the app, which the install entry says.
 *
 * `start()` and `stop()` bracket a page, and the listeners exist only between them. It logs into the
 * diagnostics log under `platform`.
 */
@Injectable({
  providedIn: 'root'
})
export class FullscreenService {
  private readonly activeSubject = new BehaviorSubject<boolean>(false);
  private watching = false;
  private orientationLocked = false;

  /** Whether the page is fullscreen, kept up to date between `start()` and `stop()`. */
  readonly active$: Observable<boolean> = this.activeSubject.asObservable();

  constructor(private zone: NgZone, private diagnostics: DiagnosticsService) { }

  /** Where `document` comes from; a spec hands it a stand-in. */
  protected doc(): FullscreenDocumentLike {
    return document as unknown as FullscreenDocumentLike;
  }

  protected orientation(): OrientationLike | undefined {
    return typeof screen === 'undefined' ? undefined : (screen as { orientation?: OrientationLike }).orientation;
  }

  /** `(pointer: coarse)`: a finger is how this device is used. */
  protected coarsePointer(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  }

  get supported(): boolean {
    return FullscreenHelper.supported(this.doc());
  }

  get active(): boolean {
    return FullscreenHelper.active(this.doc());
  }

  /** Whether pressing the entry will also turn the screen (so that its words can say it). */
  get locksOrientation(): boolean {
    return FullscreenHelper.shouldLockOrientation({ coarsePointer: this.coarsePointer(), canLock: typeof this.orientation()?.lock === 'function' });
  }

  /** The menu's words under the entry. */
  get summary(): string {
    return FullscreenHelper.describe(this.active, this.locksOrientation);
  }

  /** Begin following the page's fullscreen changes. Idempotent. */
  start(): void {
    if (this.watching) return;
    this.watching = true;
    this.activeSubject.next(this.active);
    this.zone.runOutsideAngular(() => {
      document.addEventListener('fullscreenchange', this.onChange);
      document.addEventListener('webkitfullscreenchange', this.onChange);
    });
  }

  /** Leave fullscreen (and the orientation lock with it) and stop listening. Safe to call twice. */
  stop(): void {
    if (!this.watching) return;
    this.watching = false;
    document.removeEventListener('fullscreenchange', this.onChange);
    document.removeEventListener('webkitfullscreenchange', this.onChange);
    if (this.active) void this.exit();
    this.unlockOrientation('page left');
  }

  /**
   * Go fullscreen if the page is not, leave it if it is. Called from the tap on the menu entry and
   * before anything is awaited: a fullscreen request needs the user activation the tap carries.
   */
  async toggle(): Promise<FullscreenOutcome> {
    return this.active ? this.exit() : this.enter();
  }

  async enter(): Promise<FullscreenOutcome> {
    const doc = this.doc();
    if (!FullscreenHelper.supported(doc)) {
      this.diagnostics.log('platform', 'fullscreen: not supported here');
      return 'unsupported';
    }
    try {
      // The standard call returns a promise; WebKit's prefixed one returns nothing, and awaiting nothing is fine.
      if (typeof doc.documentElement.requestFullscreen === 'function') await doc.documentElement.requestFullscreen({ navigationUI: 'hide' });
      else await doc.documentElement.webkitRequestFullscreen?.();
    } catch (error) {
      this.diagnostics.log('platform', 'fullscreen: refused', () => ({ error }));
      return 'refused';
    }
    this.diagnostics.log('platform', 'fullscreen: entered');
    await this.lockOrientation();
    return 'entered';
  }

  async exit(): Promise<FullscreenOutcome> {
    const doc = this.doc();
    try {
      if (typeof doc.exitFullscreen === 'function') await doc.exitFullscreen();
      else await doc.webkitExitFullscreen?.();
    } catch (error) {
      // Nothing was fullscreen, or the document is not active: the state the caller wanted already holds.
      this.diagnostics.log('platform', 'fullscreen: exit refused', () => ({ error }));
    }
    this.unlockOrientation('exit requested');
    return 'exited';
  }

  private async lockOrientation(): Promise<void> {
    const orientation = this.orientation();
    if (!FullscreenHelper.shouldLockOrientation({ coarsePointer: this.coarsePointer(), canLock: typeof orientation?.lock === 'function' })) return;
    try {
      await orientation!.lock!('landscape');
      this.orientationLocked = true;
      this.diagnostics.log('platform', 'orientation: locked to landscape');
    } catch (error) {
      // Chromium allows it in fullscreen and an installed app; anything else says no. Not a failure of fullscreen.
      this.diagnostics.log('platform', 'orientation: lock refused', () => ({ error }));
    }
  }

  private unlockOrientation(why: string): void {
    if (!this.orientationLocked) return;
    this.orientationLocked = false;
    try {
      this.orientation()?.unlock?.();
      this.diagnostics.log('platform', 'orientation: unlocked', () => ({ why }));
    } catch (error) {
      this.diagnostics.log('platform', 'orientation: unlock failed', () => ({ error }));
    }
  }

  private readonly onChange = (): void => {
    const active = this.active;
    this.diagnostics.log('platform', 'fullscreen: changed', () => ({ active, width: window.innerWidth, height: window.innerHeight }));
    // However fullscreen ended (Esc, the system Back gesture), the lock it came with ends too.
    if (!active) this.unlockOrientation('fullscreen ended');
    // A rare event, and the menu's words depend on it: tell the zone.
    this.zone.run(() => this.activeSubject.next(active));
  };
}
