import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { InstallHelper, InstallMode } from '../../helpers/install.helper';
import { DiagnosticsService } from './diagnostics.service';

/** What Chromium's `beforeinstallprompt` event carries; it is not in the standard or in the TypeScript DOM typings. */
export interface BeforeInstallPromptEventLike extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

/**
 * Whether, and how, this visit can become an installed app: the one place that knows.
 *
 * **It lives in the main bundle and starts with the app, not with the game page.** Chromium fires
 * `beforeinstallprompt` once, early, whichever page happens to be open; a listener added by a lazy
 * page that loads a few seconds later has missed it. The event is held (its default, the browser's
 * own mini-bar, is cancelled), and `prompt()` is shown when the person asks, from the menu or from
 * the one-time banner. An event can be used once; a dismissed prompt is dropped, and Chromium fires
 * a new event after its own cool-down, which this picks up.
 *
 * **Where there is no prompt (iOS, iPadOS) the answer is a how-to**, which the page shows as a
 * dialog: the share sheet is the only way, and the dialog says the thing that matters more than the
 * steps, that an app on the Home Screen keeps its own storage and the saves made in the browser are
 * not in it (see {@link InstallHelper.iosHowTo}). Nothing is offered when the app is already running
 * installed (the `display-mode` media query and `navigator.standalone`), or has just been
 * (`appinstalled`).
 *
 * The listeners last as long as the page: they are not a room's, and the root service has no
 * `clear()` on purpose, like the relay-health service. The manifest decisions this goes with
 * (`id`, the maskable icon, the colours) are in CLAUDE.md. It logs into the diagnostics log under
 * `platform`.
 */
@Injectable({
  providedIn: 'root'
})
export class InstallService implements OnDestroy {
  private deferred: BeforeInstallPromptEventLike | null = null;
  private justInstalled = false;
  private readonly modeSubject: BehaviorSubject<InstallMode>;
  private displayQuery: MediaQueryList | null = null;

  /** The mode, once per change. */
  readonly mode$: Observable<InstallMode>;

  constructor(private zone: NgZone, private diagnostics: DiagnosticsService) {
    // The app can be installed from the browser's own menu and then open in its own window: the page
    // is standalone without having reloaded, so the display mode is watched and not just read once.
    // Only `standalone`: `fullscreen` also matches the "Tela cheia" of a browser tab (see InstallHelper).
    this.displayQuery = typeof matchMedia === 'function' ? matchMedia('(display-mode: standalone)') : null;
    this.modeSubject = new BehaviorSubject<InstallMode>(this.compute());
    this.mode$ = this.modeSubject.asObservable();
    this.zone.runOutsideAngular(() => {
      window.addEventListener('beforeinstallprompt', this.onBeforeInstallPrompt);
      window.addEventListener('appinstalled', this.onInstalled);
      this.displayQuery?.addEventListener?.('change', this.onDisplayModeChange);
    });
    this.diagnostics.log('platform', 'install: service started', () => ({ mode: this.modeSubject.value, userAgentIsIos: this.isIos() }));
  }

  /** A root service lives as long as the page; this is for a spec, which would otherwise leave listeners on the karma page. */
  ngOnDestroy(): void {
    window.removeEventListener('beforeinstallprompt', this.onBeforeInstallPrompt);
    window.removeEventListener('appinstalled', this.onInstalled);
    this.displayQuery?.removeEventListener?.('change', this.onDisplayModeChange);
  }

  /** Where `navigator` comes from; a spec overrides the facts it reads. */
  protected isStandalone(): boolean {
    return InstallHelper.isStandalone({
      displayStandalone: this.displayQuery?.matches ?? false,
      navigatorStandalone: (navigator as { standalone?: boolean }).standalone,
    }) || this.justInstalled;
  }

  protected isIos(): boolean {
    return InstallHelper.isIos({
      userAgent: navigator.userAgent ?? '',
      platform: navigator.platform ?? '',
      maxTouchPoints: navigator.maxTouchPoints ?? 0,
    });
  }

  get mode(): InstallMode {
    return this.modeSubject.value;
  }

  /**
   * Show the browser's install prompt. Only valid in `prompt` mode, and from a tap (the prompt needs
   * the user activation, so nothing is awaited before this). The event is spent either way.
   */
  async prompt(): Promise<InstallOutcome> {
    const event = this.deferred;
    if (!event) return 'unavailable';
    this.deferred = null;
    this.publish();
    try {
      await event.prompt();
      const choice = await event.userChoice;
      this.diagnostics.log('platform', 'install: prompt answered', () => ({ outcome: choice.outcome }));
      return choice.outcome;
    } catch (error) {
      this.diagnostics.log('platform', 'install: prompt failed', () => ({ error }));
      return 'unavailable';
    }
  }

  private compute(): InstallMode {
    return InstallHelper.mode({ standalone: this.isStandalone(), hasPrompt: this.deferred !== null, ios: this.isIos() });
  }

  private publish(): void {
    const mode = this.compute();
    if (mode === this.modeSubject.value) return;
    this.diagnostics.log('platform', 'install: mode changed', () => ({ from: this.modeSubject.value, to: mode }));
    this.zone.run(() => this.modeSubject.next(mode));
  }

  private readonly onBeforeInstallPrompt = (event: Event): void => {
    // The browser's own mini-bar is cancelled: the offer is the menu entry and the one-time banner.
    event.preventDefault();
    this.deferred = event as BeforeInstallPromptEventLike;
    this.diagnostics.log('platform', 'install: prompt available');
    this.publish();
  };

  private readonly onInstalled = (): void => {
    this.deferred = null;
    this.justInstalled = true;
    this.diagnostics.log('platform', 'install: app installed');
    this.publish();
  };

  private readonly onDisplayModeChange = (): void => {
    this.publish();
  };
}
