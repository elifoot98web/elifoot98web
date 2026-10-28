# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Elifoot 98 Online — an Angular 21 + Ionic 9 PWA that runs the 1998 football manager game Elifoot 98
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
npm test                 # ng test (karma + jasmine, visible Chrome, watch mode)
npm run test:ci          # ng test --watch=false --browsers=ChromeHeadlessCI: one headless run, exits non-zero on failure
npx ng test --include='**/my.spec.ts' --watch=false --browsers=ChromeHeadlessCI   # single spec
npm run mp:launch        # two browsers for a multiplayer session (see the harness README)
python3 scripts/resolution/build_bundle.py verify src/assets/elifoot/elifoot98.jsdos   # the resolution switch is in the bundle
```

Specs are karma + jasmine. The builder globs `**/*.spec.ts` (its `include` option, which is also
what `--include` overrides); [src/test.ts](src/test.ts) only initialises the TestBed and
`tsconfig.spec.json` type-checks `src/**/*.spec.ts`, so a spec needs no registration but must live
under `src/` to be type-checked. Nothing in a spec reaches the bundle. There are **twenty-six spec files so
far**. [room-code.helper.spec.ts](src/app/core/helpers/room-code.helper.spec.ts) is there as
much to prove the harness as to cover `RoomCodeHelper`: `ng test` with **zero** specs
prints `Executed 0 of 0 SUCCESS` and still exits 1, so a `test:ci` could never pass before the
first spec existed. [timeout.helper.spec.ts](src/app/core/helpers/timeout.helper.spec.ts) is the
first to use a fake clock, and shows the one trap in doing so: Angular's `fakeAsync` drains
whatever timers are left when the body ends (`flush: true` is its default), which hides a timer
that was never cleared, so pass `{ flush: false }` whenever "nothing is left scheduled" is part
of what a spec asserts. [emulator-keycode.helper.spec.ts](src/app/core/models/game/emulator-keycode.helper.spec.ts)
(the text planner) and [guest-key-queue.service.spec.ts](src/app/core/services/game/guest-key-queue.service.spec.ts)
(the key queue, against a fake emulator that records every raw key event with the fake clock)
are the model for "a service that talks to the emulator": hand it a stub `DosCI`, never the real
one. [auto-saver.service.spec.ts](src/app/core/services/game/auto-saver.service.spec.ts) is the model
for "a loop that must survive its own failures": the collaborators are plain fakes cast to the
constructor's types, the clock is `fakeAsync`, and every spec ends with `stop()` so
`{ flush: false }` can prove nothing is left scheduled. One trap there: build a rejected promise
*inside* the fake (`outcomes()`), never up front, or it has no handler yet and fails the spec as
unhandled. [patch.service.spec.ts](src/app/core/services/game/patch.service.spec.ts) is the model for
"a service whose `Error` messages are the UI": the game page shows them verbatim, so the spec pins
the Portuguese wording and fails on the English that JSZip and HttpClient reject with; it also
pins `setDisplayMode` against a stand-in `dosInstance`, reading back the layer the fake CI would
write.
[diagnostics.service.spec.ts](src/app/core/services/shared/diagnostics.service.spec.ts) is the model for
"code that must cost nothing while it is off": the thunk spy that is never called, no listeners on the
real `window` (spied before the service exists), nothing on the fake clock, and a `finish()` that switches
the service off so a failing case cannot leave listeners on the karma page. Its doubles
([diagnostics.testing.ts](src/app/core/services/shared/diagnostics.testing.ts): `silentDiagnostics()`,
`recordingDiagnostics()`, `memoryStorage()`) are what every other spec passes where a service now takes
a `DiagnosticsService`; for "did it log this" the specs of the key queue and the auto-saver hand in a
two-line recorder that reads each data thunk at the call, as the real one does.
[win9x-palette.spec.ts](src/theme/win9x-palette.spec.ts) is the model for asserting CSS: karma loads
`src/global.scss`, so it probes the real `.win9x-roster-*` rules and `:root` tokens for contrast
instead of keeping a second copy of the hex values. [save-game.service.spec.ts](src/app/core/services/game/save-game.service.spec.ts)
is the model for "code that reads a browser store": karma's Chrome has a real IndexedDB, so the spec
builds `js-dos-cache (spec …)` databases shaped like js-dos's and deletes every `js-dos-cache*`
database before and after each case. Write specs for pure logic (helpers,
planners, parsers, queues driven by a fake clock); the emulator, the screen-scrapers and the WebRTC
paths have no karma coverage and are checked in a real browser (see the harness above). `ChromeHeadlessCI` in
[karma.conf.js](karma.conf.js) is `ChromeHeadless --no-sandbox`, which a CI runner or container
needs; plain `npm test` keeps the visible Chrome and the file watcher.

Multiplayer needs two or more peers to test at all, so that part is covered by a CDP-driven
browser harness in [scripts/multiplayer-harness/](scripts/multiplayer-harness/README.md) —
launcher, driver and the scenario checklist, plus the traps that silently invalidate a run (a
covered window throttles timers and stalls Ionic's overlay animations, which hangs the join
dialog). Read its README before doing multiplayer work by hand. Nothing in `scripts/` reaches
the bundle: `angular.json`'s inputs are all under `src/`.

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
  `dependabot[bot]` is exempt — it only edits dependency ranges and cannot bump `version`, so without
  that exemption none of its PRs could ever land.
- Push to `main` → build `githubpages` config, deploy to GitHub Pages, push a `v<version>` tag.
- Push to the `firebase` branch → Firebase Hosting (project `elifoot-98`); PRs also get preview channels.
- `lockfile-hygiene.yml` fails any PR whose `package-lock.json` resolves from a non-public registry.
- No workflow runs `npm run lint` or `npm run test:ci` (the Firebase PR workflow only builds), so specs
  and lint gate nothing on a PR until a job is added; run both locally before opening one.

### Dependency traps

Each of these cost a broken build or a rewritten history once. Bump `version` with
`npm version <v> --no-git-tag-version` so `package.json` and both lockfile version fields stay in
sync; hand-editing `package.json` leaves the lock stale.

- **The registry.** A committed `.npmrc` pins `registry.npmjs.org`, but an `NPM_CONFIG_REGISTRY`
  environment variable outranks it (npm's precedence is cli > env > project > user), and
  `npm config list` only reveals this as a quiet `; overridden by env`. On a machine that exports
  one, regenerate lockfiles with
  `env -u NPM_CONFIG_REGISTRY npm install --registry=https://registry.npmjs.org` or every `resolved`
  URL is rewritten to the mirror's hostname.
- **`.browserslistrc` is coupled to esbuild.** esbuild ≥0.25.12 refuses to transform destructuring
  for a `safari14.0` target rather than emit output it thinks is broken, and every current Angular
  line pins an esbuild past that boundary. The `Safari >=14.1` / `iOS >=14.5` floors are load-bearing:
  lowering them to `14` breaks the build with hundreds of errors. Raising them is a *product*
  decision — Angular 21 warns on every build that these floors fall outside its supported set
  (Chrome/Edge ≥111, Firefox ≥112, Safari/iOS ≥16.4). **That warning is expected and accepted**;
  the file explains why. Don't silence it without deciding to drop iPhone 7 and older.
- **`typescript` must be pinned with `~`, not `^`.** `@angular/compiler-cli` peers a TypeScript
  *range*, so a caret resolves the newest minor in it — which is generally one Angular does not build
  against yet.
- **`@ionic/angular-toolkit` and `@angular-eslint` track the Angular major** through their
  `@angular-devkit` dependency, and a caret floats them into the *next* major, nesting a second
  devkit tree beside the real one. Pin both with `~` to the line matching Angular.
- **`moduleResolution` must be `bundler`.** `node` predates the package `exports` field and cannot
  resolve subpath exports (`@angular/common/http`, `@ionic/angular/lazy`), failing with TS2307 from
  inside Angular's own `.d.ts` files.
- **`IonicModule` and the controllers come from `@ionic/angular/lazy`,** not `@ionic/angular` — Ionic 9
  flipped the default entry point to the standalone build. All importing files must move together, or
  `ModalController` lands in a different injector graph from `IonicModule`. That path is deprecated in
  favour of `provideIonicAngular()`, which does *not* require abandoning NgModules.
- **Four `overrides` exist because a dependency pins those versions exactly** and nothing else can move
  them. `less@^4.9.0` is the important one: it swapped `image-size` for optional `probe-image-size`,
  and `image-size` has no fixed version in existence. `qs` is there because `express`/`body-parser`
  pin `~6.15.1`, which excludes the patched 6.16.0 — the same shape of problem, different pinner.
  Re-check the overrides after every Angular bump — once Angular ships past a pin, the override
  silently holds the tree *back*.
- **`vite` advisories are inert only because the webpack `browser` builder is used.**
  `ng serve --force-esbuild`, or migrating to `@angular/build:application`, activates them; since
  `@angular/build` pins vite exactly, such a change must carry a `vite` override in the same PR.

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

`game.js` exposes five browser globals, typed for TypeScript in
[src/scripts/game.d.ts](src/scripts/game.d.ts) and called directly from Angular services:

- `elifootMain(pathPrefix, gameBundleURL, onProgress?)` — creates the DOS instance in
  `#game-container`, runs the bundle, resolves the command interface (`dosCI`). `onProgress(text)`
  gets js-dos's own loading text on every change, in English and unparsed (`BootProgressHelper`
  makes the pt-BR line). **Error contract:** it rejects with the real error from `Dos()`/`run()`,
  name and message untouched (a non-Error rejection keeps whatever `name`/`message` it carries),
  or with an Error named `JsdosTimeoutError` (carrying `lastProgress`) when js-dos goes 20 s
  without changing that text (60 s after the download completes) or one wait passes 120 s. A
  timeout ends the *wait*, not the boot: see *Booting the emulator* below.
- `saveGameFileSystem()` — `dosInstance.layers.save()`, i.e. flush changed FS to IndexedDB.
- `toggleSoftKeyboard()` — shows/hides the js-dos `.emulator-keyboard` div.
- `dosInstance` — the raw js-dos instance, needed by `PatchService` for `emulatorsUi.persist`.
- `getDosAudioNode()` — js-dos's own `ScriptProcessorNode`, or `null`. js-dos builds its
  `AudioContext` privately inside `run()`, so `game.js` wraps `AudioContext.prototype
  .createScriptProcessor` at load (before `elifootMain` can run) and keeps the one node created
  with no inputs and one output. That wrapper is the only patch to a global in the app; it
  exists for `MultiplayerAudioService` (see the audio invariant below).

[src/app/core/typings/jsdos.d.ts](src/app/core/typings/jsdos.d.ts) is a hand-maintained typing of the js-dos
command interface (`DosCI`) — screenshot, key/mouse injection, `persist()`, `readMemory`,
`writeMemory`. `GamePage.dosCI` is `any` and gets threaded into every service as a parameter; no
singleton owns it. The one root service that touches it for longer than a call is the key queue
(see *Typing into the guest*), and it keeps it only for the length of a job; `GamePage.ngOnDestroy`
cancels whatever is still queued.

### Inside the .jsdos bundle / boot chain

`src/assets/elifoot/elifoot98.jsdos` is a zip containing `hdd.img` (26 MB FAT image with Windows 3.1),
a `d/` directory tree (the game in `d/eli98/`, plus `d/ELIFOOT.BAT`), and `.jsdos/dosbox.conf`. Boot
sequence, all automatic:

1. `dosbox.conf` `[autoexec]`: `mount d ./d`, `imgmount c ./hdd.img`, `call d:\setres.bat`, `c:`,
   `autoexec.bat`.
2. `D:\SETRES.BAT` copies `d:\res\s640.ini` (or `s800.ini` when `d:\res\use800.flg` exists) over
   `C:\WINDOWS\SYSTEM.INI`, if the disk has the drivers those files name. That one file is the
   video mode, see *The guest's resolution*.
3. `C:\AUTOEXEC.BAT` (inside the image) calls `D:\ELIFOOT.BAT`.
4. `D:\ELIFOOT.BAT` runs `CALL D:\PATCH.BAT`, then `win D:\ELI98\ELIFOOT.EXE` — Windows 3.1 starts
   with the game as its only program.

So DOS-level work (the video mode, the patch file copies) happens *before* Windows loads, and
everything the user sees is Windows 3.1 rendering the 16-bit app.

### The guest's resolution

The guest boots at **640x480** (`screen-size=640` in `SYSTEM.INI`), the size Elifoot (a Delphi 1 app)
was designed for: its window is ~634x474, so it used to float on a green 800x600 desktop and now
fills the frame, which is a free 1.25x on every glyph. `use800.flg` returns a player to the old
800x600. Load-bearing:

- **The mode is set from `dosbox.conf`, never from `hdd.img`.** Every persisted layer carries its
  OWN full copy of `hdd.img` (a session always dirties it), and that copy shadows the bundle's, so
  a `SYSTEM.INI` edited inside the bundle's image reached new visitors only: measured, an edited
  bundle plus an old layer still booted 800x600. `dosbox.conf` and the files under `d/` are read
  from the bundle at every boot, which is why `SETRES.BAT` reaches everyone, including a layer
  holding `PatchService`'s overwritten `ELIFOOT.BAT`/`PATCH.BAT`. **The bundle URL must still never
  change** (the layer key is `<url>.changes`).
- **The bundle is rebuilt by [scripts/resolution/build_bundle.py](scripts/resolution/README.md)**
  (standard library only, deterministic, idempotent), which adds `call d:\setres.bat`,
  `d/SETRES.BAT`, `d/res/s640.ini` and `d/res/s800.ini` and copies every other zip entry byte for
  byte; `hdd.img` is never rewritten. Check a bundle with
  `python3 scripts/resolution/build_bundle.py verify <bundle> --base <the bundle it was built from>`.
  `s800.ini` is the image's own `SYSTEM.INI`, so the script refuses an image that is not the
  800x600 one. Nothing under `scripts/` reaches the bundle.
- **`SETRES.BAT` only touches a disk that has the drivers its `SYSTEM.INI` files name.** It tests
  seven files in `C:\WINDOWS\SYSTEM` (`SYSTEM_FILES` in the script) and does nothing if any is
  missing. *Why:* a layer keeps the `hdd.img` it first got, and the repo has shipped others: the
  256-colour image of `ce6eb4a` was on `main` for about a day (2025-04-19 to 04-20) and lacks
  `vsbd.386`, `vadlibd.386`, `sndblst2.drv` and `msadlib.drv`. The first version of the script
  copied unconditionally, and on such a layer Windows stopped at "Cannot find a device file that may
  be needed to run Windows in 386 enhanced mode ... vsbd.386", leaving the guest at the DOS prompt
  (reproduced on a bare js-dos page; the app would never see the green and count a failed boot).
  Guarded, the same layer boots at 800x600 as it always did and its save loads. Such a player keeps
  their mode, and the menu cannot change it (it only writes the flag); "Apagar todos os dados" gives
  them the current image. `verify` checks the seven files exist on the bundle's image and are named
  in both INIs, so the guard cannot silently pin everyone to 800x600.
- **The first boot after this update rewrites `SYSTEM.INI` on the `C:` of every player whose disk is
  the current image** (a 1.8 KB file; `hdd.img` was already dirty). A session that is open when the
  new bundle is served keeps 800x600 until it reloads. Tested on a real layer: a long-time user's
  save (made on the old bundle) loads at 640x480 after the bundle is replaced at the same URL, and
  so does a layer patched through `PatchService`. **It is a one-way door for the LFS file:**
  reverting `dosbox.conf` leaves every player's last persisted `SYSTEM.INI` (640x480) in their disk
  with nothing to switch it.
- **The mode in force is the framebuffer's size, never a stored flag.** `GamePage.currentDisplayMode`
  asks `DisplayModeHelper.fromFrameSize(dosCI.width(), dosCI.height())`; `null` is anything that is
  neither size (DOS text mode). The only persisted fact is `d/res/use800.flg` in the changes layer,
  which says what the NEXT boot does, written by `PatchService.setDisplayMode` with the same
  fake-CI trick as a patch (and so with the same rule: stop the auto-saver, do not play on, reload).
  The flag survives patches and their removal (their filters match by name); "Apagar todos os
  dados" deletes it, which restores the default. There is deliberately no `STORAGE_KEY` for it.
- **The menu entry is disabled while a room is live** (`isStreaming || isHosting`): the change is a
  reload, and a host's reload ends the room for everyone. A spectator is unaffected (it has no
  emulator) and the stream stays 4:3 in either mode, so every ratio-based fit holds; a
  same-page loopback of the host's canvas stream at 640x480 arrived as 320x240 (WebRTC ramping up)
  with the ratio intact. The two-peer harness has not been run against a 640x480 host (it needs
  the public nostr relays, which the sandbox that built this blocks).
- **At 640x480 the Elifoot window hides the green backdrop that load detection samples.** See
  *Screen-scraping*.

### Booting the emulator

`GamePage.bootGame()` starts js-dos through `elifootMain`, keeps the loader in step with it and
decides what a failure means. The pure parts are specced
([boot-progress](src/app/core/helpers/boot-progress.helper.ts),
[boot-stage](src/app/core/helpers/boot-stage.helper.ts) and
[boot-failure](src/app/core/helpers/boot-failure.helper.ts) helpers); the deadline logic lives in
`game.js`, which karma cannot load, and is checked in a real browser. Load-bearing:

- **A timeout is the end of a wait, not of the boot.** The old flat 15 s clock started before the
  6.7 MB download and ended when `run()` resolved, so a slow first visit was a "failure" that
  reloaded itself into the same failure. Now `game.js` watches `.emulator-loading-pre-2` with a
  `MutationObserver` and restarts a 20 s stall clock on every *change* of its text (`BOOT_STALL_MS`;
  60 s once the text reads "Downloading bundle 100%", see below; `BOOT_HARD_CAP_MS` = 120 s bounds
  one wait however busy the text keeps). The download is still
  running behind a `JsdosTimeoutError`, so `elifootMain` called again **re-attaches to the boot in
  flight** instead of stacking a second DOSBox on `#game-container`; a boot that already failed
  reports the same error again, and one that succeeded while nobody was waiting hands over its
  `dosCI`. A boot is replaced when its result was delivered **or when `#game-container` is no
  longer the element it was started in**. *Why:* `Dos()` builds the canvas, mouse layer and
  keyboard inside the element it is given, and `GamePage` is destroyed and rebuilt within one
  document (browser Back to the landing page, then Jogar). Re-attaching there handed the new page
  a `dosCI` whose picture and input sat in a detached tree (a welcome dialog over an empty game
  area), or replayed the old failure as if it were a new attempt: three round trips counted
  three failures and reached the wipe offer without one real try. The abandoned boot is not
  stopped (`stop()` cannot cancel a download in flight): the same ghost emulator the code had
  before any of this. Because alerts outlive the route,
  `GamePage.ngOnDestroy` also dismisses its timeout/failure dialog, and "Continuar esperando"
  does nothing for a destroyed page (it would raise a loader that nothing dismisses). Without an
  element to watch the stall clock is meaningless, so the hard cap is the only deadline.
- **The progress is js-dos's own text, so the bundle URL must never change.** "Downloading bundle
  N%" appears only when the server sends a length, "Extracting N%" is cumulative over the whole
  bundle (monotonic, not per file), and one step is silent by construction: after the download
  js-dos fetches and compiles `wdosbox.wasm` and writes nothing meanwhile. Measured with the page
  throttled to 40 KB/s that gap was 43 s (the flat 20 s fired "Continuar esperando?" at a boot
  one download from done), hence the longer window after "100%". A dialog that was already up
  when the boot lands stays up until tapped; "Continuar esperando" then returns at once.
  Never give `run()` a `blob:` URL or a renamed copy to get finer progress: the changes layer is
  keyed by `bundleURL + '.changes'` (`PatchService` hardcodes the same string), so a different URL
  orphans every saved game.
- **"Ready" is not the game.** After `run()` resolves, `waitForGameScreen` polls the framebuffer
  every 500 ms for up to 45 s (`GAME_BOOT.DETECTION_TIMEOUT_MS`) and `BootStageHelper.classify`
  labels what it sees: a frame under 480 lines is DOS text mode ("Iniciando o DOS…"), a black
  graphics frame is Windows 3.1 starting ("Abrindo o Windows 3.1…"), a flat `(0, 64, 128)` is
  Windows' desktop with the game loading ("Carregando o Elifoot…"), the game's green ends the
  wait. The label never goes back (a black frame between desktop and splash would flip it).
  The green test is the old one moved verbatim: same four pixels, same two greens, tolerance 25.
  A window that closes without green is not an error: the page carries on without the welcome
  dialog and says "O jogo ainda está iniciando…" in a toast. Measured on a desktop dev server
  (frames every 250 ms): DOS text at 0.5 s, black graphics at 1.8 s, the desktop at 2.0 s and the
  game's green at 4.1 s after navigation, 3.5 s after `run()` resolved; a phone's numbers are
  unknown, which is what the 45 s is a ceiling for.
- **Three kinds of failure, three outcomes** (`BootFailureHelper.kindOf`). `timeout`: dialog with
  "Continuar esperando" / "Tentar de novo", `FAIL_COUNT` untouched, nothing reloads by itself.
  `network` (js-dos's "Network error, can't download", which is *any* non-200 including a 404, or
  `js-dos.js` never loaded): counted, but a wipe cannot fix a missing download, so it is never
  offered. `other` (the emulator itself threw, e.g. "Broken bundle"): counted, and from the third
  in a row the dialog adds "Limpar todos os dados", always beside "Baixar cópia dos meus dados".
  Nothing is shown from js-dos's English: it goes to the console. Only a failure to *start* the
  emulator is a boot failure; an exception in the settings, welcome dialog or host intent after
  it is logged and alerted, never a reload (the old catch-all reloaded a game that was running).
- **The backup and the wipe work without an emulator.** `SaveGameService.readStoredChanges()` reads
  the layer straight out of IndexedDB (database `js-dos-cache (emulators-ui-saves)`, store
  `files`, key `<bundle url>.changes`, the zip's `ArrayBuffer`), and `clearAllData(null)` deletes
  the databases anyway: it used to return early without a `dosCI`, which made the failure
  dialog's wipe a reload with the broken disk intact. `runBundle`'s try/catch swallows only a
  layer that cannot be *read* from IndexedDB (it retries with the bundle alone and boots a
  pristine game). A layer that reads but is not a valid zip is not caught there, because the
  `emulators.dosWorker([bundle, changes])` promise is returned, not awaited, inside that try: it
  fails in the worker ("Unable to extract bundle archive"), `run()` rejects with the worker's
  panic messages as a JSON string, and that is an `other` failure, which is what the third-failure
  wipe offer is for. Read from the vendored source and pinned by a `kindOf` spec, not run in a
  browser. Without `indexedDB.databases()` (Firefox before 126) the backup asks for the one
  database name js-dos uses, and aborts the upgrade if it does not exist: an open that creates
  it leaves a database without its `files` store, which js-dos then opens at the same version
  and never repairs, so every later save fails.
- **js-dos paints its own red toast** ("Can't start emulator look browser logs for more info",
  English) on a failed `run()`. It sits over the failure dialog for a few seconds and is left
  alone: it is a global notyf container shared with every other js-dos message.

### Persistence model

js-dos keeps the *changed* portion of the virtual disk as a zip inside IndexedDB databases named
`js-dos-cache*`. `dosCI.persist()` dumps that zip; `saveGameFileSystem()` writes it back. Everything
the app reads or writes lives under the mounted `d/` tree: game in `d/eli98/`, save games in
`d/eli98/jogos/*.e98` (`BASE_SAVEGAME_DIR`). Clearing data means deleting those IndexedDB databases
([save-game.service.ts](src/app/core/services/game/save-game.service.ts)) plus the Ionic Storage keys,
and the one `localStorage` key the diagnostics log keeps its tail in (see *Diagnostics log*).

### Patching (the central trick)

[patch.service.ts](src/app/core/services/game/patch.service.ts) modifies the virtual disk without any guest-side
file API: it builds a `JSZip` of the desired changed-FS, then hands `emulators-ui` a **fake command
interface** whose `persist()` returns that zip, and calls
`dosInstance.emulatorsUi.persist.save(bundleName, dosInstance.layers, fakeCI)` — overwriting the
IndexedDB cache. The caller then forces `window.location.reload()` so the VM boots from the patched disk.

`setDisplayMode` is the same trick with a smaller payload (see *The guest's resolution*).

Team/flag patches also install two batch files from `src/assets/elifoot/`: the overridden
`d/ELIFOOT.BAT` calls `d/PATCH.BAT` before launching Windows, and `PATCH.BAT` copies
`d/eli98/PATCH/{EQUIPAS,FLAGS,CTRGROUP,COUNTRY.TXE}` over the originals at the DOS prompt. Uploaded
patch zips are flattened/validated in `processPatchFile()` (needs ≥34 `.EFT` team files).

### Typing into the guest

[guest-key-queue.service.ts](src/app/core/services/game/guest-key-queue.service.ts) is the
**only** thing that sends keys to the guest. A FAB tap, the text dialog and anything added later
submit tasks (`chord`, `altCode`, or a whole text planned by `EmulatorKeyCodeHelper`) to one FIFO
with one consumer, so two senders can never overlap. `GamePage.sendKey` and
`EmulatorControlService.sendKey` / `sendString` are thin wrappers over it.

Load-bearing invariants — each of these was a bug, or a measured trap:

- **Never call `dosCI.simulateKeyPress`; the queue is the only key sender.** It stamps the release
  16 ms in the future, so a second call within 16 ms loses its key and leaves the guest keyboard
  dead until a reload (5 of 5 repros) — and a reload costs everything since the last save. It was
  easy to hit: the old `sendString` was not awaited, so a FAB tap mid-text did it. The queue sends
  only `sendKeyEvent` down then up, `EMULATOR_CONTROL_CONFIG.KEY_PACING_MS` (10 ms) between groups,
  and never more than `MAX_SYNC_KEY_EVENTS` (14) events without a gap, because DOSBox's keyboard
  buffer drops the rest without an error (129 characters in one burst delivered 14). **This cannot
  be fully enforced yet:** js-dos's own on-screen keyboard (`toggleSoftKeyboard`) binds its key
  presses to `simulateKeyPress` internally, so a tap on it within 16 ms of another press, or while
  the queue is typing, can still wedge the guest until the planned control deck replaces that
  keyboard. `grep -rn simulateKeyPress src/app` must keep finding only comments and the
  `@deprecated` declaration in [jsdos.d.ts](src/app/core/typings/jsdos.d.ts), never a call.
- **A task is atomic.** Once its first key is down it is carried through to the release, so
  neither `cancel()` nor a failure can leave Alt or Shift held in the guest; `cancel()` drops only
  tasks that have not started, and `GamePage.ngOnDestroy` calls it.
- **Every code point is one visible character in the guest.** `EmulatorKeyCodeHelper.planText` is
  the pure, specced step that turns a string into tasks: ASCII is a plain or Shift chord,
  U+00A1–U+00FF are Alt+0nnn on the keypad (four digits, zero-padded, which selects ANSI over the
  OEM page), typographic quotes, dashes, the ellipsis and exotic spaces fold to ASCII, and
  **everything else becomes a visible `?` — never a space, never a drop**, so the host's string and
  the guest's field stay 1:1 and Backspace stays correct. The guest is a plain US layout with no
  dead keys and no way to install ABNT2, so accents can only be composed. The euro sign and the
  rest of Windows-1252's 0x80–0x9F block (Š, ™…) are `?` on purpose: Alt+0128 is accepted, but the
  fields' font has no glyph there and draws a solid box. Count with `Array.from`; UTF-16 units
  would turn one emoji into two `?`. Elifoot's 8-letter filename field takes the accents too (and
  upper-cases them).
- **CapsLock is guarded, NumLock is not.** Before a text that types letters, the queue reads the
  BIOS keyboard flags byte (`0040:0017`, through `readMemory`) and taps CapsLock off if it is set:
  Shift-for-uppercase inverts under it, and a host with a hardware keyboard forwards its own
  CapsLock to the guest, so the host cannot know. The byte does track both toggles under Windows
  3.1, but Alt+0nnn composes the same character with NumLock on or off, so there is nothing to
  guard there. The guard is best effort — `readMemory` has no deadline of its own and the consumer
  is single, so a read is raced against `KEYBOARD_STATE_TIMEOUT_MS`, and a failed one is logged and
  the text goes out as it is.
- **A refused key says so.** With no emulator a submission rejects with `KeyQueueError` (its
  message is Portuguese, meant for `showErrorAlert`) instead of becoming a tap that does nothing.
- **The text dialog sets its field's attributes on the DOM, not through the input's
  `attributes` option.** Ionic hands those to Stencil, which assigns an element *property* wherever
  one exists, and `autocorrect` is a boolean property in WebKit and Chromium: `'off'` is truthy and
  writes `autocorrect="on"`. `enterkeyhint` is `enter`, not `send`: the field is a textarea where
  that key inserts a line break, which is how several game fields are filled in one go.
- **Guest hazard to know before sending any Enter.** On Elifoot's first dialog, Enter before a
  radio is chosen raises "List index out of bounds", and Esc or Cancelar quits; either way the game
  exits to Program Manager (the FAQ says so). Anything that sends Enter on its own — a future type
  bar, a "next field" button — must not do it on that screen.

### Screen-scraping instead of emulator events

Two flows read the framebuffer because js-dos exposes no game-level state (and the guest is a 16-bit
Windows app, so there is nothing to hook):

- **Load detection** — `GamePage.waitForGameScreen()` polls `dosCI.screenshot()` every 500 ms for up
  to 45 s (each look raced against 5 s, because `screenshot()` has no deadline) and
  `BootStageHelper.isGameScreen` samples four hardcoded pixels for the game's green background
  (tolerance 25). Note this waits for the *game's* screen, i.e. it also covers the DOS + Windows 3.1
  boot time, and the same frames label the loader's stage (see *Booting the emulator*). Failures
  increment `STORAGE_KEY.FAIL_COUNT`, timeouts and an undetected screen do not; the wipe is
  offered from the third failure of the emulator itself.
- **Auto-save** — [auto-saver.service.ts](src/app/core/services/game/auto-saver.service.ts) samples
  the framebuffer every 300 ms and [emulator-control.service.ts](src/app/core/services/game/emulator-control.service.ts)
  OCRs one 132x20 strip with tesseract.js (`por` model) looking for "a gravar o jogo…" via
  sliding-window Levenshtein distance. When the game finishes its own save, the VM is persisted so
  progress survives a browser reload.

Both are coordinate- and color-sensitive: changing the emulator canvas size, the Windows 3.1 video
mode/resolution, or the game's language will silently break them. Constants live in
[constants.ts](src/app/core/models/constants.ts). The load-detection pixels are absolute and pass at
800x600 and 640x480, **for different reasons.** They sample Elifoot's green BACKDROP form, not the
game window: at 800x600 the window is centred with a margin all round, so the backdrop shows for as
long as the game runs; at 640x480 the window fills the frame, and in play the four points read the
menu bar and the squad list (measured in play: 1 match of the 3 needed, only the `x = 0` point
stays green; on the splash, the new-game dialog and the Registo screen it is 4 of 4). The probe
passes at boot only because the splash (Acerca, or Registo on a later visit) is smaller than the
frame and sits on the backdrop, and "green lost" is the normal state afterwards. That is fine for
`waitForGameScreen`, which runs only at boot; anything built on "the green went away" (the planned
recovery banner) must use Windows' desktop blue `(0, 64, 128)` and the Program Manager icon instead.
Confirmed on a real boot at 640x480 in the app: `Green check passed`, and the loader reads "Iniciando
o DOS…" then "Carregando o Elifoot…" ("Abrindo o Windows 3.1…" is shorter than the 500 ms between
looks, as in P6). The OCR strip is **centre-relative** (`OcrRegionHelper.savingDialogRegion`:
left = round(W/2 − 68), top = round(H/2 − 25), 132x20, so (332, 275) at 800x600 and (252, 215) at
640x480), because the dialog is centred and its crop is byte-identical in both modes. Confirmed on
a real save at 640x480 through the app's own service and tesseract: the region resolved to
(252, 215), the strip held the 1892 navy and 352 white pixels it holds at 800x600, `isGameSaving`
answered `true` for the length of the dialog, and the auto-saver persisted `QA640.E98`.

Load-bearing invariants of the auto-save — each of these was a bug, or a measured trap:

- **The game's save dialog is up for about 1.7 s, and only a real save shows it.** Measured on a real
  save at 800x600 (the ROI frames are in the research captures): "A gravar o jogo…" appeared at the
  first kickoff of a *new* game, stayed 1.70 s, and was byte-identical to the baseline capture.
  Timed again for the 640x480 change, with a 10 ms recorder on a new game each, same machine and
  minute: **0.61 s at 800x600 and 0.62 s at 640x480.** The video mode does not change it; the
  machine does, and a quicker one has well under 1.7 s, which is what the 300 ms tick has to catch
  on a phone whose OCR pass is slow. A loaded game's next two kickoffs and the end of its round
  showed no dialog at all, so do not assume every "Jogar" saves. The progress dialogs "A iniciar o jogo…" and "A carregar o jogo…" sit in the same place
  and are read as `false` (edit distance above the tolerance of 4), and so were the half-time window
  and the end-of-round screens over a whole round.
- **Persist only AFTER the dialog is gone.** The dialog is up while the game writes the `.e98`; a
  persist that lands mid-write stores a truncated save over a good one. `monitor()` therefore waits for
  the dialog to disappear (up to 2 min, polling once a second), then persists. A look has three
  answers: `isGameSaving` resolves `true`, `false` or `null` ("OCR could not read the strip": no frame,
  no worker, a `recognize()` that rejected, a canvas that would not encode). Once the dialog has been
  seen, a `null`, a `screenshot()` that throws and a look that overruns the heartbeat all count as
  "still saving", never as the all-clear. Before it has been seen, `null` is "not saving". **Why:** OCR
  failures used to be folded into `false`, so a worker dying under the memory spike of the save would
  have persisted mid-write. A persist that fails is *owed* and retried by the next tick that
  finds no dialog, a few times and then dropped.
- **OCR is a cache keyed by a hash of the strip, never a gate in front of it.** Each look is
  `screenshot()` plus a 32-bit FNV-1a of the 10,560 bytes (~0.1 ms); OCR runs only for a strip it has
  not read, and an unchanged strip gets the verdict it got last time (`RegionVerdictCache`). The
  verdict is remembered, not just "unchanged", because while the dialog is up the strip is static and
  the caller is asking whether it is *still* up. A moving guest cursor over the strip changes the hash
  and costs one more OCR pass; it cannot suppress one. **A future pixel-signature matcher must mask the
  cursor sprite**, which is drawn into the framebuffer. Measured over one whole round (235 s): ten OCR
  passes, where the old loop ran one per 1.5 s tick.
- **No caller ever waits for the OCR worker.** `createWorker()` has no deadline (with the language file
  unreachable it stays pending for ever, measured), so the old `await getWorker()` froze the loop.
  `OcrWorkerHost` hands out the worker or `null` immediately; a start is one memoised attempt raced
  against 20 s (`TimeoutHelper`), then retried after 5 s, 15 s and 60 s, then abandoned until
  auto-save is switched off and on. tesseract.js returns the `Worker` only once fully initialised, so a
  start that stalls leaves a thread that cannot be reached to terminate: one that lands late is adopted
  if nothing is ready and terminated if something is, and the bounded retry count is what bounds the
  leak. Do not "fix" this into an unbounded retry. The worker is created when the auto-saver starts
  (after the game has loaded), not in a constructor, and terminated by `stop()`; `createWorker` gets
  an `errorHandler` because without one a failed start is also an uncaught exception.
- **The loop never dies, and a failure is never silent.** `tick()` reschedules in `finally`; a tick that
  throws is retried after 5 s, 15 s, 60 s and then every 60 s (it used to set `ERROR`, which ended
  auto-save for the session while the menu still showed it on). Each look is guarded by a 10 s
  heartbeat (`isGameSaving` has no deadline of its own), the tick as a whole is not, because it lasts
  as long as the save. The "Salvando máquina virtual…" loader is dismissed in `finally`, and its
  present/dismiss are bounded to 2 s because a page Chrome counts as hidden never finishes those
  animations. `persist()` is serialised and bounded to 30 s. The periodic save is awaited and caught.
- **When OCR is unavailable the 5-minute periodic save is forced and the user is told once** (a toast,
  from `AutoSaverService`, because only it knows the fallback is on). It is a separate flag from the
  user's own periodic save, so OCR coming back, or `stop()`, ends the forced one without touching
  theirs.
- **Hidden pages are skipped unless hosting.** A hosting browser keeps streaming and playing from a
  tab behind another, so `start()` takes `keepRunningWhileHidden` (the game page passes
  `MultiplayerService.isHosting`). The loop runs outside the Angular zone: at several ticks a second it
  would otherwise cost the whole app a change-detection pass each time. `GamePage.ngOnDestroy` stops
  it, since the services are root singletons and now survive errors by design.
- **Still true and not fixed here:** the tesseract worker, 3.9 MB core and 1.4 MB model come from
  jsDelivr at runtime (decision D5: self-host later). Offline, or with the CDN blocked, OCR is
  unavailable and the fallback above is all that saves the game. The fixed 20 s deadline can be shorter
  than a slow mobile link needs for 5.4 MB; the retries and late adoption mostly absorb that.

### Diagnostics log (opt-in, for real-device passes)

[diagnostics.service.ts](src/app/core/services/shared/diagnostics.service.ts) is a bounded record of
what the app did on THIS device, built so a phone can hand evidence back: pointer, touch, key, ime,
frame, boot, ocr, save, update, error, and `page` (lifecycle and viewport; the one category added to
the plan's list, because it is the evidence an iOS tab eviction leaves). **Off by default.**

**How to turn it on:** the options menu's "Diagnóstico" entry opens the window
([diagnostics-modal](src/app/pages/game/components/diagnostics-modal/diagnostics-modal.component.ts));
its switch persists the choice in `STORAGE_KEY.DIAGNOSTICS`. Or put `?diag=1` on the address (before
or after the `#`), which turns it on for that **tab's session** (`?diag=0` forces it off for one).
`GamePage.debugMode`, the old hard-coded `false` that gated "Baixar Disco Virtual", now reads
`DiagnosticsService.enabled`: one switch, no second mechanism.

**Log through `DiagnosticsService.log(cat, msg, data?)`; never `console.log` in a hot path.** A console
line costs a string and a write whether anyone looks, and cannot be exported from a phone. `data` is a
value or a thunk, and a thunk is not called while the log is off: `log()` is one boolean check and a
return, so a call may sit on a hot path (the pointer/touch/type-bar/camera phases are expected to log
there). When on, `data` is turned into bounded text at the call (`DiagnosticsSerializer`: depth, key and
length limits, cycles marked, `NaN`/`Infinity` named, never throws), and the ring buffer holds 5000
entries and overwrites the OLDEST. Call sites log counts, kinds and timings, not what a player typed; the
panel still warns that typed text may appear, because later phases will log input.

Load-bearing, each measured or a decision that looks wrong without its reason:

- **Off means no listeners and no timers.** `DiagnosticsCapture.install` (window `error`,
  `unhandledrejection`, `visibilitychange`, `pagehide`/`pageshow`, `freeze`/`resume` where the document has
  them, and `resize`/`orientationchange`/`visualViewport` resize coalesced into one `viewport` entry) and
  the persistence interval exist only between `enable()` and `disable()`. Checked in a browser through
  zone.js's own task lists, because DevTools counts one native listener per type under zone.js and so
  cannot see an added one.
- **The window listeners alone miss almost every app error.** Angular catches template and zone errors,
  and zone.js's `Promise` never raises the native `unhandledrejection` (of four rejections only the
  native `async` one reached a listener).
  [`DiagnosticsErrorHandler`](src/app/core/services/shared/diagnostics-error-handler.ts) is provided in
  `AppModule`, logs `error` / `ErrorHandler`, and then calls the default handler.
- **`?diag=1` does not survive in the address.** The document has `<base href="/">`, so the router's
  first `history.replaceState('#/game')` resolves against the base and drops the query. The request is
  therefore kept in `sessionStorage` (`DIAGNOSTICS.SESSION_KEY`), which a reload and a restored tab keep;
  a person's own choice in the window clears it. `?diag=` after the `#` is the form that stays in the URL.
- **The tail of the log outlives the page, in two copies.** An evicted tab leaves no memory behind and the
  events that explain it are in the page that dies, so while on, the last 1000 entries (at most 200K
  characters) go to Ionic Storage every 5 s when there is something new, and ALSO to `localStorage` when
  the page is hidden, frozen or going away: with only IndexedDB a reload lost everything after the last
  interval write, because a transaction started in `pagehide` does not finish. The next page that has the
  log on reads both, keeps the newer, and shows it as "página anterior". That includes a `?diag=1`
  visit: it stores no *choice*, but it writes a tail like any other, and the tail stays until "Limpar",
  switching the log off or "Apagar todos os dados" (the copy is what explains an eviction of that same
  tab, so it is kept while the visit is alive and not guessed at afterwards). Not verified: that an
  iPhone's eviction leaves its `visibilitychange` line (it is on the device checklist).
- **"Apagar todos os dados" must be final.** `LocalStorageService.clearAllData` also removes the
  `localStorage` copy (Ionic Storage does not know it), and `GamePage.clearAllData` switches the log off
  FIRST: with it on, the reload fires `pagehide`, which wrote the tail straight back (measured).
- **Copy and share read a report built BEFORE the tap.** Safari honours `clipboard.writeText()` and
  `navigator.share()` only while the tap is the current user gesture, and the header (storage estimate,
  service-worker lookup) is asynchronous, so the window collects it on open and on "Atualizar" and a tap
  only appends the live log, synchronously. Share hands over a `.txt` file where the browser takes files
  and the text otherwise; a dismissed sheet is not an error. The report is always the whole log: the
  window's category filter changes only what is shown.
- **The state lives in the main bundle, the presentation in the lazy game chunk.** The service, ring
  buffer, serializer, capture and tail are in `main` (`AppComponent` injects the service so it exists
  before any page); the header, report and export helpers and the window are not. Do not import the
  report or header helpers into the service.
- **The header never carries the query** (a share link holds a room code): the route only. It names
  js-dos's own detection (`dom.pointers.bind.mobile`, `canLock`, `autolock`, and its user-agent regex
  tested against this device), the guest framebuffer, the viewports, pointer capabilities, the service
  worker and the storage estimate, each asynchronous probe with its own deadline.

Hooked today (one-line calls, no behaviour change): `GuestKeyQueueService` (`key`: enqueue, start, flush
with how far the device stretched the 10 ms pacing, cancel, fail, refused, the CapsLock read), the boot
(`boot`: js-dos's loading text once per phase and ten percent, the stage changes, detection, failures;
`frame`: the guest's size), `OcrWorkerHost` and `EmulatorControlService` (`ocr`: the worker's life, each
recognition pass, the saving verdict when it changes), `AutoSaverService` and `SaveGameService` (`save`:
the dialog seen and gone, each persist with its reason and duration, tick failures, hidden-page pauses,
`layers.save()` time) and `AppComponent` (`update`: the prompt, the choice, the save before the reload).
Pointer, touch and IME are NOT hooked: the phases that add them log into this.

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
(`-stream`, `-chat`, `-cursor`, `-player-info`, `-audio`, `-admission`, `-identity`, `-ui`,
`-relay-health`) support it. The ones that hold per-room state — stream, chat, cursor, player-info,
audio and admission — expose `clear()`, and `leaveRoom()` calls all six. Two have none and need
none: identity (remembers the player's name and colour) and ui (dialogs and toasts). The third,
relay-health, has none **on purpose**: whether this browser can reach the relay belongs to the
browser, not to a room, so it outlives rooms (see its invariant below). A new service that holds
per-room state must expose `clear()` and be added to `leaveRoom()`.

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
- **The spectator limit is an admission gate, not a kick, and what it tells a refused guest is a
  claim.** trystero has no way to remove a peer, but `onPeerHandshake` runs after the password
  challenge and before a peer is active, so a host at its limit (`MultiplayerAdmissionService`,
  counted from `getPeers()` plus admitted-but-pending, in one synchronous step) refuses by throwing
  after sending `{ __eli: 'room-full' }` — the only channel that reaches a pending peer. A guest
  cannot tell the host from an impostor until video arrives, so it waits `ROOM_FULL_GRACE_MS` and a
  stream arriving first wins; that bounds a forged refusal to guests whose stream is slower than
  the window, no better. A refused peer is invisible to the host, so the rival-host collision check
  (which runs off `onPeerJoin`) is replaced on that path by exchanging hosting ages through the same
  channel. A spectator announces itself (ident) only once it has a host, because the room is a full
  mesh and a refused guest still connects to every other spectator for a few seconds.
- **A dead TURN relay degrades the app; it must never break it, and it must be said out loud.**
  trystero adds `turnConfig` to its default STUN list, so most pairs still connect directly and
  only symmetric-NAT/mobile/strict-firewall guests fail. **Never pass `rtcConfig.iceServers`**: it
  is spread last and replaces STUN too. `MultiplayerRelayHealthService` sees every connection via
  `rtcPolyfill` (the only hook that sees the ones that never come up) and calls the relay
  unavailable if no relay candidate arrives `RELAY_VERDICT_MS` after the first connection is
  built, or a connection finishes gathering without one. The clock is load-bearing: gathering alone
  takes ~40s when a server is silent, and a spectator's join times out at 20s. It outlives rooms and
  has no `clear()` on purpose. The credential and `environment*.ts` are deliberately untouched.
- **The game's sound is one audio track in the same wrapped stream as the picture, made
  before the first publish and never added or removed afterwards.** js-dos keeps its
  `AudioContext` private, so `game.js` captures the one `ScriptProcessorNode` it creates
  (`getDosAudioNode`, installed before `elifootMain` runs) and `MultiplayerAudioService`
  fans it out to a `MediaStreamAudioDestinationNode` that is never connected to the host's
  speakers. The host's "send the sound" switch only flips `track.enabled`: a track added to a
  live room needs a renegotiation trystero does not perform (the same failure as the spectator
  rejoin above), so toggling by add/remove would silently reach nobody. Audio is best-effort
  — no node means video only, never a failed host. Host identity is still read from the
  *video* track, so audio can never confer it. A spectator attaches with `video.muted` set as a
  property before `srcObject`, and falls back to muted plus an `Ativar som` button when the
  browser refuses to autoplay with sound; their mute persists because every rejoin reloads.
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
- [emulator-control.service.ts](src/app/core/services/game/emulator-control.service.ts) — also the entry
  point for sending keys and text (thin wrappers over the key queue, see *Typing into the guest*) and
  for the auto-save OCR.
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
tokens (`--win9x-face`, `--win9x-shadow`, `--win9x-field`, `--win9x-ink-muted`,
`--win9x-titlebar-bg`, `--win9x-font`, `--win9x-input-font-size`, `--win9x-hit-target`) plus
`.win9x-element-border` / `-bevel`, `.win9x-outer-window`, `.win9x-modal-container`,
`.win9x-titlebar`, `.win9x-titlebar-close`, `.win9x-input`, `.win9x-button`. It is loaded via
`@use` as the **first statement** of
[global.scss](src/global.scss); `@use` must precede all other rules, so it cannot be moved
below the Ionic imports.

**The boundary: companion windows are Windows 95; the app shell stays Elifoot green.**
Retro treatment applies to the multiplayer chat panel, the room-setup dialog, the
multiplayer panel, the roster rows, the chat toggle, the spectator's sound toggle (which shares
the chat toggle's rules in `global.scss`), the Cheat 'O Matic modal, the diagnostics window, and
every `AlertController` dialog. It does
**not** apply to the page toolbars (`ion-toolbar color="tertiary"`), the landing cards, the
FAB clusters or the options popover — the navy `#092469` in
[variables.scss](src/theme/variables.scss) is close enough to `#000080` that shell and retro
windows read as deliberately related. A retro treatment without an explicit boundary reads
as a mistake rather than a choice.

**Alerts are skinned in pure CSS, and opt in per call site.** `ion-alert` is Stencil
**`scoped`**, not shadow DOM, so every internal node (`.alert-wrapper`, `.alert-head`,
`.alert-input`, `.alert-button`, …) is reachable from the global sheet — no `::part()`, and
no reason for a custom alert component that would have to re-implement the focus trap,
backdrop, Esc handling and `onDidDismiss()`. The block lives at the end of
[_win9x.scss](src/theme/_win9x.scss). Two things it depends on:

- **Stencil suffixes every *compound* of its selectors**, not just the last one, so an
  Ionic alert rule scores (0, 2 × compounds, 0). `.alert-wrapper.sc-ion-alert-md` is
  (0,2,0), but `.alert-head.sc-ion-alert-md+.alert-message.sc-ion-alert-md` and
  `[aria-checked=true].sc-ion-alert-md .alert-radio-icon.sc-ion-alert-md` are **(0,4,0)**.
  Stencil injects that CSS at runtime, so source order proves nothing. Rules are prefixed
  `ion-alert.win9x-alert` and then name **at least as many descendant classes as the Ionic
  rule they fight** — threading in `.alert-wrapper` is how the (0,4,1) ones get there. A
  rule that is one class short fails silently and reads as a paint bug: that is how the
  checked radio first shipped with an Elifoot-green ring.
- `mode: 'md'` is pinned globally in [app.module.ts](src/app/app.module.ts), so only
  `alert.md.css` is ever in play. Unpinning it would drop every alert into the iOS layout,
  which this block does not style — and would switch **on** the iOS-only button-active
  gesture, which is why the pressed bevel is keyed to `:active` and not `.ion-activated`
  (md never sets that class; see `setupButtonActiveGesture` in Ionic's `alert.js`).
- Alerts carry no drop shadow, matching `.win9x-modal`. `contain: content` on
  `.alert-wrapper` would not block one — paint containment clips descendants, not the
  element's own shadow — so its absence is a choice, not a limitation.
- `.alert-danger` is re-coloured to Win9x maroon *inside* `.win9x-alert` only. The Ionic
  red was chosen against a white card (~3.7:1) and drops to ~2.1:1 on the `#c0c0c0` face.

**A new alert must pass `cssClass: 'win9x-alert'` or it renders as a Material card.** Keep
it first in the string, ahead of `alert-whitespace` / `wide-alert`. The two generic error
funnels — `GamePage.showErrorAlert` and `MultiplayerUiService.showError` — already carry it,
so route new error dialogs through those rather than hand-rolling another `create()`.
`alert-danger` is a *button*-level class and is unaffected. Before opening a PR, check that
`grep -rc 'alertController.create' src/` and `grep -rc "cssClass: 'win9x-alert" src/app`
still agree (28 today) — a manual check, because `npm run lint` covers only `.ts`/`.html`
and there is no stylelint setup to hang it on.

The room status pill (`.mp-status-pill` in [global.scss](src/global.scss)) is on the shell
side of that line and is deliberately flat, not Win9x: it renders inside the page toolbars,
and half a retro toolbar reads as a bug. Its landscape instance rides the game surface but
keeps the same flat look, because one component changing identity by position is worse than
one that does not. Do not "fix" it by moving it into `_win9x.scss`.

**Secondary text is `--win9x-ink-muted` (#4a4a4a), never `--win9x-shadow` (#808080).** The
shadow grey is for bevels and borders: as text it is 2.2:1 on the window face and 3.95:1 on white.
The muted ink is 4.9:1 and 8.9:1, and stays in the Win9x grey family; `--win9x-ink-disabled`
(#808080) is for disabled controls only, which WCAG exempts. Error text is `#800000` (6.0:1 on the
face; the `#a11` it replaced was 4.1:1). [win9x-palette.spec.ts](src/theme/win9x-palette.spec.ts)
fails when a roster text class drops under 4.5:1 on the row it sits on. It cannot see the chat
transcript, whose colours live in a component stylesheet and use the same token.

**The 44px floor follows the pointer, not the width.** The `@media (pointer: coarse)` block at
the *end* of [_win9x.scss](src/theme/_win9x.scss) gives a finger `min-height: var(--win9x-hit-target)`
on every `.win9x-button`, `.win9x-expander`, alert button and titlebar close, 40px roster rows
(not the chat's compact strip, whose rows are not controls) and 16px text fields (through
`--win9x-input-font-size`, because the chat and the room dialog set their own size in component
stylesheets). A mouse keeps the authentic ~16px controls. It must stay at the end: the alert
button's 36px is a rule of the same specificity, and the later one wins. `.recent-room` is a
`.win9x-button`, so the spectator's one-tap rejoin is covered without being named. The status pill
is shell and has its own coarse rule beside it in [global.scss](src/global.scss): 10px of
transparent border above and below (`background-clip: padding-box`), which still paints the flat
24px capsule.

**The pill's hit area is a border, never an `::after`.** In both toolbars the pill sits in an
`ion-title`, whose shadow `.toolbar-title` is `overflow: hidden` and exactly one line box tall
(~31px). Anything that overflows the pill's own box is clipped to that, for painting and hit
testing alike, so the first version (a 44px `::after`) gave 7px of hit area above the capsule and
none below while the comments claimed 44. A border is part of the box and grows the line box
instead; the 56px toolbar absorbs it. Measured with an `elementFromPoint` column scan down the
real spectator header: 32px of hit area before, 45px after. The floating instance (mobile
landscape, no clipping parent) takes the border back out of the layout with a negative margin, so
its capsule is where it always was.

Gotchas the partial documents but are worth repeating:

- `.win9x-button` only renders correctly on an `ion-button` with `fill="clear"`; otherwise
  Ionic's shadow-encapsulated `.button-native` paints over the host.
- The floor is automatic only under `(pointer: coarse)`; for a mouse it is **opt-in** via
  `.win9x-button--touch`. Applying it to `.win9x-button` for every pointer grew the omatic
  modal's buttons enough to overflow its 480px desktop box into a scrollbar (measured at
  1280x800: 416/416 before and after, with a mouse). **A touch tablet is the case in between.**
  820x1180 and 1024x768 are 768px+ viewports, so they get that same 480px box with the 44px
  buttons, and the content was 24px too tall for it (440 against 416, a scrollbar and the last
  button clipped). `@media (min-width: 768px) and (pointer: coarse)` in `global.scss` makes the
  box 520px (456/456 at both sizes). On an 844x390 landscape phone the modal scrolls either way,
  and `.omatic-modal` is capped at `--max-height: 90vh` for that reason: uncapped, a >=768px-wide,
  390px-tall viewport centred the 480px box and put its titlebar and close button above the top
  edge. Re-measure all four sizes (phone, both tablets, mouse) when the O Matic's content changes.
- Inside `ion-buttons`, Ionic's `.sc-ion-buttons-md-s ion-button { min-height: 32px }` is (0,1,1)
  and beats a bare class, so the titlebar close sets its own `min-height`.
- The pill's border is a literal `10px`, not `--win9x-hit-target`: it is shell, not a Win9x control.

**`ion-button.win9x-titlebar-close` replaced three copies of an `ion-toolbar ion-button`
override** (O Matic, room dialog, multiplayer panel). The old selector was unqualified and
hoisted as it was it would restyle every toolbar button on the main, game and join-game pages, so
the shared version is an opt-in class qualified by element. Put it beside `.win9x-button` on the
button that closes a Win9x titlebar.

### Help modals, copy and accessibility

- **The manual's video is a click-to-load facade, and the landing page's privacy line is why.**
  The FAQ/Manual accordions render their content slot immediately, so a plain iframe loaded
  YouTube whenever the guide opened, against a footer that says nothing is sent to anyone.
  `ManualComponent` draws a local placeholder (no thumbnail: that would be a request too) and
  creates the `youtube-nocookie.com` iframe on the tap, with `autoplay=1` because the tap is the
  request to play. Its box is 16:9 without `aspect-ratio` (Safari 14.1 is the floor): padding in
  percent resolves against the *containing* block, so the 480px cap lives on an outer element and
  the padded one is `width: 100%`. **Known:** the video id in that file is dead — YouTube's oEmbed
  endpoint answers 404 for it, against 200 for a control video — so the player shows "Video
  unavailable" until someone supplies a new id.
- **Every `Error` thrown by `PatchService` is shown verbatim** by `GamePage.showErrorAlert`, so its
  messages are Portuguese and say what to do next; JSZip's and HttpClient's own English goes to the
  console at the catch site. [patch.service.spec.ts](src/app/core/services/game/patch.service.spec.ts)
  pins the wording. Other English `throw`s remain: `CheatOmaticService`'s are logged by the O Matic
  modal, never shown, but `MultiplayerService.joinRoom`'s "Already in a room…" can reach the join
  page's error card. The `elifootMain` timeout used to be English too ("jsdos timed out after 15
  seconds", shown in the load-failure dialog's "Motivo"); the boot dialogs now say it in Portuguese
  and keep js-dos's own wording in the console.
- **Labels the screen reader reads.** Icon-only buttons need `aria-label`; Ionic moves it from the
  `ion-button` host to the native `<button>` it renders, so check the accessibility tree, not the
  host attribute. `#game-container` is `role="application"` with a label (the canvas inside is
  opaque to assistive tech whatever is said about it). The chat transcript is `role="log"`,
  `aria-live="polite"`, `aria-atomic="false"`, `aria-relevant="additions"`: lines are announced
  one at a time and the 100-line cap dropping the oldest is not announced. The docked panel is
  `aria-hidden` while closed, which is what keeps a chat nobody opened silent. The copyright year
  in the About modal is `new Date().getFullYear()`, not a literal.

### PWA

`@angular/service-worker` with [ngsw-config.json](ngsw-config.json). `AppComponent` watches
`SwUpdate.versionUpdates`, records `STORAGE_KEY.PENDING_UPDATE`, and applies updates by reloading
(immediately or on next launch).

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
reloads regardless: a persist that hangs must not be able to hold an update hostage. Cutting a
persist short loses only what it was writing, because the write is one IndexedDB put. "Instalar
agora" first asks `MultiplayerService.isHosting` and, for a host, shows a confirm because a
reload ends the room for every spectator; "Atualizar depois" leaves `PENDING_UPDATE` set, so the
next launch installs it before any room exists. A spectator is not asked: it has nothing to lose.
`AppComponent` reaches `MultiplayerService` through a dynamic `import()` plus `Injector`, not a
constructor dependency: a static import drags trystero out of the lazy game chunk into the main
bundle every visitor downloads. The import is free for a host, because `/game` and `/join-game`
already load that chunk. Do not "simplify" it into an injected service.

### Leftover scaffolding

`ionic.config.json` / `capacitor.config.ts` still carry the Ionic starter identity
(`Elifoot98Keygen`, `io.ionic.starter`) and there are no native platform folders — Capacitor is
unused; the target is the browser/PWA only.
