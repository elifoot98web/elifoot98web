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
node scripts/frame-fixtures/make-fixtures.mjs <out.ts> name=frame.png::note ...   # real guest frames -> a spec fixture
```

Specs are karma + jasmine. The builder globs `**/*.spec.ts` (its `include` option, which is also
what `--include` overrides); [src/test.ts](src/test.ts) only initialises the TestBed and
`tsconfig.spec.json` type-checks `src/**/*.spec.ts`, so a spec needs no registration but must live
under `src/` to be type-checked. Nothing in a spec reaches the bundle. There are **forty-seven spec files so
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
[guest-pointer.helper.spec.ts](src/app/core/helpers/guest-pointer.helper.spec.ts) is the model for "an engine whose
worst failure only shows against the real guest": it drives the engine against a fake guest written from the
measured rules, independently of the code under test (the gain, the clip, the wrap and, the part that matters, sends
inside one frame being summed), under `fakeAsync` with `Date.now` handed in as the clock, because zone.js fakes `Date`
and not `performance.now`; one spec is a control that shows the fake really does punish a spacing below a frame.
[gesture-recognizer.helper.spec.ts](src/app/core/helpers/gesture-recognizer.helper.spec.ts) is the model for a state
machine with no clock of its own: every sample carries its time, so the specs are plain calls with made-up timestamps.
[touch-input.service.spec.ts](src/app/core/services/game/touch-input.service.spec.ts) is the one DOM spec worth copying:
real elements, js-dos's handlers stood in for by a bubbling listener, a `scenario()` helper that builds the rig INSIDE
`fakeAsync` (attaching starts the engine's timers) and detaches in a `finally`.
[win9x-palette.spec.ts](src/theme/win9x-palette.spec.ts) is the model for asserting CSS: karma loads
`src/global.scss`, so it probes the real `.win9x-roster-*` rules and `:root` tokens for contrast
instead of keeping a second copy of the hex values. [save-game.service.spec.ts](src/app/core/services/game/save-game.service.spec.ts)
is the model for "code that reads a browser store": karma's Chrome has a real IndexedDB, so the spec
builds `js-dos-cache (spec …)` databases shaped like js-dos's and deletes every `js-dos-cache*`
database before and after each case. [save-policy.helper.spec.ts](src/app/core/helpers/save-policy.helper.spec.ts)
is the model for a decision that must not drift: the table is written out row by row (purpose x answer), and the
rule the table exists for (`null`, "OCR could not read it", is never the all-clear) is asserted again on its own.
[save-backup.roundtrip.spec.ts](src/app/core/services/game/save-backup.roundtrip.spec.ts) is the model for both ends of
a file format: the export is fed to the import through the two services the page calls, against a stand-in emulator
that keeps its changed files in a zip like js-dos's. [game-exit.helper.spec.ts](src/app/core/helpers/game-exit.helper.spec.ts)
is the model for "real pixel data as a fixture": the frames in [game-exit.fixtures.ts](src/app/core/helpers/game-exit.fixtures.ts)
are captures of the live guest (`dosCI.screenshot()` via the touch harness), stored as a palette plus one deflated
index per pixel (1 to 9 KB a frame, 54 KB for ten) by [scripts/frame-fixtures/](scripts/frame-fixtures/make-fixtures.mjs)
and inflated in the spec with `DecompressionStream`; the specs then paint on copies of them (a cursor over the icon, a second icon).
[key-repeat.helper.spec.ts](src/app/core/helpers/key-repeat.helper.spec.ts) is the model for "a timer-driven helper that must
leave nothing scheduled": zone.js's fake timers, a queue depth the spec moves, `{ flush: false }` on the cases that assert it.
[deck-key.directive.spec.ts](src/app/core/components/dock/deck-key.directive.spec.ts) is the model for "a directive whose worst bug
only shows with real events": a host component with real buttons, real `PointerEvent`s and a spied `performance.now` that is
**never reset between specs**, because the guard it tests keeps its clock in a static. One trap there: this repo's TestBed is
zoneless, where `fixture.detectChanges()` refreshes only a view that was marked dirty and a plain field a spec writes is not a
signal, so the change is never applied and the dev-mode check throws NG0100 (mark the fixture, then detect).
[storage-keys.spec.ts](src/app/core/services/shared/storage-keys.spec.ts) writes every `STORAGE_KEY` to every place the
registry says it lives, runs the real wipe against the real Ionic Storage and fails if anything is left. One trap in a
service spec: a synthetic `beforeunload` on the real `window` reaches Karma's own handler and fails the whole run
("Some of your tests did a full page reload!"), so `SaveSafetyService.unloadTarget()` is overridable and the spec dispatches
on a stand-in. Write specs for pure logic (helpers,
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

Direct touch has the same problem in another shape: it is blind dead reckoning, so the only way to know a tap
landed where the finger was is to read the guest's cursor out of its RAM from outside. That is
[scripts/touch-harness/](scripts/touch-harness/README.md): a driver, a RAM oracle, and the checks (tap accuracy over 18
screens per send spacing, the gain table, the frame period, drift, stuck buttons, the Macintosh-user-agent iPad matrix,
the "Modo de toque" UI, and the edge cases a review found: a fast second tap, a retry after a miss, a drag past the send
budget, the audio wake), with the tables the constants rest on. **Re-run it after any change to the video mode, the
Windows mouse settings, js-dos or the disk image.** It needs a dev build (`window.ng`) served with `--live-reload=false`.

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

`game.js` exposes four browser globals, typed for TypeScript in
[src/scripts/game.d.ts](src/scripts/game.d.ts) and called directly from Angular services:

- `elifootMain(pathPrefix, gameBundleURL, onProgress?)` — creates the DOS instance in
  `#game-container`, runs the bundle, resolves the command interface (`dosCI`). `onProgress(text)`
  gets js-dos's own loading text on every change, in English and unparsed (`BootProgressHelper`
  makes the pt-BR line). **Error contract:** it rejects with the real error from `Dos()`/`run()`,
  name and message untouched (a non-Error rejection keeps whatever `name`/`message` it carries),
  or with an Error named `JsdosTimeoutError` (carrying `lastProgress`) when js-dos goes 20 s
  without changing that text (60 s after the download completes) or one wait passes 120 s. A
  timeout ends the *wait*, not the boot: see *Booting the emulator* below. It also hands `Dos()`
  `layersOptions: { keyboardDiv: <a div that is never attached> }`, so js-dos builds its on-screen
  keyboard (63 keys 19 css px wide, over 60% of a portrait picture) where nothing can see it;
  `toggleSoftKeyboard` is gone, and `global.scss` hides `.emulator-keyboard` as the net under the
  option in case a js-dos update stops honouring it. Checked in the app: no `.emulator-keyboard` in the page.
- `saveGameFileSystem()` — `dosInstance.layers.save()`, i.e. flush changed FS to IndexedDB.
- `dosInstance` — the raw js-dos instance, needed by `PatchService` for `emulatorsUi.persist` and by `GamePage`
  for `layers` (`root`, `mouseOverlay`, `canvas`), the elements direct touch attaches to.
- `getDosAudioNode()` — js-dos's own `ScriptProcessorNode`, or `null`. js-dos builds its
  `AudioContext` privately inside `run()`, so `game.js` wraps `AudioContext.prototype
  .createScriptProcessor` at load (before `elifootMain` can run) and keeps the one node created
  with no inputs and one output. That wrapper is the only patch to a global in the app; it
  exists for `MultiplayerAudioService` (see the audio invariant below).

[src/app/core/typings/jsdos.d.ts](src/app/core/typings/jsdos.d.ts) is a hand-maintained typing of the js-dos
command interface (`DosCI`) — screenshot, key/mouse injection, `persist()`, `readMemory`,
`writeMemory`. `GamePage.dosCI` is `any` and gets threaded into every service as a parameter, and into the control deck as an `@Input` (which
sends through the key queue and keeps nothing); no singleton owns it. Four root services touch it for longer than a call: the key queue (see *Typing into the
guest*), which keeps it only for the length of a job, `TouchInputService` (see *Touching the guest*), which
holds it from `attach()` to `detach()`, and `SaveSafetyService` and `GameExitWatcherService` (see *Save safety
nets*), which hold it from `GamePage.loadConfig()` to `stopSafetyNets()`. `GamePage.ngOnDestroy` cancels whatever
is still queued, detaches and stops them.

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
and the one `localStorage` key the diagnostics log keeps its tail in (see *Diagnostics log*). What is wiped
is not a list in a method: `STORAGE_KEY_HOMES` in [constants.ts](src/app/core/models/constants.ts) says where each
`STORAGE_KEY` lives (`Record<keyof typeof STORAGE_KEY, ...>`, so a key added without deciding that does not
compile), `LocalStorageService.clearAllData` derives its `localStorage` removals from it, and
[storage-keys.spec.ts](src/app/core/services/shared/storage-keys.spec.ts) proves the wipe leaves nothing standing.
Nothing survives the wipe today; a key that ever must needs `clearAllData` to learn to spare it and the spec to name it.

### Save safety nets

What stops progress from vanishing without anyone choosing it, and what tells the player it is safe. It is the
work of P5; the design record is [docs/mobile-ux-study.md](docs/mobile-ux-study.md).

**What "saved" means.** One thing: the emulator's changes layer was written to IndexedDB (`layers.save()`). Every
persist in the app goes through `SaveGameService.saveGame()`, which runs **one flush at a time** (a second
`layers.save()` started while the first reads the disk is not something the emulator promises to survive; the
auto-saver's own serialisation composes with it) and reports start and end to
[`SaveStatusService`](src/app/core/services/shared/save-status.service.ts). The layer holds whatever the game had written to its own
files by then; it does not hold the game's state in memory (Elifoot writes its `.e98` at kickoffs). That is why the
status also tracks **input since the last persist**: `dirty` is set by any pointer-down or key aimed at
`#game-container` (document-level capture listeners, so a finger the touch layer takes over is still seen) and by the
key queue's `activity$` (virtual keys never become a DOM event), and it is a *counter*, not a flag: a persist
remembers the count as it began, and only clears `dirty` if nothing moved meanwhile, so a click that lands during
the second a persist takes is not called saved. It is conservative by nature (it cannot tell a click on a tab from a
click that changed the game) and errs towards "not saved".

**The chip** (`app-save-status-chip`, `.save-chip` in `global.scss`) sits in the game toolbar's end slot and says
`Salvo às 14:32` / `Salvo ontem 21:14` / `Salvo em 20/10 21:14` / `Salvando…` / `Sem salvar há 12 min` (unsaved
input older than 10 minutes, amber) / `Falha ao salvar` / `Ainda não salvo`, in `SaveStatusHelper`'s words; a tap is
`GamePage.saveNow()`. **It is shell, flat, not Win9x**, for the reason the room pill is: it renders inside a page
toolbar. It shares that toolbar's title slot with the pill, and the pill needs 119 px of a title that has 168 at 360 px
(the title has 20 px of padding each side), so while a room is live the chip drops its words below 600 px and
steps aside altogether below 402 px (measured: with the dot only the pill was still cut to 78 px at 360 and its
code with it). Mobile landscape has no toolbar; the menu's first entry, "Salvar agora", carries the same words as its
subtitle. `lastPersistedAt`, `firstPersistedAt`, `lastBackupAt` and the nudge's answer are `STORAGE_KEY`s in Ionic
Storage, and `GamePage.clearAllData` calls `freeze()` before the wipe so a persist that finishes after it cannot
write its timestamp back (the diagnostics tail had the same bug through `pagehide`).

**`isGameSaving` is three-valued everywhere, and `null` is never "not saving".** [`SavePolicyHelper`](src/app/core/helpers/save-policy.helper.ts)
holds the table, and what differs between rows is the price of being wrong. `hidden` (nobody asked) persists only on
a proven `false`. `reload` (throws the page away) persists only on a proven `false`, refuses on `true` ("O jogo está
gravando": try again in a moment), and on `null` **asks the person** ("Recarregar sem salvar") rather than pretend. `manual` and `leave` (the player asked, and the
leave dialog promises a save) persist on `false` and on `null`, because with the OCR down the button is the only
manual save there is and the forced periodic save runs just as unguarded; only a seen dialog waits (`manual` says the
auto-saver will take it as the dialog closes; `leave` waits for it, at most 15 s). Such a save is not passed off as a
clean one: `saveNow` returns `verified: false` and the toast says it could not confirm whether the game was writing
(amber, 5 s) instead of the plain "Jogo salvo". `SaveSafetyService.look()` does
not ask at all when the auto-saver is not running (asking starts the OCR worker's 5 MB download for a page that
switched auto-save off) and counts that, a throw and a look that overruns the heartbeat as `null`. **So the leave
has to flush BEFORE it stops the auto-saver**: stopped first, the look is `null` and the wait for the dialog never
happens (it was dead code in the first cut). `leaveGameToMenu` flushes, then stops the tickers and the nets, then exits
the emulator; if the nets were never attached (`no-emulator`) it falls back to a plain `saveGame()`, as the old path did. Every persist
the safety service starts is **bounded to `AUTO_SAVER.PERSIST_TIMEOUT_MS`** and ends as a failed save, because each
sits behind a loader the player cannot dismiss and IndexedDB is known to stall after a phone has been in the
background; the deadline stops the *wait*, not the flush, so `saveGame()` keeps its queue and a later persist behind a
stuck one times out the same way (the chip says "Salvando…" for as long as the flush is truly in flight). The export refuses
only a proven `true` (`isGameWriting`): it copies the disk without writing it, but a copy made under the game's write
holds a half file. The update prompt is the one path that does not use the table: `AutoSaverService` tells
`SaveStatusService.setGameWriting()` for as long as it has *seen* the dialog, `installUpdate()` waits that out for
at most `APP_UPDATE.IDLE_WAIT_MS` and then persists whatever the OCR could read, because the reload is certain and
what is not saved is lost for sure. With the OCR down that path can still race a write, as the forced periodic save can.

**The page going hidden persists, a little.** `visibilitychange` to hidden (the last event a mobile browser reliably
delivers before it may freeze the tab; `pagehide` leaves no time for an asynchronous write) runs
`SavePolicyHelper.gateHidden` in the order that spares the most work: an emulator, input since the last persist,
no hide-persist in the last `HIDDEN_PERSIST_MIN_GAP_MS` (3 min; a failed attempt counts, so a broken disk is not retried
on every tab flip), the auto-saver running; only then does it look at the screen, and only a `false` persists. It gives
up if the page is visible again by the time the look comes back. Every decision is a `save` line in the diagnostics
log (`hidden: no persist {"reason":…}`). After the first persist that worked the app asks `navigator.storage.persist()`
once per page (feature-detected; the answer is logged and kept in `SaveStatusService.durable`, and no copy promises
protection the browser may refuse).

**Flows that rewrite the layer stop the savers, and give them back only if nothing was written.** A patch, a clear of
a patch, the save import and the resolution switch each stop the auto-saver, the periodic save and the nets first
(a persist of the running VM would write the old disk over what they are about to write), and when one fails BEFORE the
write `GamePage.restoreSaving()` turns them back on, so a failed patch does not leave a game that plays on with no
chip, no page-hidden save and no `beforeunload`. Once the layer is written they stay off whatever happens next
(`written` in `applyPatch` and `applySaveGamePatch`): the reload is coming, and persisting the running VM would undo it.

**The ways out of the game page.** `GamePageRoutingModule` has a `canDeactivate` that asks the page
([`NavigationGuardHelper`](src/app/core/helpers/navigation-guard.helper.ts)): a navigation that stays on `/game`
(`?host=1` is stripped by one), one the page started (`leaving`), and one with no emulator to lose pass; anything else
opens the existing "Voltar ao menu?" dialog once (a Back pressed while it is open changes nothing). Only the game page is guarded. **The router
has to be told how to put the address back:** its default (`canceledNavigationResolution: 'replace'`) rewrites the
history entry the browser already moved to, which loses a level: measured, the first Back asked and the next one left
the page with no question. `AppRoutingModule` sets `'computed'`, which walks the history pointer back, and the same
sequence (Back, Back with the dialog open, Cancelar, Back, `router.navigate`) was one dialog each time with
`history.length` constant. Nothing is pushed, so nothing is trapped. `beforeunload` asks the browser to confirm only when
`dirty` or hosting, and **every reload the app starts goes through `GamePage.reloadPage()` (or calls
`SaveStatusService.allowExit()` first)**, which is what keeps a deliberate reload from asking: the player has just
answered. A new `window.location.reload()` in the game page that skips it would ask twice. "Recarregar" is now "Salvar e
recarregar": confirm, then `saveBeforeReload()`, then reload only on a proven all-clear.

**The backup is one file format with both ends in one place** ([`SaveBackupHelper`](src/app/core/helpers/save-backup.helper.ts)).
Export writes a flat zip of `NAME.E98` named `elifoot98_saves_YYYY-MM-DD_HH-mm-ss.zip` (the older names counted
the month from 0; every download is now stamped by `SaveBackupHelper.fileStamp`). Import takes `.e98` files and
`.zip` backups, several at once, and from a zip takes every `.e98` wherever it sits (so the full-disk copy of the
boot-failure dialog restores its saves, and a Mac zip's `__MACOSX/._NAME.E98` shadows are skipped). The confirm lists
what will be added and flags the ones that replace a save the guest already has (read from the live `dosCI.persist()`,
since the bundle ships no `.E98`); unreadable zips and unusable files are named, not fatal. **Both file inputs are
emptied in `finally`** (a `change` fires only when the value changes, so choosing the same file again after "Cancelar"
did nothing), after the files are copied out of `input.files`, and an empty selection is a no-op. Import stops the
auto-saver and the safety nets first, like a patch: a persist of the running VM would write the imported saves out again.
**Sharing is a button, not a side effect:** Safari honours `navigator.share()` only inside the tap, and the zip takes longer
than a gesture, so on a coarse pointer whose browser says `canShare({files})` the page builds the backup, then offers
"Baixar arquivo" / "Compartilhar…", and `deliverBackup('share')` calls `navigator.share` before awaiting anything
(checked: `navigator.userActivation.isActive` was true inside the call). A desktop downloads at once. A share closed by the
player (`AbortError`) is not a backup; any other failure downloads instead. A week without a backup (counted from the
first save when there never was one) earns **one** dismissible reminder, ever: answering it, either way, is stored.
It is shown only when the disk holds at least one `.e98` (`PatchService.existingSaveNames`): a visit that only looked
around persists the layer too, and a reminder that is answered with nothing to back up is spent for good.

**Recovery: telling that Elifoot has exited to the Program Manager.** The boot chain leaves Windows with the game as its
only program, so when it quits (Esc or Cancelar in its first dialog, Enter before a choice, a crash) the player is on a
blue desktop with no way back but a reload. **The green probe cannot tell** (see *Screen-scraping*: at 640x480 "green lost"
is the normal state), so [`GameExitHelper`](src/app/core/helpers/game-exit.helper.ts) recognises the desktop itself, and the
signature is nearly the whole frame: a flat `(0, 64, 128)` at every sample of an 8 px grid (all but 8, for the mouse
cursor, which is drawn into the frame) outside the Program Manager's icon, and in that icon's box, a fixed distance from the
bottom-left corner (x 16-61, 60 px tall, 10 px above the edge, identical at 640x480 and 800x600), white text and ink. Measured: the real frame is
99.3% desktop colour; across 127 real frames at 640x480 (every dialog, tab, menu, list and live match of the P4 walk,
the team-colour standings, the team editor and the Program Manager) the desktop colour never appears in any of Elifoot's own screens, not even within a
tolerance of 25, the fewest stray samples in any of them was 3,268 against the 8 allowed, and the only two frames that
matched were the Program Manager's. The programs that share the screen with it leave it 31% (the team editor) and 44%
(the Program Manager window) of the frame, and a second icon (a minimised Elifoot) fails the grid, so none of
them is an exit. A live walk of 20 screens (new game, countries, draw, the main window's five tabs, menus, modals) with the
watcher running never saw a desktop sample. [`GameExitWatcherService`](src/app/core/services/game/game-exit-watcher.service.ts)
looks once a second, needs `LOOKS_NEEDED` (3) in a row (so ~3 s, as the roadmap asks; measured 2.9 s from Esc to the dialog),
resets on anything else, on a `screenshot()` that throws or hangs, and says it **once per episode**: "Agora não" is not
asked again until something else has been on screen. It is armed only once the game's own screen has been seen, because
Windows draws this very desktop while the game loads: the page starts it armed after a boot that saw the game, and
with `armWhen` (the boot's own green probe) when the 45 s window ran out first, so a slow phone is not left without the
dialog for the whole session (checked: the bare desktop never arms it, the splash does, and Esc then raised the dialog
in 2.9 s). It is stopped by every flow that rewrites the layer or leaves. The
banner is a `win9x-alert` ("O Elifoot foi fechado" / "Reiniciar jogo?"); its action leaves the room if one is live
(the dialog says it ends), saves (no isGameSaving check: the game is not running; bounded like every persist), asks the
emulator to exit for at most 3 s, and reloads. The FAQ's team-editor recipe quits the game on purpose and tells
the reader to answer "Agora não". It is a dialog, not a docked banner, because it is
the one thing on screen worth reading and the game behind it is gone. The load-detection pixels are unchanged.

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
**only** thing that sends keys to the guest. A control deck key, the text dialog and anything added later
submit tasks (`chord`, `altCode`, or a whole text planned by `EmulatorKeyCodeHelper`) to one FIFO
with one consumer, so two senders can never overlap. `EmulatorControlService.sendKey` / `sendString` are the thin
wrappers over it that the control deck (`DockComponent.press`) and the text dialog call; the page has no `sendKey` of its own.

Load-bearing invariants — each of these was a bug, or a measured trap:

- **Never call `dosCI.simulateKeyPress`; the queue is the only key sender.** It stamps the release
  16 ms in the future, so a second call within 16 ms loses its key and leaves the guest keyboard
  dead until a reload (5 of 5 repros) — and a reload costs everything since the last save. It was
  easy to hit: the old `sendString` was not awaited, so a FAB tap mid-text did it. The queue sends
  only `sendKeyEvent` down then up, `EMULATOR_CONTROL_CONFIG.KEY_PACING_MS` (10 ms) between groups,
  and never more than `MAX_SYNC_KEY_EVENTS` (14) events without a gap, because DOSBox's keyboard
  buffer drops the rest without an error (129 characters in one burst delivered 14). **It is enforced, not just
  documented:** js-dos's own on-screen keyboard was the last other caller (its keys bind to `simulateKeyPress`
  internally) and it is no longer built, so `no-restricted-syntax` in [eslint.config.mjs](eslint.config.mjs) rejects
  any member access, destructuring or object property named `simulateKeyPress` in app code (checked: `dosCI.simulateKeyPress(1)`,
  `dosCI['simulateKeyPress']`, `const { simulateKeyPress } = x` and `{ simulateKeyPress: … }` each fail). The one declaration
  that has to exist, `@deprecated` in [jsdos.d.ts](src/app/core/typings/jsdos.d.ts), is a property *signature*, which the
  selectors do not match. A spec that needs a fake emulator must not give it that method.
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
  bar, a "next field" button — must not do it on that screen. The control deck's **Enter** and **Esc** keycaps are one
  tap on exactly that hazard (reproduced on the real game: Enter twice from Acerca left Program Manager and the
  recovery dialog came up 3 s later), which is why Alt+F4 has a confirm and these two have P5's recovery.

### Touching the guest (direct touch)

A tap lands where the finger is. js-dos cannot do that against this guest: it treats a user agent that matches
`/iPhone|iPad|iPod|Android/` as a phone and gives it a touchpad (a tap clicks at the OLD cursor position, a swipe moves
the cursor two guest pixels per unit, no drag), gives anything else the desktop pointer-lock path, under which a touch
does NOTHING (a default-UA iPad reports a Mac, so it is the second case), and its absolute mode lands 150-350 px off
(DOSBox keeps its int33 range at 640x200 and Windows 3.1 consumes mickey deltas). So
[touch-input.service.ts](src/app/core/services/game/touch-input.service.ts) takes the finger over before js-dos sees it
and wires four helpers together, the first two of them testable without a DOM:

- [gesture-recognizer.helper.ts](src/app/core/helpers/gesture-recognizer.helper.ts): samples in, intents out, no timer
  and no DOM (the hold is a `deadline` the caller schedules and answers with `advance()`).
- [guest-pointer.helper.ts](src/app/core/helpers/guest-pointer.helper.ts): the engine, `GuestPointerMath` (the guest's
  rules as plain functions) and `GuestPointer` (a serial queue that drives the guest's mouse, with a clock it is
  handed). Depends on nothing but the `DosCI` interface.
- [touch-mode.helper.ts](src/app/core/helpers/touch-mode.helper.ts): the setting, and what the device can run (pure).
- [touch-feedback.helper.ts](src/app/core/helpers/touch-feedback.helper.ts): the ring (DOM, see below).

**The guest's rules, measured with the RAM oracle in [scripts/touch-harness/](scripts/touch-harness/README.md) at
640x480** (the pointer constants live in `TOUCH_INPUT` and must be measured again after any change to the video mode,
the Windows mouse settings, js-dos or the disk image):

- *Per axis, 1 px per unit for an event of 1 or 2 units and 2 px per unit from 3,* the axes independent; clipped to
  [0, width-1] x [0, height-1]. A single positive event of 256 units or more wraps modulo 256 (and -300 does something
  else again), so nothing over 255 is ever sent, and a chunk is at most 90 units. Home = four sends of (-200, -200),
  which clip into the corner: (0, 0) 60 times of 60. A single -2000 worked once and is unproven.
- *The guest sums sends that arrive close together and applies the gain to the sum.* Two 2-unit sends are 1x each, but
  summed they are 4 units and move 8 px. Pairs were summed 40 of 40 times at 14 ms, 11 of 40 at 16 ms, 0 of 40 from
  18 ms: the boundary is the frame, ~16.7 ms. Sends in one tick are summed outright, and then the wrap applies to the
  sum. **Hence one send per frame: `SEND_SPACING_MS` = 24**, counted from the previous send's real time (a late timer
  only widens the gap), and also between the last send and a button event. Over 18 screens x 144 taps every spacing
  from 16 to 40 ms stayed within 3 px (worst 3 at 16, 2 from 18); **24 is not the smallest that passes (18), it is the
  boundary plus 7 ms**, because the margin costs nothing a person can feel (the click follows the lift by 0.1 ms,
  because the cursor walks during the touch; at 40 ms it is 9 ms) and the phone's emulator is unmeasured.
- *There is a 2 px quantum.* Now and then a send lands 2 px further than the rules say, on one axis, at any gap. It
  comes and goes and does not accumulate (160 far and 250 short taps with re-homing off: model error 0 throughout;
  across the 108 short sweep runs it left 0 in 14), and it is why a tap is graded against 3 px, not 1.
- *Elifoot and Windows never warp the cursor* when a menu, tab or modal opens (12 steps, 0 px). Not reached: the loan
  and auction prompts and the live match's dialogs.

Load-bearing invariants, each measured or a bug waiting:

- **Blind dead reckoning, no `readMemory`.** The model adds exactly what the guest applies and clips as it does; it
  is homed to (0, 0) first. The RAM oracle (the cursor as two `uint16`s, found by verify-then-scan) is a harness tool: it
  couples to addresses that may move, and `readMemory` rejects concurrent calls, which the Cheat 'O Matic would hit.
- **The listeners are on `layers.root`, in the capture phase, and chosen by `pointerType`, never by user agent.** They
  `stopPropagation()` for `touch` and `pen` pointers aimed at js-dos's overlay or canvas, so its own handlers (on the
  overlay, bubbling) never see a finger. A real mouse is not touched (desktop pointer lock, a hybrid laptop, an iPad
  with a mouse all behave as before), and neither is anything else inside the root (js-dos's own controls; the control deck is
  outside it, a sibling of `#game-container`).
  `layers.pointerDisabled` was rejected: it disables the mouse path too. A mouse event within 500 ms of a touch is the
  browser's copy of it and is dropped (on a default-UA iPad js-dos would answer a stray `mousedown` with a pointer
  lock). Touch events are cancelled too, `gesturestart` as well; `touch-action`, `user-select` and `-webkit-touch-callout`
  are js-dos's own on `.emulator-root`, and `#game-container` adds `overscroll-behavior: none`.
- **A real mouse makes the model forget the cursor** (`invalidate()`): both can move one guest cursor on a hybrid
  device, and the engine only knows what it sent, so the next touch re-homes.
- **Every way a gesture can end releases the button, synchronously.** `GuestPointer.abort()` drops the queue, makes any
  op in flight stand down (an epoch counter: a late timer cannot press or release for a cancelled gesture) and
  releases at once. It runs on the recognizer's cancel, `pointercancel`, a `touchend` with no `pointerup` (checked
  80 ms later, and called off by any finger that lands in between: what is down by then is a NEW gesture, and cancelling
  it lost every fast second tap), any `visibilitychange`, `freeze`, `blur`, `pagehide`, a finger silent for 20 s, and
  `detach()`. A press whose position is lost (the frame changed, a real mouse moved the cursor) is released rather than
  homed, because a home with the button down drags what is under the cursor to the corner. A
  hidden page's timers are throttled or frozen, so the release of a held button cannot be left to one. Checked in
  `stuck-button.mjs`; a real background/foreground switch could not be reproduced (CDP delivers no lifecycle event).
- **The click is at release, at the point where the finger LANDED** (the cursor was sent there at touch-down, so the
  click follows the lift by ~0.1 ms). That is what lets a second finger cancel a touch before anything happened.
- **A double-tap is a real `WM_LBUTTONDBLCLK`:** the second tap (within 400 ms of the first lifting and 32 px of where it
  landed) clicks again WITHOUT moving the cursor, and its touch-down says `preAim: false` so the cursor is not sent to a
  finger that landed 20 px away, which could leave Windows' double-click rectangle. Measured on the country list, where
  each click toggles a row: a double tap leaves the row selected, two taps 900 ms apart toggle it on and off. A tap that
  clicked nothing (it landed in the strip beside the picture) is taken back with `forgetTap()`, or the retry would be a
  "double-tap" that clicks wherever the cursor was last left. **Known
  risk:** two quick taps on adjacent rows (within 400 ms and 32 px, ~50 guest px) read as a double-tap on the first; the
  thresholds are one line each in `TOUCH_INPUT` and are on the device checklist.
- **A drag presses where the finger landed** (movement past 10 css px before 450 ms), follows at the engine's pace
  (latest target wins) and releases where it lifted. **Holding still 450 ms is aim mode:** the cursor is parked 56 css px
  above the finger, follows it, and the click is at release (`HOLD_MODE: 'none'` turns it into a slow tap).
- **A second finger cancels the gesture, and the touch stays dead until every finger is up.** Two-finger gestures are
  reserved for the camera planned for P11, so they mean nothing now. A palm (contact radius over 48 css px) is ignored
  outright, not tracked. There is no right click: no tested Elifoot screen reacts to one.
- **Scrolling is the scrollbar.** Dragging the 16 px thumb scrolls a list without touching the selection, and a tap in
  the trough pages it (both on the country list). Mapping a drag to Up/Down was tested and rejected: in that list the
  arrow and page keys SELECT as they move (the counter went 20, 25, 38, 40, 43).
- **A move is one op whose target is replaced while it runs, and nothing is ever sent twice in a tick.** Chunks of at
  most 90 units so that two summed chunks stay under 256. `GuestPointerMath.isSendable` refuses anything that is not a
  whole number in range: a NaN poisons the guest's mouse until the page reloads (found in P4).
- **Re-homing is rare and in place.** The cursor is part of the stream the spectators watch, so a re-home flings it to
  the corner. It happens only after 900 ms of quiet AND more than 12 moves since the last home, or when the frame size
  changes, or after `invalidate()`, or (a safety net) 600 sends; and the cursor walks back to where it was, as an ordinary
  move, so a finger that lands meanwhile redirects it. **Never while a finger is down** (aim mode holds one still, which
  from the engine's side looks exactly like idle; the layer tells it with `setFingerDown()`), and the 600-send budget
  never fires with the button held, it waits for the release. It also homes once when the layer attaches, before anyone is touching, but only on a device with a touch screen (`any-pointer: coarse`): on a plain desktop it would move the guest's cursor for nothing.
- **A lifted finger wakes the game's audio.** js-dos builds its `AudioContext` inside `run()`, before any gesture, and wakes
  it from a one-shot `click`/`touchstart`/`keydown` listener on `document`. This layer stops the touch at `layers.root` and
  cancels the click the browser would have made of it, so on iOS (a context made outside a gesture stays suspended) the game
  would stay silent, and a hosting phone would stream silence, until the person tapped something outside the game. So
  `pointerup` and `touchend` of a handled touch call `resume()` on `getDosAudioNode()`'s context when it is not running.
  **Why:** stock js-dos on a phone stopped `touchstart` at the overlay too, but the click still reached `document`. The
  headless shell used by the harness resumes a context once per boot and then leaves `resume()` pending, so the check
  grades the request, not the state.
- **The tap ring is DOM on the host, never pixels in the guest's frame.** `.touch-feedback` nodes are appended to
  `#game-container` (absolute, `pointer-events: none`, transform and opacity only), so the stream the spectators get and
  every screen-scraper (`dosCI.screenshot()`) never see them, and they cannot resize the surface. The look is neutral on
  purpose, not Win9x (it is feedback, not a window), and survives `prefers-reduced-motion` as a fade.
- **The layer runs outside Angular's zone** (pointer events arrive at the display rate), holds the emulator only
  between `attach()` and `detach()`, and `GamePage.ngOnDestroy`, "Voltar ao menu" and a switch to classic detach it.
  All keys still go through the key queue; this layer sends none.

**The setting is "Modo de toque": Direto (default) | Touchpad (clássico)** (`STORAGE_KEY.TOUCH_MODE`, cleared by "Apagar
todos os dados"). Classic means the layer is not installed, so stock js-dos, whose handlers are always bound, takes the
finger; it switches live, with no reload. **It is only real where js-dos itself calls the device a phone** (its UA test,
copied into `TouchModeHelper.stockTouchWorks`): on a default-UA iPad, or a phone asked for its "desktop site", classic
would be a dead screen (the harness has the control), so `effective()` turns a stored `classic` into `direct` there and
the entry is not offered. It is offered only under `(pointer: coarse)` (the options popover, `touchModeChoice$`); the layer
itself is installed everywhere, because it only reacts to fingers and pens.

**Verified only in headless Chromium with synthetic touches on a desktop CPU.** Real fingers err by 25-40 css px
(recalled), so the thresholds are untested where they matter; iOS Safari (compat events, `touch-action`, edge swipes,
pull-to-refresh, callouts), a phone's emulator speed (which could sum sends the desktop never did), the real lifecycle
and a hosting phone with a spectator watching the cursor are not. The PR carries the device checklist.

### The control deck (the keys of a phone)

One docked panel of keycaps replaced three `ion-fab` clusters, the header's keyboard / text / O Matic buttons, the options
menu's "Teclado Virtual" and js-dos's own keyboard: four copies of the same dozen actions that collided with each other, the
header and the chat. It is `app-dock` ([dock.component.ts](src/app/core/components/dock/dock.component.ts)), with
[deck-key.directive.ts](src/app/core/components/dock/deck-key.directive.ts) for the keycaps, the pure helpers
[deck-keys](src/app/core/helpers/deck-keys.helper.ts), [deck-layout](src/app/core/helpers/deck-layout.helper.ts),
[deck-panel](src/app/core/helpers/deck-panel.helper.ts), [key-repeat](src/app/core/helpers/key-repeat.helper.ts),
[modifier-latch](src/app/core/helpers/modifier-latch.helper.ts) and [layout-shape](src/app/core/helpers/layout-shape.helper.ts)
(all specced), `DECK` in [constants.ts](src/app/core/models/constants.ts), the layout in [_deck.scss](src/theme/_deck.scss) and
the skin in the "Control deck" block of [_win9x.scss](src/theme/_win9x.scss): `.deck-key` (every keycap and taskbar button) and
`.deck-face` (the grey the panels stand on) with their states. Decision D3's Win9x look is a **CSS-only flip** to flat, but not a
two-rule one: `_deck.scss` also names Win9x tokens in a handful of declarations (the band's face and its seam, the taskbar's seam, the
sheet's title bar and border, the unread flash), and `grep -n 'win9x-' src/theme/_deck.scss` lists every one a flip must touch. The
design record is [docs/mobile-ux-study.md](docs/mobile-ux-study.md) (P10).

**The layout contract, which no new control may break: the deck is a SIBLING of `#game-container`, never a child, never over
the picture, and the picture's box does not depend on it.** js-dos re-lays-out its canvas whenever that element changes size,
and the cursor overlay and every remote cursor are measured against it. In portrait the picture is already pinned to its 4:3
height (75vw, `flex: 0 0`) and the band under it is free, so the deck is a flex item after it. `DeckLayoutHelper.presentation`
is a pure function of the viewport, the primary pointer and the player's setting, and it returns one of three things:

- `none`: no deck. A desktop with a mouse and a keyboard is not cluttered by default, and a touch laptop (touch is only its
  `any-pointer`) is the same. The floating chat toggle is untouched there.
- `band`: portrait only, and only where the band under the picture is at least `DECK.MIN_BAND_HEIGHT` (225 px: Táticas needs about
  220 for its two rows of formation keys to be 44 px, and `deck-layout.helper.spec.ts` derives that from the constant. A 360x640
  phone has 314, but the same phone in a Chrome tab with its URL and navigation bars is ~512 tall and has ~186, and an iPhone SE
  in a Safari tab has 216: both got 32-42 px formation keys under the first threshold of 150 and now get the launcher). A **taskbar** that
  stays at the bottom (it is pushed there with `margin-top: auto`; without it a folded deck rode up under the picture and the
  tabs jumped 440 px on the tap that folded them) and **one panel at a time** above it: Táticas, Setas, Mais teclas, or the
  page's chat. Texto is a taskbar button that opens the P1 compose dialog, and Chat appears only while hosting. A second tap on
  the open tab folds the panel; the picture does not grow into the band.
- `launcher`: every other shape. Landscape has no free band (the picture takes the height), so the same panels open as a
  **sheet** over the page from a "Teclas" button: in the toolbar where there is one (a landscape tablet or laptop window), in the
  left gutter beside the picture when the toolbar is dropped (`landscape-compact`: a landscape phone), under the round options
  button and the room pill, all three in `.gutter-controls`. The sheet is `position: absolute` and takes no space, so it never
  resizes the container; it does cover the left part of the picture while it is open. Until the later stage-layout phase builds
  rails this is the whole landscape deck.

**Tablets** follow the shape: a portrait iPad (768x1024, 820x1180) gets the band, which fits all three panels with room to spare
(the keys are capped at 290 px of height there, and rest at the bottom where the thumbs are); a landscape one has no band and
gets the launcher. Both were compared on screenshots; a sheet in portrait would have thrown away a 450-510 px band for nothing.

**The picture's box was measured with and without the deck, and with the sheet open, at 13 viewports** (360x640, 375x667,
393x852, 412x915, 430x932, 844x390, 932x430, 667x375, 820x1180, 1180x820, 1024x768, 768x1024, 1280x800; touch emulation;
chrome-headless-shell 143): `#game-container` and the canvas inside it had the same rectangle every time. In portrait every
keycap of every panel is at least 44x44 css px under `(pointer: coarse)`, none is over the picture and none is outside the
viewport, and "Mais teclas" (five rows) fits the 254 px panel of a 360x640 phone without scrolling. **The short windows are
measured too** (375x553, 360x512, 320x460 in portrait: the launcher; 667x340, 667x320, 852x340, 800x290 in landscape: the
sheet, whose "Mais teclas" scrolls): no two keycaps overlap in any panel and every key is inside the viewport or reachable by
scrolling. A scroll panel's children must not shrink (`flex-shrink: 0` in `_deck.scss`): with the default they squeezed into a panel
shorter than the keys, the 44 px rows overflowed their boxes and `Num *`, O Matic and Sair were painted over the F keys, so a tap
aimed at F7 would have landed on one of them (measured as overlapping boxes, not tapped). `deck.mjs layout` asserts the overlap,
and fails with that rule undone.

**What the keycap promises** ([DeckKeyDirective](src/app/core/components/dock/deck-key.directive.ts)):

- **It presses on `pointerdown`**, not `click`, with `preventDefault()` on the pointerdown and the mousedown and
  `tabindex="-1"`, so the focus stays in `.emulator-root` (checked: after five taps on keys and tabs the active element was
  still `.emulator-root`) and the OS keyboard never opens. The pressed look is the `deck-key--down` class, not `:active`.
- **It releases exactly once, however the press ends**: `pointerup`, `pointercancel`, `lostpointercapture`, the window losing
  focus, the page being hidden, the key being disabled or destroyed under the finger. A held arrow hangs its stop on that.
- **A key inside a panel that can scroll presses on release** (`deckKeyOn="up"`), because the scroll gesture starts as a touch
  on a key. Keys that repeat cannot do this and keep the landing, so they take no part in panning instead: `.deck-key--landing`
  is `touch-action: none` on the key itself. *Why:* the browser stops intersecting `touch-action` at the nearest scroll container,
  so the deck's `none` never reaches a key inside "Mais teclas" or the sheet and the panel's `pan-y` did: 40 px of vertical
  drift (a thumb holding an arrow in the sheet) became a scroll, the browser sent `pointercancel` and the hold stopped, and a drag
  that began on Apagar typed a Backspace and then scrolled (reproduced in headless Chrome 143 with touch emulation: `pointercancel`
  at 40 px without the class, never with it). The panel still scrolls from its gaps and from every key that presses on release.
- **A `click` is only trusted when no keycap's pointer released in the last `CLICK_AFTER_POINTER_MS` (700 ms).** TalkBack,
  VoiceOver, a switch and a keyboard activate a button with a click and no pointer at all, so a click with nothing before it is a
  press and a release. But the browser makes the click of a tap *after the lift and aims it at whatever is under the finger then*.
  **The first version showed a bar when a modifier was tapped, which moved every key up 44 px; the click landed on Tab and Shift
  sent Shift+Tab** (reproduced on the real game: a stray plain Tab 500 ms after every modifier tap). Two fixes, both needed: the
  guard's clock is shared by every keycap (a static), and **nothing the deck shows may change the keys' geometry between a
  press and its release**. That is why a latched modifier is a lit key and a label on the "Mais" tab, with a
  screen-reader-only live region, and not a bar.
- **The keys are disabled until an emulator exists, while the page is leaving, and while the key queue is faulted**
  (`GuestKeyQueueService.faulted$`: the emulator itself threw while a task went out; for `KEY_FAULT_COOLDOWN_MS` or until a
  submission goes out whole). A held arrow therefore does not raise the same error on every tick; `GamePage.onKeyFailure`
  still rate-limits the alert.

**The key table is one place** ([DeckKeyHelper](src/app/core/helpers/deck-keys.helper.ts)): F1-F12 with the formation caption of
each from `GAME_INPUT_FN_BTNS` (the only table; the reversed copy for the old portrait FAB column died with the FABs), `A`
Automático, `M` Melhores, the cross, Enter, Esc, Tab, Shift+Tab, Backspace, Space, Del, PgUp/PgDn, Home/End, and the keypad `*`
and `-`. **Decision D8: `*` is the player search for the "craque" attribute and `-` is where the serial registration key is
typed, and they are labelled "Craque" and "Registro"**; the key codes are right (332, 333) but no visible effect was seen on the
screen they were pressed on (the squad selection), so what they do in the game is on the device checklist. Every key was pressed
on the real game: the codes reach the guest (F1-F12 are 290-301; F5, F6 and F8-F12 each give a different formation screen, F1-F4 and F7 repeat the
previous frame, which was not investigated), Enter closes Acerca, Tab moves the focus between Registo's fields, the arrows move the
squad and country lists, `A` selects the automatic squad, Backspace deletes, and "Texto" typed "Zé" and "João". **Alt+F4 ("Sair") is
the only guarded key**: a `win9x-alert` says it leaves for the Program Manager and that the app offers the restart, Cancelar sends
nothing, "Fechar o jogo" sends Alt+F4 and the recovery dialog was up within 3.5 s.

**Hold-to-repeat** ([KeyRepeatScheduler](src/app/core/helpers/key-repeat.helper.ts); the arrows, Backspace, Del, PgUp, PgDn): the
press as the finger lands, `REPEAT_DELAY_MS` 380, then every `REPEAT_INTERVAL_MS` 55. **A tick that finds the queue holding
`REPEAT_MAX_PENDING` (2) tasks is skipped, not queued**, so a slow device never keeps typing after the finger lifts; `maxHoldMs`
(30 s) ends a hold nobody released; `stop()` is the only thing that has to be called and it clears every timer. The timers run
outside Angular's zone. Measured on the country list: a 1.5 s hold sent 22 presses, the first repeat 380 ms after the landing and
the rest 55-57 ms apart, each one landed (24 countries after 2 + 22), and the repeat stopped on a release, `touchcancel`, a
window `blur`, the page being hidden, a panel switched under the finger, the page leaving and the queue faulting (9 presses at
800 ms and 9 at 1.5 s, in every case).

**Sticky modifiers** ([ModifierLatch](src/app/core/helpers/modifier-latch.helper.ts)): a tap latches Shift, Ctrl or Alt for the next
key (and the next key lets it go); a second tap within `LATCH_DOUBLE_TAP_MS` locks it; a tap on a lock lets it go. **Nothing is
ever held down in the guest**: the latch is put round the next key's chord, which the queue presses and releases whole, so a
latch the page forgets can only be a lit button, never a stuck Shift in the game. It is cleared by a window blur, the page being
hidden, the layout changing and the deck being destroyed. Checked on the real game: Shift then Tab sent Shift+Tab once; a Ctrl lock
sent Ctrl+Home and Ctrl+End and stayed lit, the "Mais" tab named it from another panel, and a `blur` cleared it (Ctrl+Esc opened
Windows 3.1's Task List, which is also the proof that a chord reaches the guest).

**The chat stays the page's.** The page mounts `#chat-panel` above the deck and keeps its open/closed state, unread count and
focus; the deck mirrors them and asks for changes through `(chatToggle)`, so a chat opened from the options menu shows in the
taskbar too. Opening a panel of keys closes the chat and the chat opens over whatever panel was up (`DeckPanelHelper`). Under the
OS keyboard the chat lifts by `--kb-inset` less the taskbar (`.has-deck-band` in `_deck.scss`), because the taskbar sits in the
flow below it. Checked in a real two-peer session (the host a 393x852 phone emulation, the spectator a desktop browser, public
nostr relays): the spectator's video was live and 640x480 for 248 s, its chat message arrived (the Chat tab showed 1 unread),
opening it docked the chat above the taskbar, and the host's picture rectangle did not move. The OS keyboard over the chat is
**not** verified (headless has none).

**Settings** (both `STORAGE_KEY`s, both wiped by "Apagar todos os dados"): `DECK_MODE`, "Mostrar painel de teclas" in the options
menu (Automático, Sempre mostrar, Nunca mostrar; it applies at once, and its subtitle says what Automático comes to on this
device, including the touch laptop whose mouse is the primary pointer), and `DISABLE_KEY_VIBRATION`, "Vibração nas teclas"
(stored as the OFF flag so that every existing install means on; offered only where `navigator.vibrate` exists, so not on iOS; a
buzz is 8 ms on the landing of a key, and a repeat does not buzz). Both are read before the boot, so the deck does not come and go
behind the loader.

**Safe areas:** the taskbar's face continues under the home indicator (bottom padding is `env(safe-area-inset-bottom)` on top
of its own 4 px), and the sheet adds the left inset to its width so a notch does not eat the keys. Emulated at 430x932 (59 px top,
34 px bottom) and 932x430 (59 px left and right, 21 px bottom); real insets are on the device checklist.

**Diagnostics:** `key` / `deck press` (key id, latched modifiers, queue depth, tap or repeat or confirmed), `deck modifier`,
`deck modifiers cleared` (with the reason), `deck repeat stopped` (reason, repeats, skipped) and `deck guarded key asked`; `page` /
`deck panel`, `deck layout`, `deck sheet`, `deck chat`, `deck text` and `deck setting chosen`.

**Not verified:** any phone or finger (mis-taps, thumb reach, the 380/55 ms feel), haptics, iOS Safari (callout on a long press of a
keycap, double-tap zoom, `:active`), real safe-area insets, the OS keyboard over the chat, a low-end CPU, TalkBack and VoiceOver on
the keycaps, and scrolling "Mais teclas" with a thumb on a short landscape screen (the synthetic drag is graded, a real one is not).
All of them are on the device checklist of the PR.

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
`waitForGameScreen`, which runs only at boot; anything built on "the green went away" must use
Windows' desktop blue `(0, 64, 128)` and the Program Manager icon instead, which is what the exit watcher
does (see *Save safety nets*).
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
`TouchInputService` and `GuestPointer` log into `touch` (the layer attached or detached; each finger landing with its
guest position and whether the cursor was sent ahead; every decision: tap, double-tap, drag start and end, aim start
and end, cancel with its reason, a palm or an extra finger ignored; the first compat mouse event dropped) and `pointer`
(each move with its from, to, sends, units, duration and the smallest and largest gap between sends, which is the
number that says whether a device stretches the spacing; each home with its reason; each click with how long it waited
behind the cursor and how long it held; each abort with what it dropped; a refused send). `DockComponent` logs the control deck's presses, modifiers, repeats and panel changes into `key` and `page` (see *The control deck*). IME is NOT hooked: the
type-bar phase logs into it.

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
the **only** chat entry point wherever the control deck is not a band, because it is the one control that exists at every
breakpoint. Where the deck is a band (a touch device in portrait) the toggle is the taskbar's **Chat** tab instead, with
the same `aria-controls`/`aria-label` from `ChatPanelHelper`, the unread badge and the taskbar flash, and the panel it opens is
still the page's own `#chat-panel`, docked above the taskbar. A desktop without the deck keeps the floating toggle.


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
  for the same facts: synchronous `window.innerWidth/Height` getters (for templates that are
  re-evaluated anyway), and `matchMedia`-backed observables (`isMobile$`, `isLandscape$`, `matches$(query)`) for
  anything that must appear or disappear *on rotation*, which the getters cannot do because nothing
  re-reads them. Observables are cached per query string, so one listener serves all subscribers.
  **`isMobile` answered three questions with one number and is now only for modal content** (a viewport under
  768 px, or a landscape one under 768 tall): a 1366x768 laptop window was "mobile landscape" and lost its header, and an
  iPad was a phone or a desktop depending on Safari's own toolbar. The page's layout asks the two separate
  questions: the **shape** (`shape`, `shape$`, `viewport$`: `portrait`, `landscape-compact` for a viewport at most
  500 px tall, which is where the header is dropped, or `landscape-regular`; pure, in [layout-shape.helper.ts](src/app/core/helpers/layout-shape.helper.ts))
  and the **input** (`isTouchPrimary$` is `(pointer: coarse)`, the pointer the device is used with, and `anyCoarse$` is
  `(any-pointer: coarse)`: a touch laptop is the second and not the first, a convertible changes as its keyboard folds
  away, which is why they are streams). `viewport$` does not follow the OS keyboard: on a touch device a window that shrank to
  80% of its height or less at the same width, while a field has the focus, is the keyboard on a browser that resizes the
  layout viewport for it, and the shape does not move for it (`LayoutShapeHelper.settle`).

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
the chat toggle's rules in `global.scss`), the Cheat 'O Matic modal, the diagnostics window, the
**control deck** (keycaps, taskbar, panels and the launcher's sheet: it is the Windows 3.1 machine's keyboard, so it
is a companion window, decision D3) and every `AlertController` dialog. It does
**not** apply to the page toolbars (`ion-toolbar color="tertiary"`), the landing cards, the
toolbar's "Teclas" button and the landscape gutter's round menu button (they are app chrome, and the first only
opens the Win9x sheet) or the options popover — the navy `#092469` in
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
still agree (36 today) — a manual check, because `npm run lint` covers only `.ts`/`.html`
and there is no stylelint setup to hang it on.

The save status chip (`.save-chip`, see *Save safety nets*) is on the shell side too, for the same
reason, and shares the pill's touch-floor trick (a transparent border, not an `::after`). The room status pill (`.mp-status-pill` in [global.scss](src/global.scss)) is on the shell
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
  messages are Portuguese and say what to do next (the import's too: `prepareSaveFilesPatch` names a file type
  it cannot use, a zip it cannot open, a zip with no save in it and a cloud file it cannot read, and
  `SaveGameService`'s three IndexedDB failures are Portuguese as well); JSZip's and HttpClient's own English goes to the
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

### Leftover scaffolding

`ionic.config.json` / `capacitor.config.ts` still carry the Ionic starter identity
(`Elifoot98Keygen`, `io.ionic.starter`) and there are no native platform folders — Capacitor is
unused; the target is the browser/PWA only.
