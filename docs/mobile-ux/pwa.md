# PWA

> Design record for this area, moved out of `CLAUDE.md` (2026-10-30/31). The first section is the VERIFIED summary of the
> invariants (each checked against the code at the time by an independent pass); the second is the verbatim record written phase
> by phase while the area was built. The plan and the as-built history are in [../mobile-ux-study.md](../mobile-ux-study.md); what only
> real phones can confirm is in [../mobile-ux-device-pass.md](../mobile-ux-device-pass.md).

## Invariants (verified summary)

`@angular/service-worker` with [ngsw-config.json](../../ngsw-config.json), enabled only outside dev mode (test it on a production build) and registered `registerWhenStable:30000`, which stays (the app is stable long before the emulator starts, so the worker registers within about a second). `AppComponent` watches `SwUpdate.versionUpdates`, sets `STORAGE_KEY.PENDING_UPDATE` on `VERSION_READY` and applies updates by reloading (now or on next launch).
- **The manifest's identity is pinned.** `id: "/"` (what Chrome derives from `start_url: "/#/main"`), `scope` and `start_url` stay as they are so installed copies keep their identity; `theme_color`/`background_color` are the game green `#008000` (a dark splash showed before the green app painted), `lang` is `pt-BR`; `index.html` carries `mobile-web-app-capable` beside the Apple spelling (Chromium warns about the Apple one alone) and `apple-mobile-web-app-title` (the label iOS prints under the icon instead of the long `<title>`).
- **No `orientation` and no `display_override` in the manifest (decision D4).** A lock would take portrait play from people who never asked; "Tela cheia" locks landscape as its own action, never the manifest.
- **Maskable icons** (`android-maskable-512-512.png`, `-192-192.png`) come from [scripts/pwa-icons/make-maskable.mjs](../../scripts/pwa-icons/make-maskable.mjs): the shipped 512 icon shrunk onto a canvas of its own green so the lettering stays inside the 40% safe-zone circle (under a round mask the old icon loses "ELIFOOT"/"WEBPLAY"). The ~110 older entries are left alone (the Windows tile sizes are Edge's). An installed copy changes icon only when the browser refreshes its manifest (Chrome updates a WebAPK's), otherwise on reinstall.
- **One online visit must be enough for the installed app to start offline.** The `app` group prefetches the shell and `assets/elifoot/**`; the `jsdos` group *prefetches* exactly five files, listed by name, never a `js-dos*` wildcard (it would drag in the 1.8 MB `js-dos.js.map` and `wdosbox.js.symbols`): `js-dos.js`, `js-dos.css`, `wdosbox.js`, `wdosbox.wasm`, the loader png. Why: js-dos starts `wdosbox.js` itself with `new Worker(...)`, it was once missing, and an uncached URL offline is a 504 that killed the emulator even on the second visit; it is prefetch, not lazy, because lazy caches only what the page asks for through the worker, which is nothing on a first visit. A new file js-dos fetches at runtime must be added to that list.
- **Icons are a `dataGroups` entry (`/svg/**`, cache-first), not an asset group.** Ionic fetches `ion-icon` files from `/svg/` at runtime (over a thousand in the build, about ten used) and an asset group would put them all in `ngsw.json`'s hash table. So an icon is cached only once it has been drawn online, from the second online visit on: a glyph that only an unopened panel draws can be a blank keycap offline (why `deck-keys.helper.ts` uses text faces there).
- **Release check after touching `ngsw-config.json`:** production build, serve over http on localhost (a worker needs localhost or https), load `/#/game`, wait for the worker to install, then *stop the server* (CDP's offline switch does not reach the worker's own fetches and can hide a gap) and cold-load `/#/game`: it must boot to the game with no failed request. Still not cached offline: the tesseract worker, core and model (jsDelivr, decision D5), so auto-save falls back to its periodic mode.
- **An update reload saves first.** The auto-saver persists only after it sees the game's own save, so a bare `location.reload()` threw away everything since, on every release's prompt. `AppComponent.installUpdate()` waits (at most `APP_UPDATE.IDLE_WAIT_MS`) for a game save the auto-saver saw in progress (a persist landing mid-write stores a truncated `.e98` over the last good one), awaits `saveGameFileSystem()` through `TimeoutHelper.withTimeout` and `APP_UPDATE.SAVE_TIMEOUT_MS`, calls `SaveStatusService.allowExit()` (no second "leave site?") and reloads **regardless**: a persist that hangs must not hold an update hostage, and cutting one short loses only what it was writing (one IndexedDB put). `saveGameFileSystem` is a no-op without an emulator, so the landing page and the launch-time install share the path.
- **A hosting browser is asked before "Instalar agora" reloads** (`MultiplayerService.isHosting` → the "Fechar a sala?" confirm), because a reload ends the room for every spectator; a spectator is not asked. "Atualizar depois" leaves `PENDING_UPDATE` set, so the next launch installs it before any room exists.
- **`AppComponent` reaches `MultiplayerService` through a dynamic `import()` plus `Injector`, never a constructor dependency.** A static import drags trystero out of the lazy game chunk into the main bundle every visitor downloads (free for a host: `/game` and `/join-game` already load that chunk). Do not "simplify" it into an injected service.
- Unverified on real devices (Galaxy A07, iPhone 15 Pro Max): the offline cold launch of the installed app, a real `VERSION_READY` update (dev mode has no worker, so only its handlers ran), `SAVE_TIMEOUT_MS` on a phone's persist time, and a first visit on a slow link (worker prefetch racing the page's own bundle download).

## Full record (verbatim)

> Written phase by phase. Where it disagrees with the summary above or with the code, those win: later phases changed some earlier facts
> (for example, which root services keep a `DosCI`, and that two-peer sessions at 640x480 were later run).

`@angular/service-worker` with [ngsw-config.json](../../ngsw-config.json). `AppComponent` watches
`SwUpdate.versionUpdates`, records `STORAGE_KEY.PENDING_UPDATE`, and applies updates by reloading
(immediately or on next launch).

**The manifest's decisions** ([manifest.webmanifest](../../src/manifest.webmanifest), [index.html](../../src/index.html)): `id: "/"` is what Chrome derives
from `start_url: "/#/main"` (the fragment is dropped), written down so that it cannot drift, and so the installed copies keep their identity;
`scope` and `start_url` are untouched for the same reason. `theme_color` and `background_color` are the game green `#008000` (they were
`#008200` and `#252329`, a dark splash before the green app painted; the `theme-color` metas were already `#008000`), `lang` is `pt-BR`.
**No `orientation` and no `display_override`** (decision D4: a lock would take portrait play from people who never asked; the "Tela cheia"
entry locks landscape as its own action, never the manifest). Two **maskable** icons were added beside the ~110 existing entries, which are
left alone (the Windows tile sizes are Edge's): `android-maskable-512-512.png` and `-192-192.png`, made from the shipped 512 launcher icon by
[scripts/pwa-icons/make-maskable.mjs](../../scripts/pwa-icons/make-maskable.mjs) (artwork shrunk to 0.66 on a canvas of its own green, so the lettering
sits inside the 40% safe-zone circle: 0.387 of the width from the centre at its farthest; the old icon under a circular mask loses the edges of
"ELIFOOT" and "WEBPLAY"). **An installed copy may change its icon** when the browser refreshes its manifest (Chrome updates a WebAPK's), and
otherwise on reinstall. `mobile-web-app-capable` was added beside the Apple spelling (Chromium warns about the Apple one alone) and
`apple-mobile-web-app-title` ("Elifoot 98", what iOS prints under the icon instead of the long `<title>`).

**One online visit is enough for the installed app to start offline, and that is a property to
keep.** The `app` group prefetches the shell and `assets/elifoot/**` (the bundle), and the `jsdos`
group *prefetches* exactly five files: `js-dos.js`, `js-dos.css`, `wdosbox.js`, `wdosbox.wasm`
and the loader png. They are listed by name, not by a `js-dos*` wildcard, so neither the 1.8 MB
`js-dos.js.map` nor `wdosbox.js.symbols` can ride along. `wdosbox.js` is the one that was
missing: js-dos starts it with `new Worker(pathPrefix + 'wdosbox.js')`, no wildcard matched it,
and the service worker answers an uncached URL offline with a 504, so even a second visit left
the emulator dead at "Unable to download 'assets/js-dos/wdosbox.js', code: 504". It is also why
the group is prefetch and not lazy: lazy only caches what the page asks for *through* the worker,
which is nothing on the first visit. Icons are a `dataGroups` entry (`/svg/**`, cache-first),
not an asset group: Ionic fetches `ion-icon name=…` files at runtime from `/svg/` (1,356 files,
5.3 MB in the build, about ten used), an asset group would list all of them in `ngsw.json`'s hash
table, and the data group caches what is actually requested, from the second online visit on.
**Release check:** build, serve over http (a service worker needs localhost or https), load
`/#/game`, wait for it to install, then *stop the server* (CDP's offline switch does not reach
the worker's own fetches, so it can hide a gap in the cache) and cold-load `/#/game`: it must
boot to the game with no failed request. Still not cached offline: the tesseract worker, core
and model (jsDelivr, decision D5), so auto-save falls back to its periodic mode.

`registerWhenStable:30000` stays. The worry was that a reload loop would never let the worker
register; measured on a production build with a direct `/#/game` load, it registers 0.3 s after
load at normal speed and 0.9 s at 6x CPU throttling, with the prefetch complete at 1.3 s and
1.7 s, because the application is stable long before the emulator starts. The bundle is requested
once on a first visit, not twice. What was not measured is a first visit on a slow link, where
the worker's prefetch and the page's own download could compete (CDP throttling does not reach
the worker).

**An update reload saves first, and a hosting browser is asked before it reloads.** The
auto-saver persists only after it sees the game's own save, so everything since then lives in
memory and a bare `location.reload()` threw it away, on every release's update prompt.
`installUpdate()` therefore awaits the global `saveGameFileSystem()` (a no-op without an
emulator, so the landing page and the launch-time install share the path) through
`TimeoutHelper.withTimeout` and `APP_UPDATE.SAVE_TIMEOUT_MS`, logs a failure or a timeout, and
reloads regardless: a persist that hangs must not be able to hold an update hostage. Before it writes it
waits (at most `APP_UPDATE.IDLE_WAIT_MS`) for a game save the auto-saver has seen in progress, and it calls
`SaveStatusService.allowExit()` so the game page's "leave site?" prompt does not ask a second time. Cutting a
persist short loses only what it was writing, because the write is one IndexedDB put. "Instalar
agora" first asks `MultiplayerService.isHosting` and, for a host, shows a confirm because a
reload ends the room for every spectator; "Atualizar depois" leaves `PENDING_UPDATE` set, so the
next launch installs it before any room exists. A spectator is not asked: it has nothing to lose.
`AppComponent` reaches `MultiplayerService` through a dynamic `import()` plus `Injector`, not a
constructor dependency: a static import drags trystero out of the lazy game chunk into the main
bundle every visitor downloads. The import is free for a host, because `/game` and `/join-game`
already load that chunk. Do not "simplify" it into an injected service.
