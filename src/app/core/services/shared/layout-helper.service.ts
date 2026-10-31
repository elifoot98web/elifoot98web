import { Injectable } from '@angular/core';
import { distinctUntilChanged, fromEvent, map, Observable, shareReplay, startWith } from 'rxjs';
import { LayoutShape, LayoutShapeHelper, LayoutViewport } from '../../helpers/layout-shape.helper';

/** The viewport width below which a modal gets its phone layout. Kept in sync with `isMobile` below. */
const MOBILE_MAX_PX = 768;

/**
 * What the page is shaped like and what the device is touched with, as two separate questions.
 *
 * `isMobile` used to answer both, and answered neither well: a 1366x768 laptop window (650 px
 * tall) was "mobile landscape" and lost its header, and a tablet was a phone or a desktop depending
 * on whether Safari's own toolbar was showing. It is kept, because the modals still pick their
 * phone layout from a viewport width, but nothing that decides the page's layout reads it any more:
 *
 * - **the shape** (`shape`, `shape$`, `viewport$`): portrait, landscape-compact or landscape-regular
 *   (LayoutShapeHelper). It decides the header and how the control deck is presented.
 * - **the input** (`isTouchPrimary$`, `anyCoarse$`): `(pointer: coarse)` is the PRIMARY pointer, the
 *   one the device is used with, and `(any-pointer: coarse)` is whether any of them is a finger. An
 *   iPad or a phone is the first; a laptop with a touch screen is only the second; a convertible
 *   with its keyboard folded away changes from one to the other, which is why these are streams.
 *
 * Two APIs for the same facts, as before: synchronous getters over `window` for markup that is
 * re-evaluated anyway, and `matchMedia`-backed observables for anything that must appear or
 * disappear on rotation, which the getters cannot do because nothing re-reads them.
 */
@Injectable({
  providedIn: 'root'
})
export class LayoutHelperService {
  private queries = new Map<string, Observable<boolean>>();
  private viewportStream?: Observable<LayoutViewport>;

  constructor() {}

  get isLandscape(): boolean {
    return window.innerWidth > window.innerHeight
  }

  get isPortrait(): boolean {
    return !this.isLandscape
  }

  /** A viewport under 768 px, or a landscape one under 768 tall. For modal content; not for the page's layout (see `shape`). */
  get isMobile(): boolean {
    return (this.isLandscape && window.innerHeight < MOBILE_MAX_PX) || window.innerWidth < MOBILE_MAX_PX
  }

  get isDesktop(): boolean {
    return !this.isMobile
  }

  /** The shape of the page right now. */
  get shape(): LayoutShape {
    return LayoutShapeHelper.of(window.innerWidth, window.innerHeight)
  }

  /** A finger is the primary pointer, right now. */
  get isTouchPrimary(): boolean {
    return window.matchMedia('(pointer: coarse)').matches
  }

  /**
   * Reactive counterpart to the getters above.
   *
   * The getters are plain synchronous measurements, so a template only re-reads them when
   * change detection happens to run — fine for markup that is already being re-evaluated
   * for another reason, useless for anything that has to appear or disappear on rotation.
   * These emit instead.
   *
   * Instances are shared per query string: a `matchMedia` listener per subscriber would
   * mean several of them firing for one rotation.
   */
  matches$(query: string): Observable<boolean> {
    const existing = this.queries.get(query);
    if (existing) return existing;

    const mediaQuery = window.matchMedia(query);
    const observable = fromEvent<MediaQueryListEvent>(mediaQuery, 'change').pipe(
      map(event => event.matches),
      startWith(mediaQuery.matches),
      distinctUntilChanged(),
      // refCount stays false: the map caches these for the app's lifetime, so tearing the
      // listener down on the last unsubscribe would leave a dead observable in the cache.
      shareReplay({ bufferSize: 1, refCount: false })
    );

    this.queries.set(query, observable);
    return observable;
  }

  /** Emits on every rotation. */
  get isLandscape$(): Observable<boolean> {
    return this.matches$('(orientation: landscape)');
  }

  /**
   * Mirrors `isMobile`: a phone-sized viewport in either orientation. `max-height` covers
   * the landscape case, where width alone would call a 844x390 phone a desktop.
   */
  get isMobile$(): Observable<boolean> {
    return this.matches$(`(max-width: ${MOBILE_MAX_PX - 1}px), (max-height: ${MOBILE_MAX_PX - 1}px)`);
  }

  /** `(pointer: coarse)`: a finger is how this device is used. The control deck's automatic mode follows it. */
  get isTouchPrimary$(): Observable<boolean> {
    return this.matches$('(pointer: coarse)');
  }

  /** `(any-pointer: coarse)`: some pointer of this device is a finger, even if it is not the primary one. */
  get anyCoarse$(): Observable<boolean> {
    return this.matches$('(any-pointer: coarse)');
  }

  /**
   * The window the page is laid out in, once per change. Listeners exist only while something is
   * subscribed. What it reports is LayoutShapeHelper.settle's answer, not the raw `innerHeight`:
   * on a touch device a window that shrank to half its height while a field has the focus is the
   * OS keyboard, and the layout does not move for it.
   */
  get viewport$(): Observable<LayoutViewport> {
    this.viewportStream ??= new Observable<LayoutViewport>(subscriber => {
      let current: LayoutViewport | null = null;
      const read = () => {
        const reported = { width: window.innerWidth, height: window.innerHeight };
        const settled = LayoutShapeHelper.settle(current, reported, this.isTouchPrimary && LayoutHelperService.editableFocused());
        if (current && LayoutShapeHelper.sameViewport(current, settled)) return;
        current = settled;
        subscriber.next(settled);
      };
      read();
      window.addEventListener('resize', read);
      window.addEventListener('orientationchange', read);
      return () => {
        window.removeEventListener('resize', read);
        window.removeEventListener('orientationchange', read);
      };
    }).pipe(shareReplay({ bufferSize: 1, refCount: true }));
    return this.viewportStream;
  }

  /** The shape of the page, once per change. */
  get shape$(): Observable<LayoutShape> {
    return this.viewport$.pipe(
      map(viewport => LayoutShapeHelper.of(viewport.width, viewport.height)),
      distinctUntilChanged()
    );
  }

  /** Whether a text field (the OS keyboard's reason to exist) has the focus. */
  private static editableFocused(): boolean {
    const active = document.activeElement as HTMLElement | null;
    if (!active) return false;
    return active.isContentEditable
      || active instanceof HTMLInputElement
      || active instanceof HTMLTextAreaElement
      || active instanceof HTMLSelectElement
      || /^ION-(INPUT|TEXTAREA|SELECT)$/.test(active.tagName);
  }
}
