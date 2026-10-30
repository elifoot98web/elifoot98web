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
node scripts/pwa-icons/make-maskable.mjs <source.png> <out.png> --size 512 --check   # a maskable launcher icon from the shipped artwork
```

Specs are karma + jasmine. The builder globs `**/*.spec.ts` (its `include` option, which is also
what `--include` overrides); [src/test.ts](src/test.ts) only initialises the TestBed and
`tsconfig.spec.json` type-checks `src/**/*.spec.ts`, so a spec needs no registration but must live
under `src/` to be type-checked. Nothing in a spec reaches the bundle. There are **seventy-eight spec files so
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
[type-mirror.helper.spec.ts](src/app/core/helpers/type-mirror.helper.spec.ts) is the model for "an engine that has to absorb
what real keyboards do differently": scripted value sequences (a suggestion tap with the keyboard's trailing space, a
composition that rewrites a word, an emoji, a paste of 80 characters) read back as a line of words (`BS alt227 o`) through
[type-bar.testing.ts](src/app/core/helpers/type-bar.testing.ts). [type-bar-session.helper.spec.ts](src/app/core/helpers/type-bar-session.helper.spec.ts)
is the model for "events whose order differs per browser": REAL `InputEvent`, `CompositionEvent` and `KeyboardEvent`s dispatched
at a real `<input>`, a fake queue that records what it was handed, and Chrome's and Safari's orders of `compositionend` and the
last `input` both scripted. [ibeam.helper.spec.ts](src/app/core/helpers/ibeam.helper.spec.ts) is the model for "a detector that
must tell a look-alike apart": real 640x480 frames of the guest with its cursor in different shapes
([field-hint.fixtures.ts](src/app/core/helpers/field-hint.fixtures.ts), made by `scripts/frame-fixtures/`), the arrow over a
white list among them, and a case that moves the lookup so that only the serif can reject it (mutation-checked: without the
serif, two cases fail). [stage.helper.spec.ts](src/app/core/helpers/stage.helper.spec.ts) is the model for "a layout that has to hold on every real screen": the table
is the devices (a phone with and without a notch, both iPhones, tablets, laptops) with the insets a notch really has, the stages that matter are
written out as numbers, and the invariants (exactly 4:3, between the rails, never under the minimum) run over the whole matrix times deck, chat and view
mode; [stage-layout.service.spec.ts](src/app/core/services/shared/stage-layout.service.spec.ts) drives the service with a host element whose size the spec moves and a
viewport it moves with it, and the chat's give-back with a fake clock. Mutation-checked when the phase was built: thirteen deliberate breaks, thirteen failing cases (two
survived their first run and were closed: a strict `>` where two columns fit EXACTLY, and a 336 px keyboard that left less than the minimum stage, which the service refuses to
write, so the spec passed for that reason; it uses 120 px now). [storage-keys.spec.ts](src/app/core/services/shared/storage-keys.spec.ts) writes every `STORAGE_KEY` to every place the
registry says it lives, runs the real wipe against the real Ionic Storage and fails if anything is left. One trap in a
service spec: a synthetic `beforeunload` on the real `window` reaches Karma's own handler and fails the whole run
("Some of your tests did a full page reload!"), so `SaveSafetyService.unloadTarget()` is overridable and the spec dispatches
on a stand-in. [emulator-power.helper.spec.ts](src/app/core/helpers/emulator-power.helper.spec.ts) is the model for "a rule that
needs the world's answer before it acts": the state machine is driven by a script of (time, event) calls with no clock of its own,
including the handshake (it asks, the caller answers later, and an answer overtaken by a frame is dropped), and
[emulator-power.service.spec.ts](src/app/core/services/game/emulator-power.service.spec.ts) runs the service over the real `document`
listeners and a recording fake emulator under `fakeAsync`, with the timeline written in absolute time from `start()` because the
interval ticks on those instants. [cheat-omatic.service.spec.ts](src/app/core/services/game/cheat-omatic.service.spec.ts) is the model for
"a service that must hold something open around its awaits": the door is a recording stand-in on `globalThis`, and a read or a write that
fails must still let go. [wake-lock.service.spec.ts](src/app/core/services/shared/wake-lock.service.spec.ts) is the model for "a service whose
whole job is to ask a browser API that may say no": a fake `navigator.wakeLock` whose next answer the spec chooses (a grant, a refusal, or
a request held in flight until the spec settles it), the page's visibility and the clock as overridable members, and `fakeAsync(…, { flush:
false })` so that a listener or timer left behind fails the case; [audio-health.service.spec.ts](src/app/core/services/game/audio-health.service.spec.ts)
adds the trap of a fake that answers synchronously (the real browser dispatches `statechange` as a task), which is why the service queues a
re-entrant look. Both service specs and the helpers behind them (`WakeLockHelper`, `AudioHealthHelper`, `InstallHelper`, `NudgeHelper`,
`FullscreenHelper`, `StorageHealthHelper`) were mutation-checked when the phase was built: thirteen deliberate breaks, thirteen failing cases.
[viewport-transform.helper.spec.ts](src/app/core/helpers/viewport-transform.helper.spec.ts) is the model for "maths that everything else trusts": the camera's scale, clamp,
zoom-about-a-point, pinch step, snap to the device pixel grid and page-to-guest mapping are written as numbers (a 393x295 phone, its tall view, a landscape phone), the mapping is
round-tripped for every column and row of the 640x480 frame at 1x, 1.5x, 2x and 3x and across a sweep of scales and focal points, and [overlay-sync.helper.spec.ts](src/app/core/helpers/overlay-sync.helper.spec.ts)
checks `OverlaySyncHelper` under a transform in REAL layout (no mocks: a container, a letterboxed canvas, an overlay, `getBoundingClientRect`). Twelve deliberate breaks of the camera's
rules (the covering clamp, the focal point, the grid rounding, `scale(1)` at the fit, the dead band, the dead-until-every-finger-is-up rule, the settle near the fit, the
rotation store, the clip as a listener, the folded panel coming back, a write per pinch step, the click reaching the camera) each failed at least one case. Write specs for pure logic (helpers,
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
budget, the audio wake; `typebar.mjs`, the live type bar on the real game against a SIMULATED OS keyboard and CDP's IME
events; and `idle-pause.mjs`, the battery saver on the real game: CPU on a still screen, whole Elifoot rounds with the setting on and off,
and taps and keys sent to a sleeping guest, see *Letting the guest sleep*; and `stage.mjs`, the picture's box at 19 windows with every input the contract names and every one it
does not, the rails' keys, and a spectator's picture against the host's in a real two-browser room, see *The stage*; and `camera.mjs`, the in-app camera on the real game:
the picture's box at 12 windows and 4 zooms, the unzoomed page byte for byte, real two-finger touches, tap accuracy at each zoom against the RAM oracle, the host's overlay and
stream, the deck while zoomed, rotation and the battery saver, see *The camera*), with the tables the constants rest on. **Re-run it after any change to the video mode, the
Windows mouse settings, js-dos or the disk image.** It needs a dev build (`window.ng`) served with `--live-reload=false`.

The phone-platform work (the screen lock, fullscreen, the game's sound, installing) is checked the same way in
[scripts/platform-harness/](scripts/platform-harness/README.md), on the touch harness's driver: every browser API that the headless shell lacks or refuses
is faked there, so it shows what the PAGE does with an answer, never what a phone answers. Its README lists the traps (an init script outlives the
process that registered it; the shell suspends the audio context by itself; CDP cannot emulate `display-mode`).

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
[src/scripts/game.d.ts](src/scripts/game.d.ts) and called directly from Angular services, and reads one the other way round
(`holdGuestAwake`, below):

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
- `saveGameFileSystem()` — `dosInstance.layers.save()`, i.e. flush changed FS to IndexedDB, with the guest held awake
  for the length of the flush (`holdGuestAwake`, below).
- `dosInstance` — the raw js-dos instance, needed by `PatchService` for `emulatorsUi.persist` and by `GamePage`
  for `layers` (`root`, `mouseOverlay`, `canvas`), the elements direct touch attaches to.
- `getDosAudioNode()` — js-dos's own `ScriptProcessorNode`, or `null`. js-dos builds its
  `AudioContext` privately inside `run()`, so `game.js` wraps `AudioContext.prototype
  .createScriptProcessor` at load (before `elifootMain` can run) and keeps the one node created
  with no inputs and one output. That wrapper is the only patch to a global in the app; it
  exists for `MultiplayerAudioService` (see the audio invariant below).
- `holdGuestAwake(reason)` — **the other direction**: Angular registers it, `game.js` calls it. `EmulatorPowerService` sets
  `globalThis.holdGuestAwake` while it runs and clears it when it stops (only if the function is still its own);
  `saveGameFileSystem()` calls it around `layers.save()` and releases in `finally`, and TypeScript code outside the service goes
  through `GuestAccessHelper.hold` / `whileAwake`. It exists because the update prompt in the main bundle persists through
  `saveGameFileSystem()` and cannot import a service of the game chunk, and because every persist meets in that one function. See
  *Letting the guest sleep*.

[src/app/core/typings/jsdos.d.ts](src/app/core/typings/jsdos.d.ts) is a hand-maintained typing of the js-dos
command interface (`DosCI`) — screenshot, key/mouse injection, `persist()`, `readMemory`,
`writeMemory`. `GamePage.dosCI` is `any` and gets threaded into every service as a parameter, and into the control deck as an `@Input` (which
sends through the key queue and keeps nothing); no singleton owns it. Five root services touch it for longer than a call: the key queue (see *Typing into the
guest*), which keeps it only for the length of a job, `TouchInputService` (see *Touching the guest*), which
holds it from `attach()` to `detach()`, and `SaveSafetyService`, `GameExitWatcherService` and `EmulatorPowerService` (see *Save safety
nets* and *Letting the guest sleep*), which hold it from `GamePage.loadConfig()` to `stopSafetyNets()` (the last only while its
setting is on). `GamePage.ngOnDestroy` cancels whatever is still queued, detaches and stops them.

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
the one `localStorage` key the diagnostics log keeps its tail in (see *Diagnostics log*) and the one js-dos keeps for the game's volume
(`JSDOS_STORAGE`, below). What is wiped
is not a list in a method: `STORAGE_KEY_HOMES` in [constants.ts](src/app/core/models/constants.ts) says where each
`STORAGE_KEY` lives (`Record<keyof typeof STORAGE_KEY, ...>`, so a key added without deciding that does not
compile), `LocalStorageService.clearAllData` derives its `localStorage` removals from it, and
[storage-keys.spec.ts](src/app/core/services/shared/storage-keys.spec.ts) proves the wipe leaves nothing standing.
Nothing survives the wipe today; a key that ever must needs `clearAllData` to learn to spare it and the spec to name it.
`emulators.ui.volume` is the one entry the registry cannot list, because js-dos names it: `dosInstance.setVolume` writes it, js-dos applies it
at `run()` before the page has read its own copy (`STORAGE_KEY.GAME_VOLUME`), so `clearAllData` removes it too (`JSDOS_STORAGE`) and
storage-keys.spec.ts proves it.

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
submit tasks (`chord`, `altCode`, a whole text planned by `EmulatorKeyCodeHelper`, or tasks planned elsewhere through `send()`) to one FIFO
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
- **A submission wakes a sleeping guest first, and so does every task.** The battery saver (*Letting the guest sleep*) pauses the
  emulator on a still screen; keys sent to a paused guest are not lost, but they pile up in the worker and land in one burst on
  resume, which is what the 14-event rule above exists to prevent. `submit` calls `EmulatorPowerService.wake('keys')` before it
  queues anything and `run` calls it again before each task, so a text that takes seconds never sees the guest fall asleep under it.
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
  exits to Program Manager (the FAQ says so). Anything that sends Enter on its own — a "next field"
  button — must not do it on that screen. The control deck's **Enter** and **Esc** keycaps are one
  tap on exactly that hazard (reproduced on the real game: Enter twice from Acerca left Program Manager and the
  recovery dialog came up 3 s later), which is why Alt+F4 has a confirm and these two have P5's recovery. The live
  type bar's strip has the same two keys, and a hardware Enter in its field is one too (see *The live type bar*).

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
- **The listeners are on `layers.root`, or on the clip around it (`TouchSurface.stage`, `.game-stream-container`) where the page gives one, in the capture phase, and chosen by `pointerType`, never by user agent.** They
  `stopPropagation()` for `touch` and `pen` pointers aimed at js-dos's overlay or canvas, or at the clip itself, so its own handlers (on the
  overlay, bubbling) never see a finger. GamePage always gives the clip, so the camera-off page is on it too: it IS the picture there (landscape: exactly
  the stage; portrait: the 4:3 box), and the only reason to listen on it is the camera's tall view, where part of the clip is not the picture
  (*The camera*). **Nothing may be put inside the clip that a finger has to reach**: a touch aimed at the clip itself is swallowed like one aimed at the canvas. A real mouse is not touched (desktop pointer lock, a hybrid laptop, an iPad
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
- **A second finger cancels the gesture, and the touch stays dead until every finger is up.** What two fingers MEAN is the
  camera's (*The camera*, `CameraGesture`, fed the same samples; with the camera off they mean nothing, as before), but the
  cancel is this layer's and comes first: any press is released, synchronously, before the pinch starts. A palm (contact radius over 48 css px) is ignored
  outright, not tracked. There is no right click: no tested Elifoot screen reacts to one. **There is no double-tap zoom**: a double tap is a
  `WM_LBUTTONDBLCLK` (measured with the camera on: two quick taps are `down,up,down,up` and the scale does not move).
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
  it from a one-shot `click`/`touchstart`/`keydown` listener on `document`. This layer stops the touch at `layers.root` (or at the clip around it) and
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
- **The engine wakes a sleeping guest before every send** (`GuestPointerOptions.beforeSend`, wired from `TouchSurface.beforeSend`; the
  page passes `EmulatorPowerService.wake('touch')`). Its timers keep sending after the finger has gone (the cursor walking to its
  target, the idle re-home), and mouse motion that reaches a paused guest is applied in one go when it resumes: the guest sums sends
  that arrive close together, so a dead-reckoning model fed that way is off by hundreds of pixels. The document-level capture
  listeners of the service wake it for the finger itself before this layer sees the event; this hook is for what happens later.
  `TouchInputService.busy` (a finger down, a button held, motion queued) is one of the things that keep the guest awake.
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
the picture, and the picture's box does not depend on its contents** (in landscape the picture's box is the stage plan's, which counts a rail's WIDTH and
nothing that is in it; see *The stage*). js-dos re-lays-out its canvas whenever that element changes size,
and the cursor overlay and every remote cursor are measured against it. In portrait the picture is already pinned to its 4:3
height (75vw, `flex: 0 0`) and the band under it is free, so the deck is a flex item after it. `DeckLayoutHelper.presentation`
is a pure function of the viewport, the primary pointer and the player's setting, and it returns one of four things:

- `none`: no deck. A desktop with a mouse and a keyboard is not cluttered by default, and a touch laptop (touch is only its
  `any-pointer`) is the same. The floating chat toggle is untouched there.
- `band`: portrait only, and only where the band under the picture is at least `DECK.MIN_BAND_HEIGHT` (225 px: Táticas needs about
  220 for its two rows of formation keys to be 44 px, and `deck-layout.helper.spec.ts` derives that from the constant. A 360x640
  phone has 314, but the same phone in a Chrome tab with its URL and navigation bars is ~512 tall and has ~186, and an iPhone SE
  in a Safari tab has 216: both got 32-42 px formation keys under the first threshold of 150 and now get the launcher). A **taskbar** that
  stays at the bottom (it is pushed there with `margin-top: auto`; without it a folded deck rode up under the picture and the
  tabs jumped 440 px on the tap that folded them) and **one panel at a time** above it: Táticas, Setas, Mais teclas, or the
  page's chat. Texto is a taskbar button that opens the P1 compose dialog (or, with the experimental "Teclado ao vivo" setting on, the live type bar: see *The live type bar*), and Chat appears only while hosting. A second tap on
  the open tab folds the panel; the picture does not grow into the band.
- `rails`: a landscape phone (`landscape-compact`, a viewport at most 500 px tall: no toolbar, the picture takes the whole height). The keys live in
  the two gutters the height-fitted picture leaves, one rail each, sized by `StageHelper` so that they never cost the picture; see *The stage*. A landscape
  phone has the LEFT rail whether or not the deck is shown (`DeckPresentation.rails`): the toolbar is gone and the menu, the room code and the chat button
  live there, projected into the dock by the page. The sheet below opens from the rail's edge for what a rail has no room for ("Mais teclas", and Táticas
  in a one-column rail).
- `launcher`: every other shape without a band: a landscape tablet or laptop (the picture takes the height and the gutters are too thin for keys) and a
  portrait window with no room under the picture. The same panels open as a **sheet** over the page from a "Teclas" button in the toolbar. The sheet is
  `position: absolute` and takes no space, so it never resizes the container; it does cover the left part of the picture while it is open.

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
of its own 4 px), a rail's face paints to the screen's edge with the notch's inset in its width and its padding, and the launcher's sheet adds the left inset to its
width so a notch does not eat the keys (a sheet that opens from a rail needs none). Emulated at 430x932 (59 px top,
34 px bottom) and 932x430 (59 px left and right, 21 px bottom); real insets are on the device checklist.

**Diagnostics:** `key` / `deck press` (key id, latched modifiers, queue depth, tap or repeat or confirmed), `deck modifier`,
`deck modifiers cleared` (with the reason), `deck repeat stopped` (reason, repeats, skipped) and `deck guarded key asked`; `page` /
`deck panel`, `deck layout`, `deck sheet` (also from a rail's key), `deck chat`, `deck text`, `deck setting chosen` and `stage view chosen`; the stage's own plans are category `layout`.

**Not verified:** any phone or finger (mis-taps, thumb reach, the 380/55 ms feel), haptics, iOS Safari (callout on a long press of a
keycap, double-tap zoom, `:active`), real safe-area insets, the OS keyboard over the chat, a low-end CPU, TalkBack and VoiceOver on
the keycaps, and scrolling "Mais teclas" with a thumb on a short landscape screen (the synthetic drag is graded, a real one is not).
All of them are on the device checklist of the PR.

### The stage (the picture's box, the rails and the chat dock)

The page's layout used to be a by-product. In landscape `.game-stream-container` was `flex: 1`, js-dos fitted its canvas into whatever width the
siblings left, and the gutters on either side of a height-fitted picture belonged to the container, so anything that lived in them was an overlay on it. It
is phase P12 (decision D12); the design record is [docs/mobile-ux-study.md](docs/mobile-ux-study.md). Now **the picture's container IS the picture**, its size is
a pure function ([`StageHelper`](src/app/core/helpers/stage.helper.ts)), and what is beside it is a sibling in the flex row.

**THE CONTRACT, which no new control, panel or setting may break.** The stage's size depends on **the box, the shape of the window (viewport and orientation), the
safe areas, whether the deck is shown (key rails), whether the chat is docked open, and the view mode**; and on nothing else: **not on what is inside a panel or a rail, not on
the OS keyboard, not on the chat's own state (its scroll, its roster), not on a transform.** (*Why:* js-dos re-letterboxes its canvas whenever `#game-container`'s box changes, and the
cursor overlay and every remote cursor are placed from that box; a stage that followed the keyboard or a panel would redraw the game and misplace the cursors each time a field was focused.
"Not the OS keyboard" holds for BOTH kinds of browser: Chrome and Safari leave the layout viewport alone when it opens, and a browser that resizes it for the keyboard (older Android WebViews, some OEM
browsers: the case `LayoutShapeHelper.settle` exists for) shrinks the page's element with the window while the settled shape holds, so `StageLayoutService` adds back the height the window lost against
the settled viewport (`covered` in the `layout` log line) and measures the box the page had before the keyboard.) `#game-container` keeps `position: relative` and has no padding and no
border (the cursor overlay is its child and `OverlaySyncHelper` reads `offset*`); zoom is by `transform` only and is the camera's (*The camera*: the picture's box is never touched by it, which is why this clause holds with it on). In landscape the
container is exactly `--stage-w` x `--stage-h` (whole pixels, exactly 4:3: a multiple of 4x3, never 521x390.75) at an integer offset (`--stage-mx`, `--stage-my`), so the
canvas fills it and its offset inside it is zero. Portrait is untouched: the 4:3 box is still pinned in CSS (`flex: 0 0 75vw`, which needs no JavaScript to be right on
the first frame) and the plan only mirrors it for the log. **Proved in a browser** (`stage.mjs layout`, 19 windows, 248 checks, 0 failures; headless Chrome 143 with touch
emulation, CDP safe-area insets): the container is the canvas to the pixel, is the size and place the plan wrote, and its rect is IDENTICAL with the launcher's sheet
open, with the simulated OS keyboard (`visualViewport` shrunk and `--kb-inset` written: this one only proves the stage reads neither), with the layout viewport REALLY halved while a field has the focus
(`Emulation.setDeviceMetricsOverride`, the second kind of browser above: the check fails with the compensation removed, `[162,0,520,390] -> [292,0,260,195]`; it also held on the host and the spectator with the chat
open), with the deck on and off, with a room starting (the pill and the Chat key appearing), and after the chat opens and closes; it differs only for the documented inputs (the chat docked, the view mode).
**The limit of that clause:** in PORTRAIT such a window (360x340 with the keyboard up) is also `(orientation: landscape)` to the stylesheets, which are not keyed on the settled shape, so the page flips to its row layout
while a field has the focus, as it always did in those browsers; the picture stays right (the portrait plan mirrors the CSS) but the chat, whose landscape width is the plan's and a portrait plan has none, is 0 px
wide for as long as the keyboard is up. Not fixed: it needs every `(orientation)` query in `global.scss` and `_deck.scss` moved onto an attribute the service writes.

**The plan and who writes it.** `StageHelper.plan` takes `{ box, shape, insets, keys, chat, view }` and returns the columns of keys in each rail, the width each side takes
(the notch's inset included), the chat's width, the stage and its offset; `fitStage(box, ratio, reserved)` inside it is the shared ratio fit (the spectator's
`fitVideoToContainer` is the same idea on the frame's ratio, and stays ratio-based: do not switch it to intrinsic pixels). [`StageLayoutService`](src/app/core/services/shared/stage-layout.service.ts)
reads the page for it and writes the answer to `<html>`: `--stage-w`, `--stage-h`, `--stage-mx`, `--stage-my` (the picture), `--stage-left`, `--stage-right` (what each
side takes, which is the rails' width), `--chat-panel-width` (the width the chat dock has when open) and `--chat-dock-w` (what it holds now). It measures the page's flex row with
one `ResizeObserver` (the address bar collapsing, a rotation and a fullscreen change all arrive as a resize), takes the shape from `LayoutHelperService.viewport$` (settled: the OS keyboard
does not change it), reads the safe areas from a hidden probe whose padding is `env(safe-area-inset-*)` (observed by its border box, so an inset that changes without the window
changing size is heard where the browser can observe one; Safari before 15.4 relies on the resize and the rotation), and is told the rest by the page (`setKeys`, `setChat`,
`setView`). It writes nothing for a page that measures 0x0 (the spectator's, until it has a room) or a window too small to hold a stage, removes everything on `stop()` and
keeps nothing scheduled. Both pages start it after their first change-detection pass (`queueMicrotask` in `ngAfterViewInit`): the plan changes what the view binds, and a change made
while the view is being checked is NG0100 in dev mode. Every change of the plan is one `layout` line in the diagnostics log.

**Rails (a landscape phone).** `DeckLayoutHelper` gave `rails` to `landscape-compact` (a viewport at most 500 px tall); the left rail exists whether or not the deck is shown (it holds
what the missing toolbar did), the right one only with the deck. A rail is `112 px` of padding, keys and gaps with two columns (48 px keys) and `68 px` with one (56 px keys), plus the
notch's inset on its side; its face paints to the screen's edge and its padding keeps the keys clear (`max(env(), 0px)`). **Columns:** two in each rail where both fit in the gutters
without costing the picture, otherwise one, and always one in Ampliar. Measured: two at 844x390 (with or without a notch), 915x412, 932x430 and 812x375; one at 852x393 (the
Dynamic Island's 59 px a side leaves 510 px for a 524 px picture), 667x375 and 640x360. **Known limit: "never cost the picture" holds for the phones of the matrix, whose aspect ratio is 1.67 or wider.** Nothing
falls back to the "Teclas" launcher below one column, and every window at most 500 px tall and wider than it is tall is a landscape phone: in a short, nearly square window (half of a 915x412 split screen, 457x412) the
one-column rails take 136 px of 457 and the picture is 320x240 where a width-fit one would be 456x342 (a spectator or a deck-off host there gets 388x291, so the guest's picture is the larger one). `stage.helper.spec.ts` pins it. **Contents:** left, from the top, what the page projects (the round menu button, "Ativar som", the room
code), and pinned to the bottom, where the thumbs rest, the deck's own Texto, Chat and, with two columns, the arrows, Enter, Esc, Tab and the "Teclas" key that opens the sheet; right, Táticas
(F1-F12, A, M: seven rows of two) or, with one column, Enter, Esc, Tab and the four arrows (Táticas is then in the sheet). **A key never moves when the room, the sound chip or the chat
comes and goes** (the page's block grows down, the deck's block is pinned up): at most seven rows, which `--deck-key-dense-h` (44 px with a finger) makes 344 px, so the shortest phone
there is (667x375) has room to spare. The keys are the same `DeckKeyDirective` keycaps, the same table (`DeckKeyHelper`, plus a `shortCaption` for the one label too long for 48 px,
"Auto") and the same `GuestKeyQueue` path; non-repeating keys press on release (a rail on a short window scrolls, like the sheet) and the arrows on landing with `.deck-key--landing`.
Measured at 10 windows (`stage.mjs rails`, 55 checks, 75 with the pill's): every control at least 44x44, no two overlapping, none over the picture, all inside the window or reachable by scrolling; a real
tap on each safe key is one key down and one up; a held arrow's first repeat is 381 ms after the landing and the next ones 55-60 ms apart, nothing after the lift, and in a 300 px tall
window (the rail scrolls) it survives 40 px of vertical drift with no `pointercancel`. The sheet opens beside the rail, not over it, and moves nothing.

**The chat in landscape (D12): it REPLACES the right rail, and the left rail folds to icons.** On a phone the chat takes what the gutters leave, 200 to 240 px plus the notch's inset
(its face paints under the notch); the left rail folds to 56 px of icons (the room's code is not on it, because the chat's own title bar says it); the picture is the one thing that
may shrink. A tablet or laptop (no rails) keeps the widths the chat always had (320 px, or 40% of the window up to 300 px under 900 px). The plan holds the chat's width for the 220 ms
of its slide-out before it gives it back (`CHAT_CLOSE_DELAY_MS`), so the stage never grows into a panel that is still on screen; opening is immediate. **What the chat costs the picture,
measured** (the wireframe's "about 3%" did not count the notch on the chat's side; only the roomiest notch phone reaches it): 0% at 844x390 without a notch, 915x412 and 1366x768; **2.8%** at 932x430 with the
Dynamic Island (the iPhone 15 Pro Max); **5.4%** at 844x390 with a 47 px notch; 6.4% at 812x375; 9.2% at 852x393; 18.4% at 667x375 (408x306 where the old 267 px chat left a 400x300 picture) and 20% at 640x360;
on a tablet 15.4% at 1180x820 and 25.7% at 1024x768, the same as before (the container shrank by the same width). The Chat button of a landscape phone is a key in the left rail, not a tab over the picture.

**Ampliar ("Tamanho da imagem", `STORAGE_KEY.STAGE_VIEW`, only offered on a landscape phone) gains NOTHING on any phone measured, and that is the finding.** It makes the rails one column. But a 4:3 picture
that must be seen whole is already as tall as the screen on every landscape phone (the toolbar is gone and the rails live in the gutters), so a narrower rail has nowhere to give the
picture room. The 8% to 52% the roadmap modelled needs a stage TALLER than the screen, cropped and panned: that is the camera's phase, not a layout's, and shipping it here would have hidden
part of the game behind a pan that does not exist yet. The setting, the plan's support for it and the harness stay, so the camera can build on them. The review found the entry's label promising what it does not
deliver, so the dialog now says what the choice is and is not ("A imagem fica do mesmo tamanho nas duas: muda só quantas colunas de teclas as laterais usam"; the radios read "Ajustar: duas colunas de teclas onde
cabem" and "Ampliar: uma coluna de teclas"). It still costs a player the one-tap F-keys for nothing, so decide with the owner whether it is worth keeping in the menu. **The camera shipped (P11) without
cropping it**: "Zoom e movimento" magnifies and pans the picture inside the stage, whatever the rails are, and `Ampliar` still gains nothing; the entry is the owner's call as before.

**The spectator.** [join-game.page](src/app/pages/join-game/join-game.page.html) drops its toolbar on a landscape phone that is watching (not on the joining, waiting and failure cards, which
keep the way back) and has a left rail instead: the room's pill, "Sala" (the room window), Chat, Som, and "Sair" pinned to the bottom, away from the rest, with the same Win9x keycaps and safe-area
padding as the host's. Its container is the same stage the host's is, so **at the same window the two pictures are the same size and in the same place** (`stage.mjs guest`, 9 windows, 45 checks:
within 1 px, `#stream-target`'s border box equal to the stage, the cursor overlay exactly on the picture; before, a landscape phone's guest saw a picture 14-18% smaller). A remote cursor lands where the
guest pointed, to 0.5 px, at 7 windows (`stage.mjs room`), and the chat works both ways with each picture's box as the plan says; a confirmed leave still reloads the page (`stage.mjs leave`). Rejoining
is unchanged: a spectator only ever joins from a fresh page load.

**Layout rules that cost an afternoon.** `.game-stream-container` must not carry the page's `.full` class: it is `width: 100%` in each page's stylesheet and outweighs the stage's size (the container
painted the whole row, with the right rail pushed off screen). A flex item is positioned by `--stage-mx`, an integer margin counted from the end of the left rail, with the right margin `auto`, so that a
rail or the chat on the right stays at the screen's edge. The toggles (the chat tab, the spectator's sound button) are children of the row, never of the container, because the container is the picture;
a rail's inset padding on the chat panel is `min(var(--chat-dock-w), inset)`, because a padding is a floor under a border-box width and a plain inset made the CLOSED chat a 47 px grey strip down a notch
phone's edge (found on the spectator's page). A `background` shorthand on the pill in the rail reset its `background-clip: padding-box` and made a 24 px capsule 44 px tall. The opposite trap in a ONE-column rail (56 px wide, and the spectator's rail is always one):
the toolbar pill's transparent 10 px borders and padding-box clip paint a 24 px capsule, and `ELI-` over `RVWA` plus the dot is 41 px of content, so the dot floated above the capsule and the second line hung below it as white
text on the rail's grey (1.8:1). In the rail the one-column pill turns the borders and the clip off, so the capsule is the whole 44 px row, with the dot and the lock in its corners; `stage.mjs rails` checks that every child of
the pill lies inside the capsule that is painted, with and without the lock, at five windows (a check that was missing: all the 224+55+45+63 earlier ones passed with the bug).

**Verified in headless Chrome 143 against the dev server and the real game, two browsers for the room** (the public nostr relays were reachable; a fresh room code per run, see `room.mjs`; both browsers need
`--disable-features=WebRtcHideLocalIpsWithMdns`, which `driver.mjs` takes from `CHROME_FLAGS`). Also: a rotation round trip with the chat open returned the exact same rect, and twenty address-bar flaps (390 to 342 px of height)
settled on the exact stage with no console line. **Not verified, and on the device checklist:** any real notch or home indicator (the insets are `Emulation.setSafeAreaInsetsOverride`'s), `env()` and the probe's
`ResizeObserver` border-box observation in Safari, thumb reach and mis-taps beside the picture's edge, the browser tab's real address bar and an installed app's, Android's navigation bar, rotating with the chat open on a
phone, TalkBack and VoiceOver on the rails (they come AFTER the picture in the DOM and BEFORE it on screen, so the Tab order is not the visual one), and the picture's size next to the host's on a real pair of devices. **Known and left:**
the chat's tab on a tablet or laptop with no gutter still overlays the picture's edge by 34 px, as it always did; a dev-mode NG0100 when a host with unread messages opens the chat (the panel's own input setter resets the count in the middle of a change-detection pass, after a
parent-level binding read it; it was there before this phase and does not exist in a production build).

### The camera (zoom and pan of the host's picture, experimental)

A transform on the picture's root that magnifies and moves it inside the stage, so that the game's 8 to 12 px text and 6 to 11 px targets can be read and hit on a phone: about 1.67x brings
a 640x480 frame to the 12 px equivalent that P4's 1.25x left short (phase P11; the design record, the as-built numbers and the conflict it settled are in
[docs/mobile-ux-study.md](docs/mobile-ux-study.md)). **It is behind a setting and off as shipped**: `STORAGE_KEY.CAMERA_ENABLED`, "Zoom e movimento" in the options menu (offered where
`(pointer: coarse)` holds, like "Modo de toque"), stored as an explicit boolean so that flipping `CAMERA.DEFAULT_ENABLED` reaches only people who never chose; the menu's text and the FAQ say it has not been tried on a phone.
*Why off:* **every measurement below is Chromium's**, and WebKit's behaviour with a transform on a WebGL canvas, with two-finger gestures and with edge swipes is unseen (decision D9: the
device pass first). Files: `ViewportTransform` ([viewport-transform.helper.ts](src/app/core/helpers/viewport-transform.helper.ts): the maths, pure), `CameraGesture`
([camera-gesture.helper.ts](src/app/core/helpers/camera-gesture.helper.ts): two fingers to steps, pure), `CameraService` (the element, the observers, what is remembered), `CameraPanelComponent`
([camera-panel/](src/app/core/components/camera-panel/camera-panel.component.ts): the deck's Zoom tab), `CAMERA` in [constants.ts](src/app/core/models/constants.ts), and the rules in
[global.scss](src/global.scss) (`.camera-on`, `.camera-tall`, the tap ring's size) and [_deck.scss](src/theme/_deck.scss) (the panel).

**THE CONTRACT, which no later change to the camera may break.**

- **The transform is on `#game-container` (js-dos's `layers.root`) and nowhere else: `translate(x, y) scale(s)`, `transform-origin: 0 0`.** Never the canvas alone (js-dos sizes the canvas inside the
  root), never a rotation (the page-to-guest mapping and `OverlaySyncHelper` would both break), and `CameraService.write` is the only writer. **At the fit there is NO transform**: the property is
  removed (not `scale(1)`, which would still make a compositing layer) and the root gets back the `style` attribute it had. Measured (`camera.mjs identical`): with the camera off and with it on
  at the fit, the root's attributes, its computed transform and every rectangle (picture, canvas, clip, taskbar, js-dos's overlay) are equal to the last digit, and 2x and back leaves them so.
- **The picture's own box is never resized by the camera.** The root's size is still what the stage plan (or the portrait CSS) says, so js-dos, whose resize detector watches that box, does not
  re-letterbox, and the stage plan does not move. Measured (`camera.mjs layout`: 12 windows from a 360x640 phone to a 1280x800 laptop, at 1.5x, 2x and 3x, 318 checks, 0 failures): `offsetWidth`,
  `offsetHeight`, `offsetLeft` and `offsetTop` of the root and the canvas, the canvas's inline `width`, `height`, `left` and `top`, and `stagePlan` are identical to their values at the fit, in the portrait
  windows where the clip grows into the band as well, and the rectangle is the box times the scale at the place the camera says (the translation on the device pixel grid).
- **The clip is `.game-stream-container`**, whose `overflow: hidden` was already there; its content box is the camera's view. The camera re-clamps from a `ResizeObserver` on the clip and on the root (a
  rotation, the address bar, fullscreen, the stage plan changing, the clip growing or folding), and a transform does not wake that observer or js-dos's (checked in a real browser by
  `overlay-sync.helper.spec.ts`: three camera changes, no callback).
- **A page point reaches the guest through the canvas's own rectangle in the page**: `x = floor((clientX - rect.left) / rect.width * frameWidth)` (likewise y), `rect = canvas.getBoundingClientRect()`, which
  already holds the letterbox, the zoom and the pan. `TouchInputService.toGuest` is `ViewportTransform.clientToGuest`; a point on the right or bottom edge is the last pixel, not one past it.
  Round-tripped for every column and row of 640x480 at 1x, 1.5x, 2x and 3x and over a sweep of scales and focal points (specs), driven through the real layer at those four zooms (spec), and graded
  against the guest's RAM (`camera.mjs accuracy`, 130 taps, four places of the picture at each zoom, the camera following the clicks): **worst error 1 px, median 0**. A 12 px radio that a finger
  5 css px to its left misses at the fit is selected by the same finger at 2x (`camera.mjs radio`).
- **`OverlaySyncHelper` is unchanged and still reads untransformed `offset*`** of the canvas and the overlay, which scale together. The cost is rounding (the integers `offset*` returns), times the
  scale: measured with a hosting phone and fake spectators, the overlay is within 0.25, 0.38, 0.5 and 0.75 px of the canvas at 1x, 1.5x, 2x and 3x and every remote cursor within 0.1 to 0.3 px of
  the fraction its spectator pointed at (the multiplayer study measured 1.25 px at 2.5x, and `overlay-sync.helper.spec.ts` bounds it at half a pixel of the picture's own space per edge, times the scale).
  Remote cursors and click pings are children of the root, so they zoom with the picture; the tap ring is not allowed to (below).
- **Host only.** `canvas.captureStream()` follows the canvas's backing store, which a transform cannot reach: **the stream is the whole 640x480 frame at every zoom**, equal to the guest's framebuffer
  at 600 sample points (mean difference 0 at 1x, 1.5x, 2x and 3x) and, over a real `RTCPeerConnection` pair inside the page, the same picture at 1x and at 3x (mean difference 8.18 and 8.18, the
  codec's, at the 320x240 the encoder starts at). A spectator's cursor stays normalised to the full picture. The spectator's page does not import the camera, and the menu's text, the Zoom panel
  ("Quem assiste à sala sempre vê o jogo inteiro") and the FAQ say so in Portuguese. **A real spectator was never connected**: the sandbox's Chrome could not resolve the public relays.

**Controls.** Every one has a single-pointer twin, because a two-finger gesture alone fails WCAG 2.5.1 and is unreliable on some devices.

- **Two fingers pinch and pan** (`CameraGesture`, fed by `TouchInputService` with the same samples as the recognizer, so the second finger's cancel still comes first and synchronously: the button is
  released and nothing is clicked, measured with a drag in progress, no stuck button). The first two fingers are the pinch; a third and a palm are ignored; when either of the two lifts the pinch ends and the
  touch is dead until every finger is up (a finger put back after a pan neither zooms nor clicks); a `pointercancel`, the page hidden and a detach end it. Each step is the change since the last one, not since
  the start, so the camera owes nothing for the distance it overshot at an edge. A **dead band** of 8 css px on the spread keeps a two-finger pan from shimmering the scale, counted from where it ends so there is no
  jump, and the distance a ratio is measured from is never under 40 px. **No double-tap zoom** (a double tap is a Windows double click: measured, `down,up,down,up` and the scale unchanged). No inertia.
  The layer listens on the clip when the page gives it one (`TouchSurface.stage`), so a finger on the part of the view the picture does not cover is still the layer's: it clicks nothing, and a second finger there still pinches.
- **Presets and buttons** (the deck's **Zoom** tab, `CameraPanelComponent`): Ajustar (the fit), 1,5x, 2x, "+" and "-" (one rung of 1, 1.25, 1.5, 1.75, 2, 2.5, 3), and a pad that moves the VIEW a quarter of itself per press
  and repeats while held (the deck's repeat scheduler: 380 ms, then 90 ms, nothing after the lift). They zoom about the last click when it was under 15 s ago and is on the view, otherwise the middle. The maximum is
  3x (a 16 guest px scrollbar thumb is 29 css px on a 393 px phone). A pinch that ends under 1.06x is the fit. The tab says the scale while the picture is magnified.
- **It follows the click.** After a tap, a double tap or the end of aim mode, if the click is within 22% of an edge of the view the camera moves the least that gives it that margin (menus and lists open below and
  beside what was tapped); never during a drag. Taps at the corners of a magnified picture graded 1 px at worst with it following. **Never under a finger that has landed since:** the click settles after the cursor's paced walk (on a slow
  phone, long after the lift), so the layer tells the camera `clicked(point, { follow: false })` when a finger is down by then, and the camera also refuses while its own pinch is running; the click is still remembered for the buttons' focal point. *Why:* a drag's
  press was mapped through the picture as it stood, and sliding it now would send the held thumb's next move somewhere else.
- **Per orientation, and remembered.** `STORAGE_KEY.CAMERA_VIEWS`: `{ portrait?, landscape? }` of `{ scale, cx, cy }`, the centre of the view as a FRACTION of the picture, so a different window (a rotation, another phone)
  restores the same part of it. Written 600 ms after the last change and at once on detach, never at a step of a pinch; read defensively (storage is an input); a rotation stores the camera it leaves against the window it was made for and
  swaps the other in (measured: portrait 2x, landscape 1.5x, back, and across a reload); a camera at the fit is not stored. Both keys are in `STORAGE_KEY_HOMES` and wiped by "Apagar todos os dados" (the registry spec proves it).
  A camera restored while the game is still hidden (no `.full`, no box) waits for the first layout that has one.

**Portrait: the tall view.** The 4:3 stage of a portrait phone is 295 px of a 700 px column, and a 2x zoom of it would be a window 393x295 onto a quarter of the game. So while the picture is magnified, the deck's band holds
nothing but its taskbar (or the Zoom panel) and the chat is closed, the clip **grows down into the free band** (`.camera-tall`, decided by the page: `GamePage.cameraTall`): 736 px at 393x852, 524 at 360x640, 816 at 430x932,
1064 at 820x1180 (587 with the Zoom panel open at 393x852). **The picture does not change size** (its height is written again as the same `75vw`, since its `.full` height was a percentage of the clip, which is what grew), so
js-dos and the overlay never notice (`camera.mjs layout`, above). *Decided with screenshots*, not measured on a person: the picture grows from the clip's top-left corner (that is the transform's origin) and a picture
shorter than the view sits at the top, so at 393x852 a 2x picture (589 px) leaves 146 px of empty green below it (the same green the band had before) and has no vertical room until about 2.5x. **The 1.5x preset, the first one on the panel, is worse**: a 442 px picture in a 736 px clip leaves
294 px (40% of the screen) of flat green at 393x852, and about 330 px at 430x932; with the Zoom panel open instead of folded there is no void at 2x (589 px in a 587 px clip). Capping the clip at the magnified picture's height would NOT remove it (the green is the page's either side of the clip's edge);
what would is using the leftover for something, which is a decision for the device pass (see the fallback list below), not a measurement. **Known:** pinching away from the top
therefore does not keep the content under the fingers vertically while the picture is shorter than the view (measured: a spread of about 2.2x at y 150 moved the guest pixel under the fingers from y 153 to y 71), because there is nowhere to put the picture's top edge but at the top; horizontally it does.
It does not when the picture is only just taller than the view either (the Zoom panel open, a 587 px view: 2.15x gave 153 to 77), because each step is owed nothing for the distance it could not go and the room opens only at the end of the gesture; `camera.mjs pinch` therefore grades the picture's top edge against what the clip allows, not against the fingers. If the device pass finds
that disorienting, the fix is to let the picture float during the gesture and settle at its end (a follow-up, not built). **The deck collapses to its taskbar while magnified**: `DeckPanelHelper.withZoom` folds the open panel of keys
(and remembers which) when the picture is first magnified and brings it back at the fit if the band is still folded and the player chose nothing else meanwhile; a tab tapped while magnified is a choice and forgets it. The Zoom panel is as tall as its
keys and does NOT take the band (`flex: 0 0 auto`; every other panel does), so the picture can be watched while it is used. Opening a panel of keys or the chat gives the band back and the clip is the stage again
(the camera is re-clamped to the smaller view; nothing else moves). In landscape the clip IS the stage and never grows: the rails and the chat dock are where they were, the chat narrowing the stage (a documented input) re-clamps the camera and closing it gives the box back exactly.
**The stage contract is intact**: the picture's box depends on the same inputs as before; "zoomed" is an input of the camera's VIEW (the clip), not of the stage.

**Interactions.** *The deck, the rails and the sheet* work while magnified (a deck key sends one key down and one up; the rails are siblings, untouched). The Zoom tab is in the taskbar and in the sheet's tabs, so on a
landscape phone the camera's buttons are one tap further, behind the rail's "Teclas" key (the sheet covers part of the picture while it is open, as it does for every panel). *The live type bar and the chat do not move the camera* (`camera.mjs bar`: opened over the deck with a simulated OS keyboard at 3x, the camera,
the clip and the picture are the same rectangles; the bar's fold decision reads the VISIBLE bottom of the picture, `min(picture, clip)`, since the magnified root runs past the screen). *The tap ring* is drawn at the finger in
the root's own space (`TouchFeedbackHelper` divides by the scale) and is kept a fingertip big on the screen by `--camera-unscale`, which the camera writes on the root. *The battery saver*: a pinch (a
`pointerdown` the page's document listeners see, and `busy` while the recognizer is not idle) and every camera button (`CameraOptions.activity` -> `EmulatorPowerService.wake('camera')`) wake a sleeping guest (`camera.mjs power`). *Rotation while
zoomed*: above. *Fullscreen, the address bar*: the observer. *Diagnostics*: category `touch`: `camera attached/detached/setting/restored/rotation/reclamp`, `two fingers`, `camera pinch start/end` (steps, clamps, the scale
it began and ended at), `camera pinch` (at most every 250 ms) and `camera clamp` (the same throttle), `camera preset`, `camera nudge`, `camera follow`, `camera pad held`.

**Not verified, and on the device checklist of the PR.** Everything on a phone: iPhone Safari AND the installed app (a pinch on the canvas against page zoom, `gesturestart`, the edge-swipe back, `touch-action: none` on the clip,
pull-to-refresh), **a transform on the WebGL canvas in WebKit** (tearing, blur, a blank canvas, memory), the overlay with a real spectator watching on a real pair of devices, the pan's feel and the dead band with real fingers
(a thumb rolls, fingers are uneven), the nudge pad, the Galaxy A07's frame rate while magnified, legibility at 1.5x and 2x on both phones, rotation while magnified, the tall view's empty green and the vertical slide described above, a hardware keyboard on an iPad.
**The fallback, and its trigger:** if WebKit mis-draws or mis-hits under the transform (blank or torn canvas, taps landing off by the zoom, `getBoundingClientRect` lying), do NOT patch around it: switch to the investigation's
LAY-3 design, a *preview* transform while the fingers are down that is committed on the lift by resizing the container to `z*W x z*H` and moving it with a pure translate (js-dos re-letterboxes once per commit; the stage plan,
the overlay and the type bar's bottom would then have to learn that the container is bigger than the picture). It was not built: two mechanisms is one too many for something nobody has seen on a phone, and this one's evidence is Chromium's.
**Known and left:** a browser that resizes the LAYOUT viewport for the OS keyboard (older Android WebViews) shrinks the tall clip with it and re-clamps the camera when it grows back (the P12 clause "not the OS keyboard" has the same limit in
portrait); with the deck forced off ("Nunca mostrar", the one configuration where `layout.kind` is `none` on a touch device) there is no Zoom tab, so the buttons are unreachable and a pinch in is the way back to the fit: **the single-pointer twin of the gesture is missing there** (WCAG 2.5.1).
The menu entry and the toast say so (`GamePage.cameraButtonsHint`) instead of naming a tab that is not there. The fix belongs to the options menu rework (P13: a Zoom section of Ajustar, "-" and "+" in the sheet, which is reachable with the deck off), and the camera should not become the default before it exists; the hardware mouse and the trackpad have no zoom; `Ampliar` is unchanged.
**Lifting `user-scalable=no` is a separate, later commit that needs an iOS test (D11).** The viewport meta was not touched by this phase.

### The live type bar (experimental)

A real, visible, one-line field above the OS keyboard whose text appears in the guest as it is typed: the player
sees what they write instead of typing blind into a dialog (phase P8). **It is behind a setting and off by default**:
`STORAGE_KEY.LIVE_KEYBOARD`, the options menu's "Teclado ao vivo (experimental)", whose description says that it has not been
tried on real phones; wiped by "Apagar todos os dados" like every key. Off, the deck's Texto button opens the P1 compose dialog
exactly as before and nothing of this is mounted or running. On, Texto opens the bar, and the dialog is still the way to
paste a list ("Lista" on the bar, "Input de Texto" in the menu): a list of names is several lines and the bar is one. Decision
D7: the dialog is the default, the bar is built behind a flag, and the owner decides after the device pass. **The mirroring
has been run only against synthetic IME events in desktop Chrome** (what exactly is under *Not verified* below).

Files: `TypeBarComponent` ([type-bar/](src/app/core/components/type-bar/type-bar.component.ts); the window), the pure
[`TypeMirror`](src/app/core/helpers/type-mirror.helper.ts) (what the guest holds, and the diff), [`TypeKeyHelper`](src/app/core/helpers/type-key.helper.ts)
(which keydowns are the game's), [`TypeBarSession`](src/app/core/helpers/type-bar-session.helper.ts) (the field's events wired to the
mirror and the queue), [`TypeBarLayoutHelper`](src/app/core/helpers/type-bar-layout.helper.ts), and for the hint
[`CaretWatchHelper`/`CaretWatcher`](src/app/core/helpers/caret-watch.helper.ts), [`IBeamHelper`](src/app/core/helpers/ibeam.helper.ts),
[`FieldHintHelper`](src/app/core/helpers/field-hint.helper.ts) and `FieldHintService`; `TYPE_BAR` and `FIELD_HINT` in
[constants.ts](src/app/core/models/constants.ts); the layout and its seams in [_type-bar.scss](src/theme/_type-bar.scss).
Everything that types goes through `GuestKeyQueueService.send()` (one atomic submission of already planned tasks: the
Backspaces and the planned text of one step); the queue stays the only key sender.

**The contract with the page, which is the deck's: the bar is a SIBLING of `#game-container` and the picture's box does not
depend on it.** It is `position: fixed` to the bottom of the screen, lifted by `--kb-inset` (`KeyboardInsetService`, started
and stopped with the bar; it gained `inset$` for the one consumer that decides from the number), and takes no room in the page:
it COVERS the band under the picture and, with a tall keyboard, the picture's lower edge. Measured at twelve viewports with a
simulated keyboard (phones, tablets, both orientations), `#game-container` and the canvas had the same rect with the bar open,
folded, and closed, and the bar's bottom was the keyboard's top. It is **never opened by itself**: `open()` renders the view and
focuses the field in the same synchronous call as the tap (iOS counts only a focus made in the gesture), and Texto presses on the
LIFT in this mode (`deckKeyOn="up"`, a lift being likelier than a landing to be a gesture iOS counts; unverified). It cannot be
opened with the setting off, and it is mounted only where the deck is.

- **Layout: the full window, or one row.** Title (the badge), the field with "123" and "x", and a strip of keys: two rows of five
  on a phone (Tab, Shift+Tab, Enter, Esc, Apagar / the four arrows and "Lista"), one row of ten from 520 px. It needs
  `FULL_HEIGHT_*` of room between the picture's bottom and the keyboard's top (190 px measured at 393 px wide, 196 asked for);
  with less it **folds into one row** (the field and the keys that fit: Tab, Enter and the way out always, Esc from 400 px,
  "123" and Backspace from 560, the OS keyboard having a Backspace and a number page of its own; the field must stay 120 px wide, so a
  360 px phone with its keyboard up has **no Esc** on the bar, and the FAQ says the keys that fit are the ones shown). **In landscape it is always the
  one row, which is the documented choice**: the OS keyboard covers 55-60% of the screen, so the picture's lower half is gone
  whatever is done and a taller bar would only cover more of what is left; the compose dialog (the other option) would cover
  the same pixels and put its buttons under the keyboard (BASE-8). Rotating the keyboard open therefore costs the middle of the
  picture to a 56 px strip; panning the picture above the keyboard was considered and left out (a transform on `#game-container`
  against the overlay sync is another phase's risk). **One DOM, a class for the fold**: the field is never re-created while the
  keyboard is up or it would lose the focus and close the keyboard.
- **A tap on the game keeps the keyboard, and empties the bar.** The touch layer moves the focus to `.emulator-root` on every touch (a
  hardware keyboard needs it), which would close the OS keyboard on each tap the player makes on the game's own field;
  `TouchSurface.keepFocus` is asked first, at every finger that lands on the game, and the bar answers "I have it". The tap still clicks.
  It is also the moment the bar learns the guest is about to leave its field, so it **mirrors what it holds and lets go of it**
  (`TypeBarSession.abandon`): typed on, the bar would read "FelipeSilva" over a game field holding "Silva", and Backspaces past what
  was typed in it would delete text the bar never wrote. A key sent from anywhere but the bar (the deck's keycaps, through
  `GuestKeyQueueService.activity$`, which fires inside the submission, so the bar's own sends are told apart by a flag around them)
  does the same, without mirroring first: the guest has already moved and text sent now would land in the new field. Emptying is the
  safe direction: an empty bar means "I hold nothing of this field", so the next text appends and a Backspace is the guest's own. A
  touch that clicks nothing (a scrollbar drag, a palm) costs only the text on the bar. Checked: a tap on Jogador 2 after "Felipe"
  left the bar empty with the focus still in it, and "Silva" typed next went to Jogador 2 alone; so did a deck Tab.
- **Mutually exclusive with the chat** (the page closes whichever is not being opened), and closing blurs the field, mirrors what
  it holds, and hands the focus back to `ChatPanelHelper.focusEmulator()`. **Closing in the middle of a paste cancels the rest of it**
  and says so (a toast): the paste's Cancelar is on the bar, so a bar that closed and let the queue go on typing would leave the
  player no way to stop it. Checked: an 80-character paste closed after 15 keys typed nothing more and the toast came. The strip's keys
  are `appDeckKey` keycaps: they take no focus, so the keyboard stays up under a tap.
- **Look: Win9x (decision D3), one skin.** `.deck-face` and `.deck-key` (the deck's, `_win9x.scss`), `.win9x-input` +
  `.win9x-element-bevel` for the field, and the title bar, lamp and progress chip in `_type-bar.scss`
  (`grep -n 'win9x-' src/theme/_type-bar.scss` lists the flip points). 16 px in the field (iOS zooms the page on less), 44 px or more
  on every key under a coarse pointer (checked at the twelve viewports, no two keys overlap, none leaves the bar).

**Mirroring rules.** Each is there because a real keyboard would otherwise misbehave, and all were written from what such
keyboards are known to do, not from having held one.

- **Text comes from the field's VALUE, never from a key.** Every `input` and `compositionend` runs `TypeMirror.sync(value)`: the
  value (NFC, in code points via `Array.from`) is compared with what the guest holds, and the step is "N Backspaces from the first
  difference, then the rest", one `send()`. A plain letter, an autocorrect, a swipe, a dictation, a suggestion tap and a paste are
  the same operation, and an event that comes twice finds nothing left to send, so the order of `compositionend` against the last
  `input` (Chrome and Safari differ) does not matter. It assumes the guest's caret is at the END, so the bar **clears itself, and
  the mirror with it, whenever the guest leaves the field**: after any key that moves it (Enter, Tab, the arrows, F-keys...), a tap on the game
  and a key from the deck (above): from there the text no longer describes the field the guest is on. It also assumes **the guest's field takes
  everything the bar holds**: `maxlength` is 300 and Elifoot's fields are shorter (the 8-letter filename field), so text the guest drops
  makes the bar longer than the field, and the Backspaces that follow delete too much in the guest. Nothing knows a field's limit; this is
  on the device checklist and a per-field limit is a follow-up. A paste is one step, with the queue's progress ("Enviando n/N", from
  24 keys) and a Cancelar that calls `cancelKeys()`; a send that is cut or fails clears the bar too (`desync`), because the guest then
  holds an unknown part.
- **A composition is mirrored when it ends, not while it runs.** An IME holding a word may rewrite it (a suggestion, a dictation's
  interim result, a conversion), and each rewrite is Backspaces and a retype in a guest that spends 20 ms a character, with a stale
  burst landing on whatever the guest has focused by then. Mirroring the middle of it was NOT shown to be safe, so `input` events
  inside a composition only arm a settle timer (`COMPOSITION_SETTLE_MS`, 700): an IME that never ends one must not leave the bar mute,
  and after the quiet the text as it stands is mirrored, with a later rewrite a plain diff on top. A key from the strip, a blur and
  closing mirror the text as it stands too.
- **Leaving a field ends a composition at once.** A keyboard that keeps a word underlined until a space does not end it for a key
  tapped on the strip or a tap on the game, and waiting for it left the old field's word in the bar for good (found in review: the first
  cut deferred the clear until the composition ended, and a spec locked that in). So `abandon` ends the composition itself, inside the
  gesture: the field is blurred (the browser commits a composition when its field loses the focus) and focused again, and whatever
  the browser commits or reports on the way is ignored, because it belongs to the old field. It does this only when a composition is
  active, and **the bar never writes the value of a field the IME is composing in** (how text is resurrected on some keyboards): the
  strip's Backspace ends the composition the same way before it edits the value. A send that is cut or fails (`desync`) clears the bar
  without ending anything, because it asks nothing of the keyboard: that clear waits for the composition to end, and the mirror keeps
  describing the field exactly as it is until then. Checked with CDP `imeSetComposition`: "Leu" being composed, then the strip's Tab,
  sent L e u and Tab, left the bar empty with the focus in it, and "Ze" typed next went to the next field alone; the strip's Backspace
  on a composing "Ab" sent A, b and ONE Backspace and left "A". **Not verified: that the blur and focus keeps the OS keyboard open.**
  If a keyboard closes there, the bar stays docked with its keys and a tap on the field brings it back; it only happens while a word
  is underlined.
- **A pasted control character is a space.** An `<input type=text>` strips only CR and LF from a paste, so a Tab (a spreadsheet cell, a
  tab-separated note), a backspace character or U+2028/2029 reach the value, and the planner would press the key each one names: Tab
  and Enter move the guest to another field behind the mirror's back, which still believes it is one field. `TypeMirror.settled` types
  them as the space they look like (a trailing one is held back like any). Checked: "Zé", a Tab and "Silva" pasted sent Z, the accent,
  Space and S i l v a, no Tab, and the guest field read "FelipeZé Silva".
- **A trailing space is held back until something follows it** (`TypeMirror.settled`), which is the answer to the keyboard's
  auto-space (Gboard after a suggestion tap, iOS after a QuickType word): "Felipão " sends "Felipão", the space goes out when "Silva"
  follows it (as " Silva"), a space taken back sends nothing, and iOS taking a space away before a full stop costs nothing. It does
  not try to know which spaces were the keyboard's; the price is that a space the player does want at the very end of a field is not
  in the game (no field of this game wants one).
- **Every code point is one guest character, except the ellipsis**: the mirror asks the planner how wide each is (the "…" iOS Smart
  Punctuation makes of "..." is three dots there, and deleting it is three Backspaces), accents are Alt codes, quotes and dashes
  fold, and the rest is "?". NFC first, so "a" plus a combining tilde is one "ã".
- **Named keys are authoritative from `keydown`** (`TypeKeyHelper`): Enter, Tab, Shift+Tab, Esc, the arrows, Home, End, Del, PgUp, PgDn
  and F1-F12 go to the guest and their default is cancelled (Tab would leave the field, F5 would reload the page: checked). `keyCode
  229`, `key: "Unidentified"` and `isComposing` are the IME's and fall through to the input events; Ctrl, Alt and Meta chords are the
  browser's. **Backspace is the game's only in an EMPTY field** (iOS fires no `input` for it, only the keydown; in a field with text the
  input event carries it and a keydown too would delete twice). A held Enter, Esc or Tab does not repeat; an arrow does, unless the
  queue is backed up.
- **The CapsLock guard is asked once**, when the bar first types letters and again after `CAPS_GUARD_REARM_MS` without typing any, not per
  keystroke and not on a timer (each read is a round trip to the emulator; nothing on a phone can toggle the guest's CapsLock). The clock
  is the last send of letters, guarded or not: a first version re-armed every 15 s of continuous typing, a read in the middle of a word.
- **"123"** sets `inputmode="numeric"` and blurs and refocuses in the tap so the keyboard notices. The field is `type=text`,
  `autocapitalize/autocorrect/autocomplete=off`, `spellcheck=false`, `enterkeyhint=enter`, `maxlength` 300; they are static template
  attributes (Angular writes those with `setAttribute`), because `autocorrect` is a boolean property in WebKit and Chromium where "off"
  is truthy (see the compose dialog).

**The shortcut hazard, and what is done about it.** Letters are game commands on a screen without a text field (A is Seleccionar >
Automático, M is Melhores), and the bar sends what it is typed, so typing with no field focused FIRES THEM. Measured on the real
game: on the main window, with the badge reading "nenhum campo detectado", a typed "a" selected the automatic squad. So the bar says
what it thinks, in words and a lamp, and the deck's Texto button pulses and keeps a lamp when a field seems focused; **neither ever
gates a key or opens the keyboard** (iOS opens one only from a tap, and both signals arrive after it). `FieldHintService` combines
two hints, both off unless the setting is on:

- *A caret blinking* (`CaretWatcher`, from js-dos's `onFrame`, which fires only when the framebuffer changed): measured at 640x480,
  frames 528-600 ms apart with a field focused and none on a still screen, and consecutive frames differ by exactly one bar 1 px wide
  and 14 tall (the font fixes it, so none of the thresholds depends on the frame size; 17 tall in the sale-price field was seen at
  800x600). Three frames of that cadence suspect a caret, and the pair taken AT the next two frame events (the prototype took them
  290 ms apart, which lands both in one half of the blink half the time) confirms and locates it. **Latency measured: 2.0 s** from a
  cold start with a caret already blinking. It misses a field whose text is selected (no caret blinks; Tab and Enter select), and
  it cannot see which field. js-dos has no way to remove a frame listener, so one is registered per emulator and kept, inert (a null
  check) while the hint is stopped; the service holds no timer and does no work per frame otherwise.
- *An I-beam under the tap* (`IBeamHelper`, one screenshot 150 ms after a click the touch layer sent, `TouchInputService.clicks$`): the
  guest draws its cursor into the frame, and Windows' I-beam is an XOR cursor, 17 rows (a stem 15 tall between two serifs 7 wide) in the
  inverse of what is under it: blue on the focused yellow field, black on a white one. It is found by shape against any background; **the
  serif is what rejects the arrow**, whose black left edge is a 15-row stem with white on both sides over a white list. Valid for 4 s
  after the tap. Costs 0.2 ms. Checked at 640x480 only (the sprite is the cursor's own and should be the same at 800x600, which
  was not run). The splash text also shows an I-beam (TOUCH-10), so it is a hint.

**Diagnostics** (category `ime`, only while the bar is open; `frame` for the hint): every `beforeinput`, `input`, `compositionstart`,
`compositionupdate`, `compositionend`, `keydown`, `keyup`, `focus`, `blur` and `paste` of the field with `inputType`, `data`,
`isComposing`, `key`, `code`, `keyCode`, `repeat` and the value; every step sent (`sync`: why, Backspaces, the text, the tasks, what the
guest holds) and every key, clear, deferred clear, composition ended by the bar, cut-short send and settle; and on open and on every keyboard
change a `bar layout` snapshot (shape, fold, inset, `innerWidth x innerHeight`, `visualViewport` size, offset and scale, the bar's and the
picture's rects). The bar's position in it is the new inset's, because `KeyboardInsetService` writes `--kb-inset` and `--kb-open` BEFORE it
tells `inset$` (the other order logged the previous inset's rect, which is what a device pass would have read to judge where iOS put the
bar), but its height is read before the fold it may have just decided on is rendered: the `bar folds` line says that.
**Typed text appears in this log by design** (the panel's warning says so); it is what the device pass needs. Off, each call is one
boolean check.

**Not verified: any real keyboard.** Everything above was run against Chromium's CDP (`Input.imeSetComposition`, `insertText`,
`dispatchKeyEvent`) on the real game at 393x852 with touch emulation, a keyboard simulated by shrinking `visualViewport.height`, and
unit specs. Recalled and unobserved, and on the device checklist: what Gboard and Samsung Keyboard actually send (`keyCode 229`
everywhere? does a suggestion tap fire `compositionend`? is the auto-space what is assumed?), Backspace in an empty field on Android
(does it fire a keydown at all, and as `Backspace`?), iOS Smart Punctuation, swipe typing and dictation (interim results, the settle timer),
autocorrect not fully off, `focus()` on a lift counting as a gesture on iOS, the keyboard staying open under a keycap and under a canvas
tap, Android Back, rotation with the keyboard open, `visualViewport` offsets when iOS pans to reveal a field (the bar is fixed against
the layout viewport and would be off-screen if it does), whether the blur and focus that ends a composition (a strip key, a Backspace,
a tap on the game) leaves the OS keyboard open, whether the browser then commits and reports what is assumed, and the timing of all of
it on a low-end phone. **Known and left, because the fix is in the P2 pointer engine:** a tap on the game is not ordered behind the keys
still queued, so after a long paste on a slow phone the click can land before the tail of the text has been typed and the tail goes to
the field just tapped (a paste shows its progress, and the window is the cursor's walk to the tap, at least ~200 ms of 10 ms keys).

### Letting the guest sleep (battery saver)

DOSBox pins one core at about 100% even on a menu that never changes (measured: 101.9% of an Apple-silicon core on a still screen, and
lowering `cycles` changes nothing), and a manager game is mostly still menus, so on a phone that is battery and heat.
[`EmulatorPowerService`](src/app/core/services/game/emulator-power.service.ts) calls `dosCI.pause()` when the picture has been still long
enough and `resume()` the moment anything wants the guest. It is phase P9 (decision D6); the design record is
[docs/mobile-ux-study.md](docs/mobile-ux-study.md). The rule itself is [`IdlePowerMachine`](src/app/core/helpers/emulator-power.helper.ts)
(no clock, no timer, no emulator: every call carries the time), the numbers are `EMULATOR_POWER` in [constants.ts](src/app/core/models/constants.ts),
and everything outside the service reaches the guest through [`GuestAccessHelper`](src/app/core/helpers/guest-access.helper.ts).

**Off by default, and one constant from on.** The setting is `STORAGE_KEY.IDLE_PAUSE` ("Economizar bateria quando parado" in the options
menu), stored as an explicit boolean so that changing `EMULATOR_POWER.DEFAULT_ENABLED` reaches only people who never touched the switch;
the menu says it has not been tried on real phones, and the FAQ has an entry. *Why off:* the rule the roadmap proposed, asleep after 2 s
without a frame or an input, was played on real Elifoot rounds and it made the game's own computations **1.8 times slower on average and 2.7 in the worst round**, because
Elifoot spends whole seconds with the picture untouched while it works (on this desktop a 6 to 7.4 s stretch two seconds after the key that
starts a round, and a 9 to 10.3 s one 38 s after the last key, the end of the match) and a guest put to sleep in the middle of that runs the
rest at the probe's duty cycle (about a ninth of its speed). With the idle time at 20 s the saver never slept in play (0 sleeps in 20 ON rounds over four runs; the longest gap 10.3 s with the saver on and
the same with it off), and with the learning below it costs one stretched computation at most, but every number here is a desktop's: the
feature exists for a phone whose silent stretches are unmeasured, and a computation that outlasts the idle time on a slow phone is stretched
for as long as it takes to be seen once. The owner flips `DEFAULT_ENABLED` after the Galaxy A07 pass, or does not; the FAQ entry follows the constant (and `IDLE_MS`) by binding, but the
menu's "Ainda não foi testado em celulares de verdade" is prose about that pass and is revised by hand in the same commit.

**The invariant: anything that talks to the guest calls `wake()` first** (or `hold()` for the length of a job; both are no-ops when the
service is not running, which is the case whenever the setting is off). *Why:* `pause()` is a flag and the guest's clock stops with it.
Input sent to a paused guest is not lost (0 frames while paused and 7 after the resume, measured) but it piles up in the worker and is applied
in one go on resume, and that is not harmless here: the guest sums mouse motion that arrives close together and applies its gain to the sum
(the pointer engine's whole pacing exists because of it), and DOSBox's keyboard buffer drops what a burst overruns (the 14-event rule).
Waking first means the guest is already running when the first event lands, and every sender paces itself against a guest that is. The
paths, each of which must keep doing it:

- *The page's own listeners* on `document`, capture phase, passive (`pointerdown`, `pointerup`, `keydown`, `keyup`, `touchstart`, `wheel`,
  and `pointermove` only with a button down or the pointer locked: a hovering mouse sends the guest nothing). They run before the touch
  layer stops the event on the emulator's root. This is the finger itself and a hardware keyboard.
- *`GuestKeyQueueService`*: `submit` before anything is queued, and `run` before each task, so a text that takes seconds never sees the guest
  fall asleep under it. Every key of the deck, the compose dialog and the type bar goes through there.
- *`GuestPointer`*: `beforeSend`, wired from the page through `TouchSurface.beforeSend`, runs before every motion and every button, the
  home and the walk back included. Its timers keep sending after the finger has gone.
- *Every persist*: `saveGameFileSystem()` in `game.js` calls `globalThis.holdGuestAwake` (which the service registers while it runs, and
  clears only if it is still its own), because the update prompt in the main bundle cannot import a service of the game chunk and every
  persist meets in that one function; `PatchService` (`getLocalChanges`, `existingSaveNames`) and `SaveGameService` (the backup, the disk
  copy) go through `GuestAccessHelper.whileAwake`. A persist works against a paused guest (measured: 5.4 MB in 1.05 s) but was never run
  against anything else in this app, and a probe resuming it halfway is not worth finding out about.
- *The Cheat 'O Matic*: the search sweep and the write are held (`readMemory` and `writeMemory` both work on a paused guest, but a value
  written into one is not seen until it wakes).
- *Flows that rewrite the saved disk, exit the emulator or leave* (a patch, the import, the resolution switch, the restart, leaving) stop the
  service first: `GamePage.stopSafetyNets` stops it before anything else, and `stop()` resumes a sleeping guest.

A path that was missed degrades to "delayed", not "lost": with the probe policy the input waits for the next probe (at most 2.25 s), which
then sees a frame and is read as a stall (the idle time grows, below). That was reproduced by accident with the harness's RAM oracle, whose
direct sends do not wake anything: its calibration failed ("cursor address not found") while the guest slept, and the nudges were applied at
the next probe.

**What is paused and what is not.** Only the emulator, and its sound with it (nothing else is touched: no `cycles`, no stream, no audio node;
a host's audio fan-out keeps running and carries silence). `screenshot()`, `persist()` and `readMemory()` keep working on a paused guest
(measured), so the auto-saver's looks, the exit watcher and the OCR are unchanged and never wake it. **Never paused:** a hosting browser
(v1 is conservative: a stream is the guest's picture, and what a paused guest does to the encoder and to a spectator who joins meanwhile has
not been looked at; a room that starts while the guest sleeps wakes it on the next tick); a page that is not visible (js-dos pauses the
emulator on `visibilitychange` and resumes it when the page comes back, so the service adds neither a pause nor a probe, sends no `resume()` meanwhile, and `visible()` puts its belief right afterwards: the guest is awake, the idle time starts over); a boot (nothing
sleeps until the exit watcher or the page has seen the game's own screen).

**The rule** (checked every `TICK_MS`, 250 ms). Asleep needs, all at once: no frame for `IDLE_MS`; no input for `INPUT_QUIET_MS` (the guard
against the one thing a frame counter cannot see, a computation that starts with a tap); no blocker (hosting, game not seen, a hold, keys
queued or a finger, a held button or motion in the touch layer, each of which also counts as activity and wakes a sleeper); and then it
**asks before it sleeps** whether the game's own "A gravar o jogo…" dialog is up (`SaveSafetyService.gameSavingVerdict()`, the auto-saver's
cached OCR verdict). A static dialog is exactly what a slow save looks like to a frame counter, and a guest asleep in the middle of the write
is the truncated `.e98` that the auto-saver waits for the dialog to close to avoid. **Only a definite `false` sleeps:** `true` and `null` (no
OCR, auto-save off, a failed read, a look slower than `LOOK_TIMEOUT_MS`) keep it awake and are asked again after `LOOK_RETRY_MS` (a `null`
that repeats doubles the wait, up to `LOOK_RETRY_MAX_MS`: it is the page that cannot tell, not the screen, and it would otherwise ask, and log,
once a second for as long as the screen is still), and an answer overtaken by a frame, an input or a blocker while the look was out is dropped. So the feature is inert on a page with auto-save off or
no OCR, which the menu says. Asleep, the default policy (`probe`; `hard` never resumes by itself and is not enabled) resumes the guest for
`PROBE_MS` (250 ms) every `SLEEP_MS` (2 s) and keeps it awake the moment a frame arrives. **A frame from a guest that was asleep is a
stall** (it was working): the idle and input-quiet times grow to twice the quiet stretch that ended, up to `MAX_IDLE_MS` (120 s), and are
kept for the rest of the page's life (not across loads), so the first stall on a slow device costs one stretched computation and not one per
round. A caret blinking in a focused text field is a frame every ~0.55 s and keeps the guest awake for as long as the field has the focus.

**Measured** (headless Chrome 143 and Apple silicon, 640x480, synthetic input, the real game, auto-save on with the real OCR;
`scripts/touch-harness/idle-pause.mjs`, whose header lists the commands):

*CPU on a still screen* (the main window; the busiest renderer process over 20 s; the page's own main thread is 0.6-1.2% in all of them):

| | saver off | duty-cycle probe (default) | hard pause (`POLICY: 'hard'`, not enabled) |
| --- | --- | --- | --- |
| idle time 1.5 s | 101.7, 102.0% | 14.9, 14.6% | 2.9% |
| idle time 20 s (shipped), asleep within 24.5 s | 101.9, 101.8% | 14.8, 14.9% | 3.1% |

The roadmap's lab page read 101.8 / 14.6 / about 1%; the extra two points of the hard pause are this app's own looks (the auto-saver's
screenshot every 300 ms, the exit watcher's every second).

*Elifoot rounds played through the real app* (a person's rhythm: Enter on every new screen, the injury and penalty pickers answered, the auction
skipped; one game, the setting flipped every round; gaps between js-dos `onFrame` events). **Wall time varies about 2x with a round's content (an
injury, a penalty shootout, an auction), so compare the gaps and the CPU and the sleeps, not single rounds:**

| idle time | learning | rounds ON / OFF | wall per round, mean ON / OFF | longest gap ON / OFF | gaps over 5 s ON / OFF | emulator CPU ON / OFF | sleeps |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1.5 s | off | 4 / 4 | 236 s / 133 s | **61 s** / 10.2 s | 13 / 4 | 59% / 102% | 51 |
| 2 s | on | 4 / 4 | 114 s / 122 s | 11.8 s / 10.3 s | 6 / 5 | 101% / 102% | 1 (6 s asleep, round 1) |
| **20 s (shipped)** | on | 8 / 8 | 112 s / 123 s | 10.1 s / 9.9 s | 9 / 11 | 102.2% / 102.2% | 0 |

The first row is the roadmap's rule (its first run, at 2 s with three ON rounds only, read 177-209 s a round, 52 s gaps and 63-69% CPU): rounds
twice as long, gaps of 18 to 61 s that the OFF rounds do not have (their longest is 10 s): computations that started awake and finished at a
ninth of their speed, the longest only ending because the harness's 60 s nudge woke the guest. The second row is the same 2 s with the learning: one stall, in the first round (a 5.9 s stretch became 11.8 s),
and the idle time grew from there; the three rounds after it never slept and their gaps are the OFF rounds'. The third row is what ships, in a
pseudo-random order of 16 rounds so that neither side is always the later one. Three alternations of 4 + 4 before it (one with the setting off
first) read the same on everything but wall time: 0 sleeps, longest gaps 10.1 to 10.3 s on both sides, and ON rounds 17 to 25% longer than OFF
ones, which is what those rounds held (their ON rounds had 6 to 36% more frames, and the balanced run gives the opposite sign). So
the sleeps in the third row are zero because nothing in play is quiet for 20 s, and a saver that does not sleep does not cost anything; that it
*does* sleep a still menu on the shipped number is the CPU table above.

*Input to a sleeping guest* (`idle-pause.mjs wake`: the saver given 1.5 s to put the guest to sleep before every send): 24 taps landed within
1 px, exactly as the 24 awake ones of the control did (0 / 1 / 2 px: 12 / 12 / 0 in both), the engine's own idea of the cursor off by 0 on all of
them, each tap costing exactly one resume; 40 taps with the same seeds gave the same errors to the pixel awake and asleep; 30 first taps after the
model forgot the cursor (home, then walk) left the model 2 px off in 1 case asleep and 2 awake (the guest's own 2 px quantum, see *Touching the
guest*); six arrow keys changed the screen exactly as awake; ten digits through the key queue were ten presses and ten releases, one resume, 1 ms
before the first key event, no more than one event without a gap, 10 ms between groups. The cursor first moved a median 14 ms after a finger landed
on a sleeping guest (max 20) and 14 ms awake (max 22).

*The game's save dialog*: with the idle time cut to 150 ms, on the first kickoff of a new game the service asked as soon as the dialog was up
(`not sleeping: save dialog up`), the auto-saver saw it appear and go (1.0 s) and persisted after it, and the save is on the disk. *A hidden page*
(the property overridden and `visibilitychange` dispatched): js-dos paused the emulator (2% CPU), the service ran no probe, a key sent
meanwhile did not resume it, and when the page was shown the guest was awake (100.8%) with a fresh idle time, and asleep again after it (12.9%).
*Auto-save off*: in 48 s the guest was never put to sleep (100.9% CPU) and the look was asked 7 times, 1.0, 2.3, 4.0, 8.0, 15 and 15 s apart; with
auto-save back on it slept within 4 s. *Sound*: no pause landed within 300 ms of a loud chunk in any run (0 of 51 sleeps in the 1.5 s run); the
game does play sound in stretches with no frames (about a second of crowd noise inside a 1.5 to 5 s gap), which end long before 20 s.

**Not measured, and what the numbers do not say.** Any phone: the A07's CPU, how long Elifoot's silent computations last on it (the 20 s
rests on a desktop's longest, 10.3 s; on a phone five times slower that stretch is 50 s, the saver would put the guest to sleep 20 s into it
and the other 30 s would run at a ninth of their speed, about four and a half minutes once, before the learning raises the idle time),
what the probe costs there, how much of the app's own polling (the auto-saver's screenshot every 300 ms and the exit watcher's every second, which keep
looking at a framebuffer that cannot change while the guest sleeps: about two of the hard pause's three points here, and a cost that grows on a slow core where the
probe's does not; skipping them while asleep is a follow-up), iOS Safari's worker, the real battery. A real hidden tab, a screen lock and
a real background/foreground switch (the harness overrides `document.hidden` and dispatches `visibilitychange`; CDP delivers no lifecycle
event to a headless page). A sound long enough to span the idle time (every pause that landed within 300 ms of a loud chunk is counted: none
did). A host and a spectator (hosting is excluded by rule). Elifoot screens the walk never reached. The idle time is set so the saver stays
out of the way of what was seen, which is not a proof about what was not; that is the reason it is off.

**Diagnostics** (category `power`, the state indicator the roadmap asked for): `service started` (the numbers in force) and `service stopped`
(the books: sleeps, probes, wakes, time asleep, probing and awake, the longest awake gap, stalls), `setting chosen`, `asleep` (why, the longest
awake gap so far), `probe` and `asleep again` (the first probe of a sleep only: a still screen probes every 2.25 s and the log would otherwise fill with it and rewrite its persisted tail
every few seconds; the count is in `awake` and in `service stopped`), `awake` (what woke it: the input's own name, `keys`, `touch`, `persist`..., or the machine's reason,
with the time asleep and the probes it took), `not sleeping` (why: dialog up, unreadable), and `stall: the guest was working while asleep;
idle time raised`. Every line carries the log's timestamps.

### Mobile platform polish (screen lock, fullscreen, sound, install, storage)

What a phone does to the app that the game did not ask for, and what the app does about it. It is phase P14 (decisions D4 and D10); the
design record is [docs/mobile-ux-study.md](docs/mobile-ux-study.md), and the checks are [scripts/platform-harness/](scripts/platform-harness/README.md).
**Everything is feature-detected and degrades to nothing**: the build's floor (Safari 14.1, iOS 14.5) is untouched, an API a browser lacks
means the menu does not offer the entry (or says so), and no code path depends on an answer. Every decision lands in the diagnostics log under
`platform`. The pure rules are helpers ([wake-lock](src/app/core/helpers/wake-lock.helper.ts), [fullscreen](src/app/core/helpers/fullscreen.helper.ts),
[audio-health](src/app/core/helpers/audio-health.helper.ts), [install](src/app/core/helpers/install.helper.ts),
[nudge](src/app/core/helpers/nudge.helper.ts), [storage-health](src/app/core/helpers/storage-health.helper.ts)), all specced; the services own the
listeners; `WAKE_LOCK`, `AUDIO_HEALTH`, `FULLSCREEN`, `PLATFORM_NUDGES` and `JSDOS_STORAGE` in [constants.ts](src/app/core/models/constants.ts) hold the numbers.

- **Keeping the screen on** ([`WakeLockService`](src/app/core/services/shared/wake-lock.service.ts), "Manter a tela ligada",
  `STORAGE_KEY.KEEP_AWAKE`, **on by default** (`WAKE_LOCK.DEFAULT_ENABLED`, stored as an explicit boolean like the battery saver, so flipping
  the constant reaches only people who never chose)). Asked for when the game is up (`loadConfig`), when the page becomes visible
  again (the browser releases the lock when it hides), and when the sentinel's own `release` event arrives on a visible page; let go when the
  switch goes off and when the page is left (`leaveGameToMenu`, after the save, and `ngOnDestroy`). **A room overrides the switch**: a hosting phone
  that locks freezes the picture of everyone watching, and a watching one leaves, so `wanted = running && (inRoom || setting)`, with `inRoom` =
  `MultiplayerService.isInRoom`, refreshed on every `gameStateSubject` emission (the room exists before IN_ROOM is announced and is gone
  before NOT_IN_ROOM). **The spectator page holds the screen too**, with no setting (it has no menu), and refreshes *last* in its state handler:
  the `HOST_LEFT` branch drops the room itself and announces nothing more. **A refusal is a state, not an error**: `NotAllowedError` (battery saver; in the
  headless shell, always) waits for something that could change the answer (the page returning, a new wish, or a tap, at most every
  `GESTURE_RETRY_MIN_MS`, and the tap listener exists only while such a refusal is waiting), any other failure only for the page returning or a new wish, and a
  browser that grants and takes back within `QUICK_RELEASE_MS` three times in a row is not asked in a loop. A grant that lands after the wish
  went away, or after the page was left, is handed straight back. The menu's subtitle is what the browser did, not what was asked.
  The wake lock keeps the screen on and the battery saver keeps the CPU quiet; they do not interact.
- **Fullscreen** ([`FullscreenService`](src/app/core/services/shared/fullscreen.service.ts), "Tela cheia"). **The document element goes fullscreen, never
  `#game-container`**: the browser paints only the fullscreen element and its descendants, and the Ionic alerts, popovers and toasts, the key
  panel and the chat would vanish (js-dos has a fullscreen of its own that does exactly that, which is why it is not exposed). Nothing about the layout
  depends on it: the viewport changes and the resize observers that already watch `#game-container` (js-dos's relayout, `OverlaySyncHelper`) do the rest;
  measured, the canvas followed the viewport and a live room's cursor overlay still covered the canvas to the pixel. The request is made before anything is
  awaited and before the menu closes (it needs the tap's user activation). **The orientation lock is part of the action**: after a fullscreen that
  worked, on a device whose primary pointer is a finger, `screen.orientation.lock('landscape')` inside a try/catch (Chromium allows it in fullscreen and
  an installed app, iOS has no call, a desktop rejects it), and `unlock()` from the `fullscreenchange` that ends fullscreen however it ends. The
  entry's subtitle says it turns the screen. **No manifest `orientation`, no lock taken unasked** (D4). Hidden where `document.fullscreenEnabled` is
  not true (iPhone Safari), where the way to chrome-free play is the install entry. **`(display-mode: fullscreen)` also matches the Fullscreen API**, so
  `InstallHelper.isStandalone` asks only for `standalone`: the first version asked for all three and pressing "Tela cheia" took the install entry away.
- **The game's sound** ([`AudioHealthService`](src/app/core/services/game/audio-health.service.ts)). **The context is js-dos's** (`getDosAudioNode()?.context`); nothing
  here creates one. After a call, a lock or a Bluetooth change it can be `suspended` or (WebKit) `interrupted`; the decision table is `AudioHealthHelper`:
  `resume()` on start, when the page becomes visible and on a gesture (`pointerup`, `touchend`, `click`, `keydown`; the listener exists only while the
  context is asleep on a visible page; a tap is three events and each asks, because which of them carries the activation WebKit counts is not knowable
  from here, but the log writes one line), **never on the context's own `statechange`** (a resume answered by a state change is a loop with the
  browser) and never for a hidden page. `status$` says `blocked` once the context has been asleep on a visible page for `BLOCKED_GRACE_MS`, and the
  **"Ativar som" chip** ([`SoundChipComponent`](src/app/pages/game/components/sound-chip/sound-chip.component.ts), `.sound-chip`) shows then: shell, **flat**,
  in the toolbar's end slot (the speaker alone under 600 px, because the title slot holds the room pill: measured at 360 and 402 px with a live room, the pill is not
  clipped), and a round button in the left rail where a landscape phone has no toolbar. A tap resumes inside the tap. A host's accessible name says that the room
  is silent too. `evaluate` queues re-entrant looks: `resume()` may change the state before it returns, and the `statechange` that follows would be overwritten by the
  reading of the look that asked. **Volume** ("Volume do jogo", "Silenciar o jogo", `STORAGE_KEY.GAME_VOLUME` and `GAME_MUTED`): `dosInstance.setVolume`, a gain on the
  node js-dos puts between its script processor and the speakers; **a mute is a gain of 0 on a context that keeps running**, so muted-by-the-player and
  blocked-by-the-browser cannot be mistaken for each other, and moving the slider above zero unmutes. **It does not change what spectators hear**:
  `MultiplayerAudioService` connects the script processor itself to its `MediaStreamAudioDestinationNode`, BEFORE that gain (`capture()` was observed connecting
  exactly one node, the destination), and the host's "Enviar o som do jogo" switch is the track's own `enabled`. `dosCI.mute()` is not used for the same reason:
  it stops the emulator pushing samples, and the stream would go silent. The level of that stream could not be measured (the headless shell has no audio device, see
  the harness README); the claim rests on the topology. **`navigator.audioSession.type = 'playback'`** ("Som no modo silencioso", `STORAGE_KEY.AUDIO_PLAYBACK`,
  offered only where `navigator.audioSession` exists, **off unless chosen**) makes the game audible with the iPhone's ringer on silent, at the cost of interrupting other
  apps' audio.
- **Installing** ([`InstallService`](src/app/core/services/shared/install.service.ts), main bundle). **It starts with the app** (`AppComponent` injects it), not
  with the game page: Chromium fires `beforeinstallprompt` once, early, and a listener added by a lazy page misses it. The event's default (the browser's own
  mini-bar) is cancelled and the event held; `prompt()` is called from the tap (menu entry "Instalar o app", or the banner's button, before anything is
  awaited), the event is spent either way, and Chromium's next one is picked up. `InstallHelper.mode`: `installed` (the `standalone` display mode,
  `navigator.standalone`, or `appinstalled`; **not** the `android-app://` referrer, which Chrome also sets on an ordinary tab opened from another app and
  which would hide the offer from people arriving by a link) offers nothing; `prompt`; `ios` (an iPhone, iPod or iPad, including the iPad that asks
  for the desktop site: a "Macintosh" with a touch screen) shows **a how-to dialog** (`win9x-alert`) whose point is the warning, not the steps: **an app on the Home Screen
  keeps its own storage, apart from Safari's, so the saves made in the browser are not in it**, and the dialog has a button straight to "Exportar jogos salvos" (and names
  "Importar jogos salvos" for the other side); `none` offers nothing. Only iOS gets the warning: on Android and the desktop an installed app shares the browser profile's storage (recalled,
  unverified: on the device checklist).
- **One-time nudges** ([`NudgeStateService`](src/app/core/services/shared/nudge-state.service.ts), [`NudgeHelper`](src/app/core/helpers/nudge.helper.ts); the install
  banner and the "Gire o aparelho" hint, beside the backup reminder, which keeps its own answer in `SaveStatusService`). **Each is shown once in the life of the install, and
  at most one per page load, in this order: backup, install, rotate** (the order of the calls in `GamePage.maybeNudge`, each of which returns true when it showed
  something; no list of kinds is kept elsewhere to drift from it), after the welcome dialog and the room dialog. **"Never again after it was
  on screen" is the rule, and it holds when storage fails**: the answer is kept in memory before the write is tried, and a store that cannot be READ counts as answered (a
  nudge that cannot remember it was shown would nag on every visit). Showing is answering: unlike the backup reminder (a dialog the player must answer), a toast that runs
  out by itself is spent; the menu entries are the permanent way. The install banner is never due on a first visit (`firstPersistedAt` must exist: an earlier session saved something), in an
  installed app, with nothing to offer, or in a room; it is a **stacked** toast (two buttons beside a sentence squeeze it into a column a few words wide, the lesson of the
  backup reminder), and its button calls the prompt from its own tap. The rotate hint is for a phone held upright (`FullscreenHelper.phoneInPortrait`: a finger is the
  primary pointer, short side under `PHONE_MAX_SHORT_SIDE_PX`, taller than wide); it goes away by itself when the phone is turned, and a tablet, a landscape phone and
  a desktop never get it. Both toasts are `position: 'top'` and cover the toolbar until they go; neither resizes `#game-container`.
- **Storage** ("Armazenamento", first line of "Dados e Backups", read each time the menu opens; [`StorageHealthService`](src/app/core/services/shared/storage-health.service.ts)).
  **It only reads** `navigator.storage.persisted()` and `estimate()`, each raced against a deadline and "unknown" when it fails: the one request to protect the storage is
  `SaveStatusService`'s, made once after the first save that worked, and `saveStatus.durable` stands in when `persisted()` is missing. The line never promises protection:
  "Protegido" is the browser's answer to `persist()`, "Não protegido" adds that the browser may clear the data if space runs short and the backup is the copy that survives.
- **Decided against: `contentHint = 'detail'` on the host's video track.** Measured in a same-page loopback of a 640x480 animated canvas under a 120 kbps cap
  (`scripts/platform-harness/content-hint.mjs`): `detail` kept 640x480 at 5-6 fps, `motion` fell to 320x240 at 12 fps, and no hint to 480x360 at 10 fps. It trades smoothness for
  sharpness under a weak link, which is a product call about every spectator's picture that no two-device session has informed; the app sets none.

**Verified in headless Chrome 143 against the dev server, with the APIs the shell lacks faked** (see the harness README): the wake lock state machine on the real page, the room
override, the release on leaving, the spectator page, the chip's appearance, recovery by tap and by chip and its layout at 360, 402 and 844x390, fullscreen through a real tap
(real `requestFullscreen` and a real orientation lock, which this shell grants), the canvas and the cursor overlay after the resize, the install entry, the stacked
banner and its flows on Android and iOS user agents, the maskable icon under three masks, the manifest as Chrome reads it (no errors, no installability errors), the volume
through the real slider and toggle, the reload and the wipe. **Not verified, and on the device checklist:** any real device. Whether iOS Safari delivers `statechange` with
`interrupted` and takes a `resume()` from `pointerup`/`touchend`; the wake lock in an installed iOS web app (versions 16.4 to 18.x had bugs, recalled); whether the A07 grants a lock under
its battery saver; the orientation lock on Android, and what the Back gesture does to it; `navigator.audioSession` on the silent switch; the install prompt and the app id Chrome
resolves for an already-installed copy (`Page.getAppId` answers nothing in the shell); the maskable icon in a real launcher; `storage.persist()` outcomes; and the level of the spectators' stream
while the host is muted.

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
frame, boot, ocr, save, update, error, `page` (lifecycle and viewport; added to the plan's list, because it is
the evidence an iOS tab eviction leaves), `power` (the emulator going to sleep and waking, see *Letting the
guest sleep*) `platform` (what the browser and the operating system did that the game did not ask for: the screen lock, the audio
context put to sleep, fullscreen, the install prompt, a one-time banner; see *Mobile platform polish*) and `layout` (the stage plan each time it changes: the window
it was made from, the columns of keys, the width of each side, the picture's box and place, and what the chat cost it; see *The stage*). **Off by default.**

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
behind the cursor and how long it held; each abort with what it dropped; a refused send). `CameraService` logs the camera into `touch` too (its attach and detach, a pinch's start, throttled steps, clamps and end, the presets, the pad, the follow, a rotation, a restore; see *The camera*). `EmulatorPowerService` logs every change of state into `power` (see *Letting the guest sleep*). `DockComponent` logs the control deck's presses, modifiers, repeats and panel changes into `key` and `page` (see *The control deck*). The live type bar logs every event of its field into `ime` while it is open,
and the field hint into `frame` (see *The live type bar*); typed text therefore does appear in the log, and the panel says so.

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
  *video* track, so audio can never confer it. The host's own volume and mute (`dosInstance.setVolume`, a gain on the node js-dos puts after
  the script processor) therefore never reach the stream; see *Mobile platform polish*. A spectator attaches with `video.muted` set as a
  property before `srcObject`, and falls back to muted plus an `Ativar som` button when the
  browser refuses to autoplay with sound; their mute persists because every rejoin reloads.
- **`#stream-target`'s border box must equal the visible picture exactly.** `OverlaySyncHelper`
  positions the cursor overlay from the video's `offset*`, and cursor coords normalise against
  `clientWidth`, so any letterbox bar *inside* the element offsets every remote cursor. The fit
  is computed in TypeScript (`fitVideoToContainer`) from the frame's **ratio**, deliberately not
  from its intrinsic pixels: WebRTC ramps its encoder up from a low resolution on every join, and
  intrinsic sizing made the picture visibly grow. The long comment in
  [join-game.page.scss](src/app/pages/join-game/join-game.page.scss) lists what must not be added. The guest's container is the same stage the host's is (the same
  plan, `--stage-w` x `--stage-h`), so at the same window the two pictures are the same size and in the same place (checked to 1 px by `stage.mjs guest`); the
  video's ratio fit happens inside it, as before.
- **The host's camera is the host's alone, and the spectator never learns of it.** The zoom and pan of "Zoom e movimento" are a transform on the host's `#game-container`;
  `captureStream` reads the canvas's backing store, so the stream is the whole frame at every zoom (measured: identical to the framebuffer at 1x, 1.5x, 2x and 3x, and over a WebRTC pair
  inside the page), a spectator's cursor is still normalised to the full picture and drawn on the host in the picture's own space (it zooms with it), and the spectator's page does not
  import the camera. The host's own menu and panel say so in Portuguese. See *The camera*.
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
flat, not Win9x — see the scope rule below). The chat toggle floating over the page (a child of the page's flex row, never of the picture's container) is
the **only** chat entry point wherever the control deck is neither a band nor rails, because it is the one control that exists at every
breakpoint. Where the deck is a band (a touch device in portrait) the toggle is the taskbar's **Chat** tab instead, with
the same `aria-controls`/`aria-label` from `ChatPanelHelper`, the unread badge and the taskbar flash, and the panel it opens is
still the page's own `#chat-panel`, docked above the taskbar; on a landscape phone it is the **Chat** key of the left rail, for the host and for the
spectator alike (all three carry `data-chat-toggle`, which is what `ChatPanelHelper.focusToggle` finds). A desktop without the deck keeps the floating toggle.


- [cheat-omatic.service.ts](src/app/core/services/game/cheat-omatic.service.ts) — a Cheat-Engine-style memory
  scanner over `readMemory`/`writeMemory`, sweeping the 8 MB address space in 1 MB chunks and
  narrowing matches across successive searches (`SearchState` machine, byte/word/dword/string type
  inference, saveable `0x…` addresses).
- [emulator-control.service.ts](src/app/core/services/game/emulator-control.service.ts) — also the entry
  point for sending keys and text (thin wrappers over the key queue, see *Typing into the guest*) and
  for the auto-save OCR.
- [local-storage.service.ts](src/app/core/services/shared/local-storage.service.ts) — thin wrapper over
  `@ionic/storage-angular`; all keys in `STORAGE_KEY`.
- [camera.service.ts](src/app/core/services/game/camera.service.ts) — the in-app camera (zoom and pan of the host's picture by a transform on its root, clipped by the stage,
  remembered per orientation); see *The camera*.
- [stage-layout.service.ts](src/app/core/services/shared/stage-layout.service.ts) — writes the page's layout plan (the picture's box, the rails,
  the docked chat) where the stylesheets and the components read it; see *The stage*.
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
**control deck** (keycaps, taskbar, panels, a landscape phone's rails and the launcher's sheet: it is the Windows 3.1 machine's keyboard, so it
is a companion window, decision D3), the live type bar (the deck's keys and face under a title bar, same decision) and every `AlertController` dialog. It does
**not** apply to the page toolbars (`ion-toolbar color="tertiary"`), the landing cards, the
toolbar's "Teclas" button and the round menu button in a landscape phone's rail (they are app chrome, and the first only
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
still agree (38 today) — a manual check, because `npm run lint` covers only `.ts`/`.html`
and there is no stylelint setup to hang it on.

The save status chip (`.save-chip`, see *Save safety nets*) is on the shell side too, for the same
reason, and shares the pill's touch-floor trick (a transparent border, not an `::after`). So is the "Ativar som" chip
(`.sound-chip`, see *Mobile platform polish*), and so are the one-time install and rotate toasts (`ion-toast.platform-toast`: Ionic's own toast, with
white buttons because the theme's green on its dark grey is 2.5:1). The room status pill (`.mp-status-pill` in [global.scss](src/global.scss)) is on the shell
side of that line and is deliberately flat, not Win9x: it renders inside the page toolbars,
and half a retro toolbar reads as a bug. Its landscape phone instance stands in the rail beside the picture but
keeps the same flat look (a dark capsule on the rail's Win9x grey), because one component changing identity by position is worse than
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

**The manifest's decisions** ([manifest.webmanifest](src/manifest.webmanifest), [index.html](src/index.html)): `id: "/"` is what Chrome derives
from `start_url: "/#/main"` (the fragment is dropped), written down so that it cannot drift, and so the installed copies keep their identity;
`scope` and `start_url` are untouched for the same reason. `theme_color` and `background_color` are the game green `#008000` (they were
`#008200` and `#252329`, a dark splash before the green app painted; the `theme-color` metas were already `#008000`), `lang` is `pt-BR`.
**No `orientation` and no `display_override`** (decision D4: a lock would take portrait play from people who never asked; the "Tela cheia"
entry locks landscape as its own action, never the manifest). Two **maskable** icons were added beside the ~110 existing entries, which are
left alone (the Windows tile sizes are Edge's): `android-maskable-512-512.png` and `-192-192.png`, made from the shipped 512 launcher icon by
[scripts/pwa-icons/make-maskable.mjs](scripts/pwa-icons/make-maskable.mjs) (artwork shrunk to 0.66 on a canvas of its own green, so the lettering
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

### Leftover scaffolding

`ionic.config.json` / `capacitor.config.ts` still carry the Ionic starter identity
(`Elifoot98Keygen`, `io.ionic.starter`) and there are no native platform folders — Capacitor is
unused; the target is the browser/PWA only.
