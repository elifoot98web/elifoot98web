import { Injectable } from '@angular/core';
import { distinctUntilChanged, fromEvent, map, Observable, shareReplay, startWith } from 'rxjs';

/** The one breakpoint this app has. Kept in sync with `isMobile` below. */
const MOBILE_MAX_PX = 768;

@Injectable({
  providedIn: 'root'
})
export class LayoutHelperService {
  private queries = new Map<string, Observable<boolean>>();

  constructor() {}

  get isLandscape(): boolean {
    return window.innerWidth > window.innerHeight
  }

  get isPortrait(): boolean {
    return !this.isLandscape
  }

  get isMobile(): boolean {
    return (this.isLandscape && window.innerHeight < MOBILE_MAX_PX) || window.innerWidth < MOBILE_MAX_PX
  }

  get isDesktop(): boolean {
    return !this.isMobile
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
}
