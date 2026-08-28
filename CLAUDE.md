# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Elifoot 98 Online — an Angular 19 + Ionic 8 PWA that runs the 1998 football manager game Elifoot 98
in the browser. Elifoot 98 is a **16-bit Windows 3.1 application**, so the stack is: js-dos (DOSBox
compiled to WebAssembly) → Windows 3.1 (shipped inside the game bundle) → `ELIFOOT.EXE`. All
user-facing strings are Brazilian Portuguese; keep new UI text in pt-BR.

Live at https://www.elifoot98.com.br (GitHub Pages).

## Commands

```bash
npm install              # first time only
npm start                # ng serve → http://localhost:4200
npm run build            # production build (default configuration) → www/
npm run build:githubpages # what CI deploys
npm run lint             # ng lint (eslint, src/**/*.ts + src/**/*.html)
npm test                 # ng test (karma + jasmine, Chrome, watch mode)
npx ng test --include='**/my.spec.ts' --watch=false   # single spec
```

There are currently **zero `.spec.ts` files** in the repo; the karma/jasmine harness is configured
but unused.

Git LFS is required: `*.jsdos` is LFS-tracked (`src/assets/elifoot/elifoot98.jsdos`, ~6.7 MB holding
the entire Windows 3.1 + game environment). Without LFS the game bundle is a pointer file and the app
will not boot.

### Version-stamping gotcha

Every `build*` script runs `prebuild` → `scripts/version-config.js`, which uses `replace-in-file` to
**mutate `src/environments/environment*.ts` in place**, substituting `%VERSION%`, `%BUILD_DATE%`,
`%COMMIT_HASH%`. After a local build those files are dirty with real values — restore the
placeholders (`git checkout src/environments`) before committing. The commit hash comes from
`LAST_COMMIT_SHA`, set by `.github/actions/prepare-sha` in CI (`unknown` locally).

### CI / release

- PRs to `main` fail unless `package.json` `version` changed (`check-version-update-pull-request.yml`).
- Push to `main` → build `githubpages` config, deploy to GitHub Pages, push a `v<version>` tag.
- Push to the `firebase` branch → Firebase Hosting (project `elifoot-98`); PRs also get preview channels.

## Architecture

### Module style

NgModule-based, **not** standalone: every component declares `standalone: false` and
`@angular-eslint/prefer-standalone` is disabled. Routing uses `useHash: true` with two lazy modules:
`/main` (landing card) and `/game` (everything else). ESLint enforces the `app` selector prefix and
`Page`/`Component` class suffixes.

### The Angular ↔ js-dos bridge

js-dos is **vendored, not an npm dependency**: `src/assets/js-dos/` (js-dos.js, wdosbox.wasm) is
loaded by plain `<script>` tags in [index.html](src/index.html), which also loads `elifootweb.js` —
the bundle name `angular.json` gives [src/scripts/game.js](src/scripts/game.js) (`inject: false`, so
the tag is hand-written).

`game.js` exposes four browser globals, typed for TypeScript in
[src/scripts/game.d.ts](src/scripts/game.d.ts) and called directly from Angular services:

- `elifootMain(pathPrefix, gameBundleURL)` — creates the DOS instance in `#game-container`, runs the
  bundle, resolves the command interface (`dosCI`); rejects after 15 s.
- `saveGameFileSystem()` — `dosInstance.layers.save()`, i.e. flush changed FS to IndexedDB.
- `toggleSoftKeyboard()` — shows/hides the js-dos `.emulator-keyboard` div.
- `dosInstance` — the raw js-dos instance, needed by `PatchService` for `emulatorsUi.persist`.

[src/app/core/typings/jsdos.d.ts](src/app/core/typings/jsdos.d.ts) is a hand-maintained typing of the js-dos
command interface (`DosCI`) — screenshot, key/mouse injection, `persist()`, `readMemory`,
`writeMemory`. `GamePage.dosCI` is `any` and gets threaded into every service as a parameter; there
is no singleton holding it.

### Inside the .jsdos bundle / boot chain

`src/assets/elifoot/elifoot98.jsdos` is a zip containing `hdd.img` (26 MB FAT image with Windows 3.1),
a `d/` directory tree (the game in `d/eli98/`, plus `d/ELIFOOT.BAT`), and `.jsdos/dosbox.conf`. Boot
sequence, all automatic:

1. `dosbox.conf` `[autoexec]`: `mount d ./d`, `imgmount c ./hdd.img`, `c:`, `autoexec.bat`.
2. `C:\AUTOEXEC.BAT` (inside the image) calls `D:\ELIFOOT.BAT`.
3. `D:\ELIFOOT.BAT` runs `CALL D:\PATCH.BAT`, then `win D:\ELI98\ELIFOOT.EXE` — Windows 3.1 starts
   with the game as its only program.

So DOS-level work (the patch file copies) happens *before* Windows loads, and everything the user
sees is Windows 3.1 rendering the 16-bit app.

### Persistence model

js-dos keeps the *changed* portion of the virtual disk as a zip inside IndexedDB databases named
`js-dos-cache*`. `dosCI.persist()` dumps that zip; `saveGameFileSystem()` writes it back. Everything
the app reads or writes lives under the mounted `d/` tree: game in `d/eli98/`, save games in
`d/eli98/jogos/*.e98` (`BASE_SAVEGAME_DIR`). Clearing data means deleting those IndexedDB databases
([save-game.service.ts](src/app/core/services/game/save-game.service.ts)) plus the Ionic Storage keys.

### Patching (the central trick)

[patch.service.ts](src/app/core/services/game/patch.service.ts) modifies the virtual disk without any guest-side
file API: it builds a `JSZip` of the desired changed-FS, then hands `emulators-ui` a **fake command
interface** whose `persist()` returns that zip, and calls
`dosInstance.emulatorsUi.persist.save(bundleName, dosInstance.layers, fakeCI)` — overwriting the
IndexedDB cache. The caller then forces `window.location.reload()` so the VM boots from the patched disk.

Team/flag patches also install two batch files from `src/assets/elifoot/`: the overridden
`d/ELIFOOT.BAT` calls `d/PATCH.BAT` before launching Windows, and `PATCH.BAT` copies
`d/eli98/PATCH/{EQUIPAS,FLAGS,CTRGROUP,COUNTRY.TXE}` over the originals at the DOS prompt. Uploaded
patch zips are flattened/validated in `processPatchFile()` (needs ≥34 `.EFT` team files).

### Screen-scraping instead of emulator events

Two flows read the framebuffer because js-dos exposes no game-level state (and the guest is a 16-bit
Windows app, so there is nothing to hook):

- **Load detection** — `GamePage.loadGame()` polls `dosCI.screenshot()` every 500 ms and samples four
  hardcoded pixels for the game's green background (tolerance 25). Note this waits for the *game's*
  screen, i.e. it also covers the DOS + Windows 3.1 boot time. Failures increment
  `STORAGE_KEY.FAIL_COUNT`; after 3 the user is offered a reload or full data wipe.
- **Auto-save** — [auto-saver.service.ts](src/app/core/services/game/auto-saver.service.ts) ticks every 1.5 s
  and [emulator-control.service.ts](src/app/core/services/game/emulator-control.service.ts) OCRs a fixed
  rectangle (`EMULATOR_CONTROL_CONFIG.DEFAULT_AREA_OF_INTEREST`) with tesseract.js (`por` model)
  looking for "a gravar o jogo…" via sliding-window Levenshtein distance. When the game finishes its
  own save, the VM is persisted so progress survives a browser reload.

Both are coordinate- and color-sensitive: changing the emulator canvas size, the Windows 3.1 video
mode/resolution, or the game's language will silently break them. Constants live in
[constants.ts](src/app/core/models/constants.ts).

### Multiplayer (watch-together, not play-together)

A host streams its own canvas to spectators over WebRTC; guests watch, chat and move a shared
cursor. **A guest has no emulator and cannot play.** That asymmetry drives the whole design and
most of the user-facing copy. Transport is [trystero](https://github.com/dmotz/trystero) (P2P,
`appId` + room name + optional password, TURN creds in `environment.multiplayerConfig`), so no
game traffic touches a server of ours.

The full design record — findings, decisions, five phases, and as-built deviations — is
[docs/multiplayer-ux-study.md](docs/multiplayer-ux-study.md). Read it before changing behaviour
here; several obvious-looking "improvements" are things it explicitly rejected, with reasons.

Services in `src/app/core/services/multiplayer/`, all `providedIn: 'root'`:
`multiplayer.service.ts` orchestrates the room lifecycle and owns `gameStateSubject`; the rest
(`-stream`, `-chat`, `-cursor`, `-player-info`, `-identity`, `-ui`) are set up and cleared by it.
Every one exposes `clear()`, and `leaveRoom()` calls all of them.

Load-bearing invariants — each of these was a bug once:

- **Host identity comes from the stream, never from a claim.** `hostPeerId$` on
  `multiplayer-stream.service.ts` is set to whichever peer delivered a video track (first one
  wins). `PlayerIdentMessage.host` still exists on the wire but is `@deprecated` and read by
  nothing: it was forgeable, so a spectator with devtools could take the badge and end the room
  by leaving. Roles are stamped onto the roster from `hostPeerId$` via `setHostPeer`.
- **`playerList$` is presence; `knownPlayers$` is history.** The roster and headcount must show
  who is *here*; the chat transcript must keep naming people after they leave. Resolving chat
  names from the live list collapsed a departed author's messages to a raw peer id.
- **`leaveRoom()` is synchronous on purpose** (see its docblock) and returns while trystero is
  still draining. Anything deferred must be guarded by `roomEpoch`, not just cleared — a fast
  rejoin can start a new room before an old timer fires.
- **`GameState` is a numeric enum with no explicit values.** Append members; inserting one
  silently renumbers every later member.
- **`#stream-target`'s border box must equal the visible picture exactly.** `OverlaySyncHelper`
  positions the cursor overlay from the video's `offset*`, and cursor coords normalise against
  `clientWidth`, so any letterbox bar *inside* the element offsets every remote cursor. The fit
  is computed in TypeScript (`fitVideoToContainer`) from the frame's **ratio**, deliberately not
  from its intrinsic pixels: WebRTC ramps its encoder up from a low resolution on every join, and
  intrinsic sizing made the picture visibly grow. The long comment in
  [join-game.page.scss](src/app/pages/join-game/join-game.page.scss) lists what must not be added.
- **A dropped host is not a departed host.** `onPeerLeave` for the host fires when *our* link
  drops, which is indistinguishable from the host leaving. Hence `HOST_RECONNECTING` plus a grace
  timer, copy that says we lost the connection, and a retry button — the grace period only
  recovers links trystero re-establishes itself, which it will not do when the break is local.
- **A spectator only ever joins from a fresh page load.** trystero keeps one connection per peer
  in a module-level registry that outlives any room (~2 min idle) and does not renegotiate media
  onto a connection that is already up: `pc.onnegotiationneeded` fires on the host and the offer
  never lands. A guest that rejoins within one page load therefore gets the data channel —
  ident, host announce, roster, chat, headcount, all instant and correct — and no video, then
  times out. So `leaveRoom` and the failed-join retry both go through
  `JoinGamePage.reloadSpectator`, which costs a spectator nothing (no emulator, no save state)
  while the code travels on the URL. The host page must *never* do this. Belt and braces on the
  other side: `MultiplayerStreamService.publishStream` wraps the tracks in a new `MediaStream`
  per add, because trystero caches a remote stream per sender-side stream object and would
  otherwise hand a returning peer its previous, dead one — a frozen picture presented as live.
  Measured residual: under rapid churn the first join after a reload often fails
  (`connection-failed`) and needs one retry.

Components in `src/app/core/components/multiplayer/` (plus `chat/`): `room-setup-modal` (owns
joining outright, including recent rooms), `multiplayer-panel` (the room's own window — code,
roster, share, leave; it absorbed a former participants modal), `participant-list` (shared by the
panel and the chat's contact strip), `room-status-pill` (the ambient code/lock/count indicator;
flat, not Win9x — see the scope rule below). The chat toggle floating over the game surface is
the **only** chat entry point, because it is the one control that exists at every breakpoint.


- [cheat-omatic.service.ts](src/app/core/services/game/cheat-omatic.service.ts) — a Cheat-Engine-style memory
  scanner over `readMemory`/`writeMemory`, sweeping the 8 MB address space in 1 MB chunks and
  narrowing matches across successive searches (`SearchState` machine, byte/word/dword/string type
  inference, saveable `0x…` addresses).
- [emulator-control.service.ts](src/app/core/services/game/emulator-control.service.ts) — also converts strings
  to DOSBox keycode sequences (`EmulatorKeyCodeHelper`, 30 ms between strokes) for the text-input dialog.
- [local-storage.service.ts](src/app/core/services/shared/local-storage.service.ts) — thin wrapper over
  `@ionic/storage-angular`; all keys in `STORAGE_KEY`.
- [layout-helper.service.ts](src/app/core/services/shared/layout-helper.service.ts) — two APIs
  for the same facts: synchronous `window.innerWidth/Height` getters (used by templates that are
  re-evaluated for other reasons, e.g. the F1–F12 formation buttons reversed in portrait), and
  `matchMedia`-backed observables (`isMobile$`, `isLandscape$`, `matches$(query)`) for anything
  that must appear or disappear *on rotation*, which the getters cannot do because nothing
  re-reads them. Observables are cached per query string, so one listener serves all subscribers.

### Retro visual identity (scope rule)

The Windows 95/98 vocabulary lives in [_win9x.scss](src/theme/_win9x.scss) — `:root`
tokens (`--win9x-face`, `--win9x-shadow`, `--win9x-field`, `--win9x-titlebar-bg`,
`--win9x-font`, `--win9x-hit-target`) plus `.win9x-element-border` / `-bevel`,
`.win9x-outer-window`, `.win9x-modal-container`, `.win9x-titlebar`, `.win9x-input`,
`.win9x-button`. It is loaded via `@use` as the **first statement** of
[global.scss](src/global.scss); `@use` must precede all other rules, so it cannot be moved
below the Ionic imports.

**The boundary: companion windows are Windows 95; the app shell stays Elifoot green.**
Retro treatment applies to the multiplayer chat panel, the room-setup dialog, the
multiplayer panel, the roster rows, the chat toggle, and the Cheat 'O Matic modal. It does
**not** apply to the page toolbars (`ion-toolbar color="tertiary"`), the landing cards, the
FAB clusters or the options popover — the navy `#092469` in
[variables.scss](src/theme/variables.scss) is close enough to `#000080` that shell and retro
windows read as deliberately related. A retro treatment without an explicit boundary reads
as a mistake rather than a choice.

The room status pill (`.mp-status-pill` in [global.scss](src/global.scss)) is on the shell
side of that line and is deliberately flat, not Win9x: it renders inside the page toolbars,
and half a retro toolbar reads as a bug. Its landscape instance rides the game surface but
keeps the same flat look, because one component changing identity by position is worse than
one that does not. Do not "fix" it by moving it into `_win9x.scss`.

Two gotchas the partial documents but are worth repeating:

- `.win9x-button` only renders correctly on an `ion-button` with `fill="clear"`; otherwise
  Ionic's shadow-encapsulated `.button-native` paints over the host.
- The 44px touch floor is **opt-in** via `.win9x-button--touch`. Applying it to
  `.win9x-button` itself grew the omatic modal's buttons enough to overflow it into a
  scrollbar. Authentic Win9x controls are ~16px tall.

`ion-toolbar ion-button` is deliberately **not** in the shared partial — that selector is
unqualified and would restyle toolbar buttons on every page, so it stays local to the
omatic modal.

### PWA

`@angular/service-worker` with [ngsw-config.json](ngsw-config.json) prefetching the game bundle and
lazily caching js-dos wasm. `AppComponent` watches `SwUpdate.versionUpdates`, records
`STORAGE_KEY.PENDING_UPDATE`, and applies updates by reloading (immediately or on next launch).

### Leftover scaffolding

`ionic.config.json` / `capacitor.config.ts` still carry the Ionic starter identity
(`Elifoot98Keygen`, `io.ionic.starter`) and there are no native platform folders — Capacitor is
unused; the target is the browser/PWA only.
