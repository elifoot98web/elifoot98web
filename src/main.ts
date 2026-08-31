import { enableProdMode, provideZoneChangeDetection } from '@angular/core';
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';

import { AppModule } from './app/app.module';
import { environment } from './environments/environment';

if (environment.production) {
  enableProdMode();
}

/**
 * `provideZoneChangeDetection()` is REQUIRED here, not optional.
 *
 * Angular 21 flipped the default: `PlatformRef.bootstrapModuleFactory` now prepends
 * `provideZonelessChangeDetectionInternal()` to the application providers, which binds
 * `NgZone` to `NoopNgZone`. Nothing warns about this — the build succeeds, lint passes, the
 * app boots, and change detection simply stops firing for everything Zone.js used to catch.
 * That is most of this app: the load detector polls `dosCI.screenshot()` on an interval,
 * the auto-saver ticks every 1.5s, and every multiplayer update arrives on a WebRTC data
 * channel callback. None of those would repaint.
 *
 * It has to be passed as `applicationProviders` rather than in `AppModule.providers` —
 * Angular rejects it inside an NgModule's provider array. Because `applicationProviders`
 * are appended after the internal zoneless providers, this overrides them, and it does not
 * trip the "both provideZoneChangeDetection and provideZonelessChangeDetection are
 * provided" warning, because the internal provider deliberately does not set the
 * `PROVIDED_ZONELESS` token that warning checks.
 *
 * `zone.js` therefore still has to stay in `src/polyfills.ts`. Adopting zoneless properly
 * is real work — every async-driven update needs a signal or an explicit `markForCheck()` —
 * and deserves to be a deliberate change, not a side effect of a version bump.
 */
platformBrowserDynamic().bootstrapModule(AppModule, {
  applicationProviders: [provideZoneChangeDetection()]
})
  .catch(err => console.log(err));
