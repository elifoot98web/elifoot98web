# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Elifoot 98 Online — an Angular 21 + Ionic 9 PWA that runs the 1998 football manager game Elifoot 98
in the browser. Elifoot 98 is a **16-bit Windows 3.1 application**, so the stack is: js-dos (DOSBox
compiled to WebAssembly) → Windows 3.1 (shipped inside the game bundle) → `ELIFOOT.EXE`. All
user-facing strings are Brazilian Portuguese; keep new UI text in pt-BR.

Live at https://www.elifoot98.com.br (GitHub Pages).

## Commands

Day-to-day commands are `npm start`, `npm run build`, `npm run lint`, `npm test` (visible Chrome, watch), `npm run test:ci` (headless, one run) and `npm run mp:launch`; `python3 scripts/resolution/build_bundle.py verify src/assets/elifoot/elifoot98.jsdos` confirms the resolution switch is in the bundle. Specs are karma + jasmine under `src/`; dependency-free CDP harnesses live in `scripts/`.

- **Git LFS is required.** `*.jsdos` is LFS-tracked; without it the bundle is a pointer file and the app will not boot.
- **Specs must live under `src/`.** `tsconfig.spec.json` type-checks only `src/**/*.spec.ts`. A run matching no spec prints `Executed 0 of 0 SUCCESS` yet exits 1, so a mistyped `--include` fails.
- **Run single specs with `--browsers=ChromeHeadlessCI`.** It is `--no-sandbox`, which CI runners and containers need.
- **Spec pure logic only.** The emulator, screen-scrapers and WebRTC have no karma coverage; check them in a real browser with the harnesses.
- **`fakeAsync` flushes leftover timers by default.** Pass `{ flush: false }` and end with `stop()`/`detach()` when "nothing is left scheduled" is asserted, or an uncleared timer hides.
- **zone.js fakes `Date`, not `performance.now`.** Inject a clock or spy; `deck-key.directive.spec.ts` must never reset its spy between specs (static clock).
- **Build a rejected promise inside the fake, never up front.** Otherwise it fails unhandled. Build rigs whose `attach()` starts timers inside `fakeAsync`, detach in `finally`.
- **TestBed is zoneless though `main.ts` boots with zone CD.** Call `markForCheck()` before `detectChanges()` after writing a plain field, or NG0100 throws.
- **Never dispatch a synthetic `beforeunload` on the real `window`.** It reaches Karma's handler and fails the whole run; use `SaveSafetyService.unloadTarget()`.
- **Give emulator-facing services a stub `DosCI`, never the real one.** Use the `diagnostics.testing.ts` doubles; `PatchService` errors reach users verbatim, so its spec pins the Portuguese wording.
- **Check a rule against an independent model, not a copy of the code.** Detectors run on real 640x480 guest frames (`scripts/frame-fixtures/`) including look-alikes; typing engines get real `InputEvent`/`CompositionEvent`/`KeyboardEvent`s; CSS is probed on the real `global.scss`.
- **Specs paint on a copy of a shared frame, never on it.** Browser stores are real: `save-game.service.spec.ts` deletes every `js-dos-cache*` IndexedDB database before and after each case.
- **`storage-keys.spec.ts` guards the wipe.** Every `STORAGE_KEY` needs a `STORAGE_KEY_HOMES` entry (else no compile); a key that must survive is named in both `clearAllData` and the spec.
- **A fake browser API must answer as the real one does.** Real `statechange` is a task, so a synchronous fake hides re-entrancy (`AudioHealthService` queues a look). Fail the read and write of code holding something open.
- **Off-by-default code must cost nothing.** Spy the real `window` before the service exists, assert the data thunk is never called, end with `finish()` so a failing case leaves no listeners.
- **Decisions get a table, machines get time as an argument.** `save-policy.helper.spec.ts` asserts again alone that `null` ("OCR could not read it") is never the all-clear.
- **A guard whose spec has never failed proves nothing.** Break the rule on purpose and watch a case fail.
- **Each harness README lists the traps that void a run; read it before driving one by hand.** Nothing in `scripts/` reaches the bundle.
- **Multiplayer: a covered window is `hidden`.** Timers throttle and Ionic overlays stall, so the join dialog hangs silently; run `front <port>` first. Separate profiles per peer; one `watch` per port.
- **Re-run the touch harness after changing video mode, `WIN.INI`/`SYSTEM.INI`, js-dos or the disk image.** The `TOUCH_INPUT` gain, corner and frame period are guest properties. Never hard-code the RAM address.
- **Touch and platform harnesses need a DEV build with `--live-reload=false`.** They read `window.ng` and private members. Use `localhost:4200`, not `127.0.0.1` (`ng serve` may listen on `::1`); start `driver.mjs` first.
- **Touch runs can measure nothing.** The guest sometimes stays at the DOS prompt (void run); the oracle does not wake a sleeping guest; `gain`/`spacing`/`homecheck` leave the touch layer detached (`__g.applyTouchMode()` restores).
- **The platform harness shows what the PAGE does with a faked answer, not what a phone answers.** Init scripts outlive their process (restart the driver); CDP cannot emulate `display-mode`.
- **Unverified:** all harnesses are desktop Chromium with synthetic input; no real finger, IME, iOS/WebKit or phone CPU tried, device passes pending.

Before changing this area read the verified invariants in [docs/mobile-ux/commands-and-harnesses.md](docs/mobile-ux/commands-and-harnesses.md).

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

js-dos is vendored (`src/assets/js-dos/`), booted and driven through the browser globals in `src/scripts/game.js` (typed in `game.d.ts`) by Angular services; `GamePage` holds `dosCI`.

- **`game.js` is plain JS outside the TypeScript build and not loaded by the karma specs.** A change to it is only ever checked in a real browser.
- **Never hand `elifootMain` anything but the bundle's own URL.** js-dos keys the saved layer by `"<url>.changes"` and `PatchService` hardcodes it; any other URL orphans every save.
- **Tell a slow boot from a broken one by error `name` (`JsdosTimeoutError`).** A timeout ends the wait, not the boot: calling again re-attaches instead of stacking a second DOSBox.
- **Boot progress is scraped from js-dos's English loading text (`.emulator-loading-pre-2`).** If an update drops or rewords it, only the `BOOT_*` fallbacks remain, silently.
- **Keep js-dos's on-screen keyboard in a never-attached `keyboardDiv`.** `simulateKeyPress` wedges the guest when two presses land within 16 ms; the control deck goes through `GuestKeyQueueService`. ESLint rejects `simulateKeyPress`.
- **`dosInstance` is undefined until the game page starts js-dos.** Guard with `typeof` or `?.`. `saveGameFileSystem()` must stay a no-op without an emulator; the update prompt relies on it.
- **Any bulk guest read or write (persist, backup, memory sweep) goes through `GuestAccessHelper.hold`/`whileAwake`, never bare.** `EmulatorPowerService` registers `holdGuestAwake` for `game.js`; every persist must wake a sleeping guest in one place.
- **`getDosAudioNode()` relies on `game.js` wrapping `createScriptProcessor` at load, before `elifootMain`.** js-dos keeps its AudioContext private; that wrapper is the app's only global patch.
- **`dosCI` has no singleton owner.** `TouchInputService`, `SaveSafetyService`, `GameExitWatcherService`, `EmulatorPowerService`, `FieldHintService` and `AutoSaverService` outlive `GamePage`, so its `ngOnDestroy` must cancel the key queue and detach or stop each, or they drive a dead emulator; add any new service that keeps it.

Before changing this area read the verified invariants in [docs/mobile-ux/js-dos-bridge.md](docs/mobile-ux/js-dos-bridge.md).

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

The guest boots at 640x480 instead of 800x600: `dosbox.conf` `[autoexec]` runs `d/SETRES.BAT`, which copies `d/res/s640.ini` or `s800.ini` over `SYSTEM.INI`. The bundle is built by `scripts/resolution/build_bundle.py`; the mode logic lives in `PatchService.setDisplayMode` and `GamePage.currentDisplayMode`.

- **Set the mode from `dosbox.conf` and `d/`, never `hdd.img`.** Every persisted layer carries its own `hdd.img` that shadows the bundle's, so edits there reach only new visitors.
- **The bundle URL must never change.** The layer key is `<url>.changes` (also hardcoded in `PatchService`); a rename strands every saved game.
- **Keep the `SETRES.BAT` driver guard (`SYSTEM_FILES`).** Older images lack drivers; an unconditional copy stops Windows at "Cannot find a device file", counted as a failed boot. Such players keep their old mode; the menu cannot change it, only "Apagar todos os dados" does.
- **Rebuild only with `build_bundle.py`, then run its `verify <bundle> --base <old>`.** It never rewrites `hdd.img` and enforces the guard and the `[autoexec]` position.
- **Never revert the `dosbox.conf` line.** `SETRES.BAT` rewrites `SYSTEM.INI` every boot; 640x480 players would stay stuck, with nothing to switch them back.
- **The mode in force is the framebuffer size (`DisplayModeHelper.fromFrameSize`), never a stored flag.** A flag lies after a restored backup or failed boot; no `STORAGE_KEY` exists.
- **`DISPLAY_MODE.FLAG_PATH` (`use800.flg`) is the only persisted fact and sets the NEXT boot.** Changing it stops the auto-saver, exits the emulator and reloads; never play on. No `getClearLocalChanges` filter may match `d/res/`.
- **Disable "Resolução do jogo" while a room is live or starting.** A host's reload ends the room for everyone. Copy says 640x480 is "larger but softer", never sharper.
- **At 640x480 the Elifoot window hides the green backdrop load detection samples.** See *Screen-scraping* before building on "the green went away".

Before changing this area read the verified invariants in [docs/mobile-ux/guest-resolution.md](docs/mobile-ux/guest-resolution.md).

### Booting the emulator

`GamePage.bootGame()` starts js-dos through `elifootMain` ([game.js](src/scripts/game.js)) and decides what a failure means; the `boot-progress`, `boot-stage` and `boot-failure` helpers are in [src/app/core/helpers/](src/app/core/helpers/). `game.js`'s deadline logic has no spec, so check it in a real browser.

- **A timeout ends one wait, not the boot.** A flat clock once reloaded a slow first download into itself. `elifootMain` re-attaches to the running boot instead of stacking a second DOSBox. The stall clocks (`BOOT_STALL_MS`, `BOOT_STALL_AFTER_DOWNLOAD_MS`, `BOOT_HARD_CAP_MS`) key on js-dos's English loading text; recheck on every js-dos upgrade.
- **Re-attach only inside the element the boot started in.** If `#game-container` changed, start a new boot, or the page gets a `dosCI` over a detached tree. `ngOnDestroy` must dismiss the boot dialog, and "Continuar esperando" must ignore a destroyed page.
- **The bundle URL must never change.** No `blob:` or renamed copy: the changes layer is keyed `bundleURL + '.changes'` (`PatchService` hardcodes it), so another URL orphans every save.
- **"Ready" is not the game.** Only the game's green (`GAME_SCREEN_PROBE`) ends the wait; the blue desktop never declares ready and the `BootStageHelper` label never goes back. Re-measure at 640x480 and 800x600 before retuning. A window closing without green is not an error: no first-run coach, a toast, and the exit watcher arms on `isGameScreen`.
- **Three failures, three outcomes** (`BootFailureHelper.kindOf`). `timeout` leaves `FAIL_COUNT` alone and never reloads by itself; `network` counts but never offers a wipe; `other` offers "Apagar todos os dados…" at `WIPE_OFFER_AFTER_FAILURES`. An exception after the emulator starts is never a boot failure or a reload.
- **Backup and wipe must work without an emulator.** `SaveGameService.readStoredChanges()` reads IndexedDB directly; `clearAllData(null)` must still delete the databases. Without `indexedDB.databases()`, abort the backup if `js-dos-cache (emulators-ui-saves)` is missing: opening creates it with no `files` store and every later save fails.
- **Leave js-dos's red "Can't start emulator…" toast alone.** It is the global notyf container shared with other js-dos messages.
- Not verified on a real phone or iOS: boot timings; the 45 s detection window is a ceiling, not a measurement.

Before changing this area read the verified invariants in [docs/mobile-ux/boot.md](docs/mobile-ux/boot.md).

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

What stops progress vanishing unchosen and tells the player it is safe: `SaveStatusService` (toolbar chip, backup reminder), `SaveSafetyService`, `GameExitWatcherService`, and pure helpers in `src/app/core/helpers/` (`save-policy`, `save-backup`, `save-status`, `navigation-guard`, `game-exit`). `GamePage.startSafetyNets()` / `stopSafetyNets()` attach and detach them.

- **"Saved" means the changes layer reached IndexedDB, so every persist goes through `SaveGameService.saveGame()`.** It flushes one at a time and reports to `SaveStatusService`; a path around it makes the chip lie. Only reload-ending patch/update calls skip it.
- **`dirty` is a counter, cleared only if nothing moved during the flush.** The game's in-memory state is not on disk; a click mid-persist is not "saved". Virtual keys are no DOM event, so they feed `keyActivity$`.
- **`isGameSaving` is three-valued, and `null` (OCR unreadable) is never "not saving".** `SavePolicyHelper.decide` holds the table: `hidden` persists only on `false`, `reload` asks on `null`, `manual`/`leave` persist on `null`. A `null` save is `verified: false`, never plain "Jogo salvo".
- **The leave flushes BEFORE it stops the auto-saver.** `SaveSafetyService.look()` rides the auto-saver's OCR worker; stopped first, the look is `null` and the wait for the game's dialog is dead code.
- **Every persist behind a loader is bounded by `AUTO_SAVER.PERSIST_TIMEOUT_MS` and ends as a failed save.** The loader can't be dismissed and IndexedDB stalls after backgrounding; the deadline stops the wait, not the flush, so `saveGame()` keeps its queue.
- **The hidden save hangs on `visibilitychange`, not `pagehide`, and `SavePolicyHelper.gateHidden` checks cheapest first.** `pagehide` leaves no time for an async write; a failed attempt counts toward `HIDDEN_PERSIST_MIN_GAP_MS`.
- **Flows that rewrite the layer (patch, save import, resolution switch) stop the savers first.** `GamePage.restoreSaving()` turns them back on only if nothing was written; once written, a persist would overwrite the new disk. Known gap: `clearCustomPatch` restores only the nets.
- **The data wipe calls `SaveStatusService.freeze()` before deleting anything.** Otherwise a late persist writes its timestamp into a wiped store.
- **`AppRoutingModule` must keep `canceledNavigationResolution: 'computed'`.** `'replace'` loses a history level: the first Back asks, the next leaves unasked. Only the game page has a `canDeactivate` guard.
- **Reloads from a booted game go through `GamePage.reloadPage()`, or call `SaveStatusService.allowExit()` first.** A bare `window.location.reload()` makes `beforeunload` ask twice.
- **Backup import/export both live in `SaveBackupHelper`, and both file inputs are emptied in `finally`.** `change` fires only when the value changes. `navigator.share()` must run before any await: Safari honours it only inside the tap.
- **The backup reminder is due only when the disk holds an `.e98` (`PatchService.existingSaveNames`).** A visit that only looked around also persists; a reminder answered with nothing to back up is spent for good.
- **Program Manager exit detection stays strict (`GAME_EXIT_SIGNATURE`).** Loosen it and ordinary screens raise the dialog. Windows draws that desktop while loading, so `GameExitWatcherService` arms only after the boot saw the game, asks once per episode, and stops before any layer rewrite or leave (`leaveGameToMenu` first).
- **The save chip is flat app shell, not Win9x,** like the room pill, because it renders in the page toolbar.
- Unverified on real devices: Safari `navigator.share`, `storage.persist()`, `beforeunload`, edge-swipe Back, Android Back in an installed PWA, the real background/foreground hidden save, zip import from Files or Drive.

Before changing this area read the verified invariants in [docs/mobile-ux/save-safety.md](docs/mobile-ux/save-safety.md).

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

[guest-key-queue.service.ts](src/app/core/services/game/guest-key-queue.service.ts) is the only thing that sends keys to the guest: the control deck (`DockComponent.press`), the text dialog and the live type bar submit tasks to one FIFO (text planned by `EmulatorKeyCodeHelper.planText`). `EmulatorControlService.sendKey`/`sendString`/`sendTasks` just wrap it.

- **Never call `dosCI.simulateKeyPress`.** It stamps the release 16 ms ahead, so a second call inside that window kills the guest keyboard until reload and loses unsaved progress; ESLint `no-restricted-syntax` enforces it.
- **Raw events only, paced, never a long burst.** `KEY_PACING_MS` between groups, at most `MAX_SYNC_KEY_EVENTS` without a gap: DOSBox's keyboard buffer silently drops the rest (129 chars delivered 14).
- **A task is atomic.** Once its first key is down it runs to the release, so cancel or failure never leaves Alt/Shift held; `GamePage.ngOnDestroy` cancels leftovers because the queue outlives the page.
- **Wake the guest before every submission and every task.** Keys sent to a paused guest pile up and land in one burst on resume.
- **One code point is one visible character.** `planText` turns the unmappable into a visible `?`, never a space or a drop, so host and guest fields stay 1:1; accents are Alt+0nnn (four digits, guest is US layout); the euro sign and 0x80-0x9F draw a solid box. Count with `Array.from`.
- **CapsLock is guarded, NumLock is not.** Letter text reads the BIOS flags byte first; the read is raced against `KEYBOARD_STATE_TIMEOUT_MS` and a failure sends anyway.
- **A refused key says so.** No emulator rejects with `KeyQueueError` (pt-BR, for `showErrorAlert`); a mid-send throw sets `faulted$` for `KEY_FAULT_COOLDOWN_MS`; a refusal is not a fault.
- **`activity$` fires once per accepted submission, synchronously, before any key goes out.** The type bar tells its own sends from others' by a flag around the call; emitting later makes it abandon its own text.
- **Set text-assist attributes on the DOM (`turnOffTextAssists`), not via the input's `attributes` option.** Stencil assigns the property and `autocorrect='off'` is truthy, writing "on". `enterkeyhint` stays `enter`.
- **Never auto-send Enter on Elifoot's first dialog before a radio is chosen.** It raises "List index out of bounds" and the game exits to Program Manager; Esc/Cancelar quits too.
- Unverified on real phones: `KEY_PACING_MS` on low-end Android, and iOS/Android keyboard behaviour in the dialog.

Before changing this area read the verified invariants in [docs/mobile-ux/typing.md](docs/mobile-ux/typing.md).

### Touching the guest (direct touch)

`TouchInputService` (`attach()`/`detach()`) takes the finger before js-dos and drives the guest's mouse with relative motion, through `GestureRecognizer`, `GuestPointer`/`GuestPointerMath`, `TouchModeHelper` and `touch-feedback` in `src/app/core/helpers/`. Tunables: `TOUCH_INPUT`.

- **Re-measure after any change to video mode, Windows mouse settings, js-dos or the disk image.** `GuestPointerMath` encodes measured guest rules and nothing reads the cursor back, so drift shows only as missed taps.
- **Never send over `MAX_SEND_UNITS`; chunks stay at `MAX_CHUNK_UNITS`.** A positive event of 256 units or more wraps modulo 256, and summed chunks must stay under it.
- **Keep dead reckoning; no `readMemory` for the cursor.** It rejects concurrent calls (Cheat 'O Matic) and the oracle's addresses may move.
- **One motion send per `SEND_SPACING_MS`, from the previous send's real time, also before a button event.** The guest sums sends within a frame and applies gain to the sum; if a slower phone emulator shows summed sends, raise it first.
- **Listeners stay on `layers.root` or the clip (`.game-stream-container`), capture phase, chosen by `pointerType`, never user agent.** Nothing a finger must reach goes inside the clip; a real mouse and js-dos controls stay untouched.
- **Drop mouse events within `COMPAT_MOUSE_WINDOW_MS` of a touch; a real mouse calls `invalidate()`.** A stray `mousedown` triggers pointer lock on a default-UA iPad; a hybrid's mouse moves the cursor behind the model.
- **Every finger focuses `layers.root` unless `TouchSurface.keepFocus` says a text field keeps it.** Cancelled touches cancel focus, so hardware keyboards would stop reaching the game; taking it closes the OS keyboard.
- **Every gesture end releases the button synchronously via `GuestPointer.abort()`, including visibility/freeze/blur/pagehide and `detach()`.** Hidden-page timers are throttled and a stuck button drags things. A press with lost position is released, never homed.
- **Click at release, at the touch-down point (`preAim`); a double tap sends `preAim: false`; `forgetTap()` retracts a tap that clicked nothing.** Re-aiming can leave the double-click rectangle; a retry would click the stale cursor.
- **A second finger cancels, and the touch stays dead until every finger is up; palms are ignored.** The cancel comes before the camera's pinch (`CameraGesture`).
- **`GuestPointerMath.isSendable` refuses anything but in-range whole numbers.** A NaN poisons the guest's mouse until reload.
- **Re-home rarely, in place, never with a finger down (`setFingerDown()`) or the button held.** The cursor is in spectators' stream, so a re-home flings it to the corner. Attach homes only where `any-pointer: coarse`.
- **A lifted finger resumes the `getDosAudioNode()` context.** The layer stops js-dos's one-shot gesture listener, so iOS (and a host's stream) stays silent.
- **The tap ring is host DOM (`.touch-feedback`), never pixels in the guest frame.** Spectators and `dosCI.screenshot()` scrapers must not see it.
- **Wake the guest before every send (`beforeSend` to `EmulatorPowerService.wake('touch')`).** Motion reaching a paused guest applies in one go, off by hundreds of px.
- **Scrolling stays the scrollbar; no drag-to-Up/Down mapping.** In the country list the arrow and page keys SELECT as they move.
- **The layer runs outside Angular's zone and sends no keys.** Pointer events arrive at display rate; all keys go through the key queue.
- **Known risk: two quick taps on adjacent list rows read as a double tap.** Thresholds are `DOUBLE_TAP_MS` and `DOUBLE_TAP_SLOP_PX`.
- **Classic mode is real only where js-dos calls the device a phone (`TouchModeHelper.stockTouchWorks`); `effective()` forces `direct` elsewhere.** A default-UA iPad would get a dead screen.
- **Unverified on real devices:** only synthetic touches in headless Chromium; thresholds untuned; iOS Safari and a phone emulator's speed await the device pass.

Before changing this area read the verified invariants in [docs/mobile-ux/touch.md](docs/mobile-ux/touch.md).

### The control deck (the keys of a phone)

One docked panel of keycaps is the phone's keyboard for the game: `app-dock` plus `deck-key.directive.ts` in `src/app/core/components/dock/`, the pure `deck-*`, `key-repeat`, `modifier-latch` and `layout-shape` helpers, `DECK` in `constants.ts`, `_deck.scss` and the "Control deck" block of `_win9x.scss`.

- **The deck is a sibling of `#game-container`, never a child or over the picture, and the picture's box never depends on its contents.** js-dos re-lays-out its canvas on any size change; every cursor is measured against it.
- **`DeckLayoutHelper.presentation` is a pure function of viewport, primary pointer and setting; it must not read the OS keyboard.** Otherwise the deck flips between band and launcher on every field focus. The left landscape rail exists even with the deck off.
- **A keycap presses on `pointerdown` and never takes focus** (`preventDefault` on pointerdown/mousedown, `tabindex="-1"`), so js-dos keeps the physical keyboard and the OS keyboard stays shut. Pressed look is `deck-key--down`, not `:active`.
- **Release exactly once however the press ends** (up, cancel, lost capture, blur, page hidden, key disabled or destroyed). A lost release is a key that types by itself.
- **Keys in a scrollable panel press on release (`deckKeyOn="up"`); repeating keys keep the landing with `.deck-key--landing`.** `touch-action` stops intersecting at the nearest scroll container, so a drifting thumb scrolled and cancelled the hold.
- **A `click` is trusted only if no keycap released within `CLICK_AFTER_POINTER_MS`; that clock is a static shared by all keycaps.** Screen readers send a lone click, but a tap's click lands after the lift on whatever is under the finger.
- **Nothing the deck shows may change key geometry between press and release.** A "next key carries Shift" bar moved keys 44 px and sent Shift+Tab; a latched modifier is a lit key, a "Mais" label and a live region, never a bar.
- **Scroll-panel children keep `flex-shrink: 0`, and under `(pointer: coarse)` every keycap stays at least 44x44.** Shrunk rows overflowed and Num `*`, O Matic and Sair painted over F7.
- **Every key goes through `EmulatorControlService.sendKey` to `GuestKeyQueueService`, the only sender to the guest.** Keys disable while there is no emulator, the page is leaving or `faulted$`, so a held arrow does not raise one error per tick.
- **Hold-to-repeat (`KeyRepeatScheduler`) skips, never queues, a tick when the queue holds `REPEAT_MAX_PENDING`; `REPEAT_MAX_HOLD_MS` ends a forgotten hold; `stop()` is the only call.** Otherwise a slow device types on after the finger lifts.
- **Nothing is ever held down in the guest.** `ModifierLatch` wraps the next key's chord, which the queue presses and releases whole, so a forgotten latch is a lit button, never a stuck Shift. A panel switch does not clear it.
- **The chat stays the page's.** The page owns `#chat-panel`, its open state, unread count and focus; the deck mirrors them via `(chatToggle)`. Under the OS keyboard the chat lifts by `--kb-inset` less `--deck-taskbar-total`, which must match the folded dock's real height.
- **The band's taskbar keeps `margin-top: auto`, and the rails' keys stay pinned to the bottom.** Without it a folded deck rode up under the picture and the tabs jumped 440 px; keys must not move when the room, sound chip or chat comes and goes.
- **While the picture is magnified the band holds only its taskbar or the Zoom panel** (`DeckPanelHelper.withZoom`), keeping the camera's tall view free.
- **Alt+F4 ("Sair") is the only guarded key; the key table is one place (`DeckKeyHelper`).**
- **`DECK_MODE` and `DISABLE_KEY_VIBRATION` are read before boot; vibration is stored as the OFF flag so existing installs mean on.** Reading later makes the deck come and go behind the boot screen.
- **Flipping Win9x to flat is not two rules:** `grep -n 'win9x-' src/theme/_deck.scss` lists every token to touch.
- **Not verified on a real phone:** thumb reach, haptics, iOS Safari, safe-area insets, OS keyboard over chat, TalkBack and VoiceOver.

Before changing this area read the verified invariants in [docs/mobile-ux/control-deck.md](docs/mobile-ux/control-deck.md).

### The stage (the picture's box, the rails and the chat dock)

In landscape the picture's container IS the picture; its size is the pure function `StageHelper.plan` (`stage.helper.ts`), which `StageLayoutService` measures, runs and writes to `<html>` for both the host's page and the spectator's `join-game.page`.

- **The stage's size depends only on the box, viewport shape and orientation, safe areas, deck shown, chat docked open and view mode.** Never on panel or rail content, the OS keyboard, chat state or a transform: js-dos re-letterboxes and every cursor is placed from that box.
- **Browsers that resize the layout viewport for the keyboard are handled by `recompute` adding back the lost height (`covered`).** Without it a focused field halves the stage. Known limit: a portrait window with the keyboard up flips to the row layout and the chat is 0 px wide.
- **`#game-container` keeps `position: relative`, no padding, no border; zoom is `transform` only, and is the camera's.** Landscape size is whole pixels, exactly 4:3, at an integer offset. Portrait's 4:3 is pinned in CSS (`--game-box-height`).
- **Every size comes from the plan** (`--stage-*`, `--chat-panel-width`, `--chat-dock-w`, the rails' columns). A CSS width or offset the plan does not know costs the picture. The plan stays pure; `fitVideoToContainer` stays ratio-based.
- **The service writes nothing for a 0x0 page, keeps the last plan under `MIN_STAGE_WIDTH`, and removes every property on `stop()`.** Its close timer is `epoch`-guarded. The page feeds it `setKeys`, `setChat`, `setView`; the shape comes from the settled `viewport$`. Start it from `queueMicrotask` in `ngAfterViewInit` or dev mode throws NG0100.
- **Rails exist on `landscape-compact` only (viewport at most 500 px tall, no toolbar).** A key never moves when room, sound chip or chat come and go: the page's block grows down from the top, the deck's is pinned to the bottom. Rail keys reuse `DeckKeyDirective`, `DeckKeyHelper` and `GuestKeyQueueService`; arrows press on landing (`.deck-key--landing`).
- **In landscape the chat replaces the right rail and folds the left to icons;** only the picture may shrink. Tablet and laptop keep the old widths (`wideDock`).
- **Closing the chat returns its width only after the slide-out (`CHAT_CLOSE_DELAY_MS`); opening is immediate.** The stage must never grow into a panel still on screen.
- **Ampliar gains nothing on any phone measured, and its copy must keep saying so** ("same size, fewer columns of keys"). The camera never changes the stage's box.
- **Layout traps.** `.game-stream-container` must not carry `.full` (its `width: 100%` outweighs the stage). Toggles are children of the row, never of the container. The chat panel's inset padding is `min(var(--chat-dock-w), inset)`, or the closed chat is a grey strip on notch phones. No `background` shorthand on the rail room pill (it resets `background-clip`); in a one-column rail it must turn its borders and clip off.
- **The spectator's `railed` view drops the toolbar for a one-column left rail.** Same window, same picture size and place as the host, and `#stream-target`'s border box still equals the container. Spectators still only join from a fresh load.
- **Known limit:** in a short, nearly square window (457x412) one-column rails shrink the picture to 320x240; `stage.helper.spec.ts` pins it.
- **Unverified on real devices** (Galaxy A07, iPhone 15 Pro Max pending): notches, `env()` and the probe's border-box observation in Safari, thumb reach, address bar, rotating with chat open, screen readers on rails.

Before changing this area read the verified invariants in [docs/mobile-ux/stage.md](docs/mobile-ux/stage.md).

### The camera (zoom and pan of the host's picture, experimental)

A CSS transform on the host's picture root so a phone can read the game's tiny text and hit its tiny targets. Lives in `ViewportTransform` and `CameraGesture` (pure helpers), `CameraService` (element, observers, memory), `CameraPanelComponent` (deck Zoom tab) and `CAMERA` in constants.ts.

- **One writer.** `translate(x, y) scale(s)`, `transform-origin: 0 0`, on `#game-container` only, via `CameraService.write`. Never on the canvas alone, never a rotation: js-dos sizing and `OverlaySyncHelper` break.
- **At the fit there is no transform.** Remove the property and restore the root's old `style`; even `scale(1)` makes a compositing layer.
- **Never resize the picture's box.** js-dos re-letterboxes. "Zoomed" is an input of the clip (`.game-stream-container`), never the stage; re-clamp from a `ResizeObserver`, which a transform does not wake.
- **Map taps through the canvas's own `getBoundingClientRect()`** (`ViewportTransform.clientToGuest`): one formula at every scale.
- **The tap ring must not zoom.** Remote cursors zoom with the root; `TouchFeedbackHelper` divides by scale and `--camera-unscale` keeps the ring fingertip-sized.
- **Host only.** `captureStream` ignores the transform, so spectators always get the full frame; the spectator page never imports the camera.
- **Pinch gets the same samples as the recognizer.** The second finger must cancel the click or drag first and synchronously, or a button sticks. A third finger or palm is ignored.
- **Follow the click never under a landed finger, nor during a drag or pinch.** The click settles late on slow phones; a drag's press was mapped through the old picture.
- **Pinch steps are deltas, not totals.** Overshoot at an edge is owed nothing; `pointercancel`, a hidden page or `detach()` also end the pinch.
- **The touch layer listens on the clip** (`TouchSurface.stage`) and `.camera-on` gives it `touch-action: none`, so a finger beside the picture still counts.
- **No double-tap zoom, inertia or animation.** A double tap is a Windows double click; a transition makes the mapping wrong mid-frame.
- **Portrait tall view** (`.camera-tall`): the clip grows into the band while magnified; the picture keeps its size and grows from the top-left origin. In landscape the clip is the stage and never grows.
- **The live type bar and chat never move the camera;** the bar reads the visible bottom, `min(picture, clip)`.
- **Every gesture keeps a single-pointer twin** (WCAG 2.5.1): the deck Zoom tab and the options-menu Zoom row.
- **Stored state.** `CAMERA_ENABLED` is an explicit boolean so a new `CAMERA.DEFAULT_ENABLED` reaches only people who never chose. `CAMERA_VIEWS` keeps the view centre as a fraction. Both sit in `STORAGE_KEY_HOMES`; the wipe calls `detach()` first so the debounced save cannot land after it.
- **Idle is silent.** Outside Angular's zone; an unchanged state costs no style write; `detach()` removes the transform, `--camera-unscale` and observers.
- **Off as shipped, unverified on any phone.** WebKit with a transform on the WebGL canvas is unseen. If it mis-draws or mis-hits, do NOT patch around it: switch to the investigation's LAY-3 design.

Before changing this area read the verified invariants in [docs/mobile-ux/camera.md](docs/mobile-ux/camera.md).

### The live type bar (experimental)

`TypeBarComponent` is a one-line field above the OS keyboard whose text is typed into the guest as it is entered. Off by default (`STORAGE_KEY.LIVE_KEYBOARD`). Rules live in pure helpers in `src/app/core/helpers/` (`TypeMirror`, `TypeKeyHelper`, `TypeBarSession`, `CaretWatcher`, `IBeamHelper`) plus `FieldHintService` and `_type-bar.scss`.

- **All typing goes through `GuestKeyQueueService.send()`.** The queue stays the only key sender; no second planner.
- **The bar is a fixed sibling of `#game-container`, lifted by `--kb-inset`; never resize the page for the keyboard.** js-dos would re-lay-out its canvas and break the overlay sync.
- **`open()` renders and focuses the field in the same synchronous call as the tap.** iOS counts only a focus made in the gesture; nothing else opens the keyboard.
- **Never re-create the field while the keyboard is up; the fold is a class.** A new field loses focus and closes the keyboard. `WIDE_STRIP_MIN_WIDTH` must match the 520 in `_type-bar.scss`.
- **Strip keys are `appDeckKey` keycaps and send through the same session as the field.** They take no focus, so the keyboard stays up and a key follows the text before it.
- **The field's `autocorrect`/`autocapitalize`/`spellcheck` stay static template attributes;** "123" blurs and refocuses inside the tap. Landscape is always one row, on purpose.
- **Text comes from the field's value, never from a key:** `TypeMirror.sync(value)` on `input`/`compositionend`. Assumes the guest caret is at the END; text the guest drops makes later Backspaces over-delete (known).
- **Empty the bar and mirror when the guest leaves its field (`TypeBarSession.abandon`):** moving keys, a tap on the game, a key sent from elsewhere (`activity$`, told apart by a flag). Otherwise Backspaces delete text the bar never wrote.
- **Mirror a composition when it ends, not while it runs** (`COMPOSITION_SETTLE_MS`). Mid-word rewrites send stale bursts to the wrong field. Leaving a field ends the composition at once; never write the value of a field the IME is composing in.
- **A tap on the game keeps the OS keyboard via `TouchSurface.keepFocus`.** Otherwise the touch layer's focus move to `.emulator-root` closes it.
- **Named keys are authoritative from `keydown`; Backspace only in an EMPTY field.** iOS fires no `input` for it; elsewhere the `input` carries it and a keydown would delete twice.
- **Pasted control characters type as a space; the ellipsis counts as three guest chars** (`TypeMirror.settled`, `guestWidth`). A pasted Tab would otherwise press Tab behind the mirror.
- **The CapsLock guard is asked once, re-armed after `CAPS_GUARD_REARM_MS`, never per keystroke.** Each read is an emulator round trip; a mid-word read broke typing.
- **Closing mid-paste cancels the rest and toasts.** Its Cancelar is on the bar. The bar excludes chat and the compose dialog.
- **Shortcut hazard: letters are game commands with no field focused (A, M).** The badge only reports a guess; nothing may gate a key or open the keyboard on it.
- **`FieldHintService` runs only while the setting is on.** js-dos cannot remove a frame listener, so it stays registered and inert while stopped.
- **The I-beam is found by shape, never colour (XOR cursor); caret frames are taken at consecutive frame events, not a fixed delay.** Checked at 640x480 only.
- **`KeyboardInsetService` writes `--kb-inset` before telling `inset$`.** A spec pins the order.
- **Not verified on any real phone or keyboard** (device pass P8 pending); only CDP IME events and a simulated `visualViewport`.

Before changing this area read the verified invariants in [docs/mobile-ux/type-bar.md](docs/mobile-ux/type-bar.md).

### Letting the guest sleep (battery saver)

`EmulatorPowerService` calls `dosCI.pause()` when the picture stays still and `resume()` when anything wants the guest. The rule is the clockless `IdlePowerMachine` (emulator-power.helper.ts), the numbers are `EMULATOR_POWER`, and bulk work holds the guest through `GuestAccessHelper`.

- **Off by default (`STORAGE_KEY.IDLE_PAUSE`, `EMULATOR_POWER.DEFAULT_ENABLED`).** It is stored as an explicit boolean, so flipping the default reaches only people who never touched the switch. A guest slept mid-computation runs about 9x slower.
- **Anything that talks to the guest calls `wake()` first, or `hold()` for a whole job.** Input sent to a paused guest piles up and lands in one burst, defeating pointer pacing and the key buffer; a missed path reads as a stall. This covers the page's capture-phase input listeners, `GuestKeyQueueService`, `GuestPointer.beforeSend`, camera gestures and the Cheat 'O Matic (a written value is unseen until it wakes).
- **Every persist holds the guest awake** (`saveGameFileSystem` via `holdGuestAwake`, which `stop()` clears only if still its own; `GuestAccessHelper.whileAwake`). Flows that rewrite the disk, exit or leave stop the service first; `stop()` resumes a sleeper.
- **Only the emulator is paused.** `screenshot`, `persist` and `readMemory` work paused, so the auto-saver, exit watcher and OCR never wake it.
- **Never pause a hosting browser, a hidden page or a boot.** js-dos already pauses on `visibilitychange`; nothing sleeps before the game's own screen was seen.
- **Sleep needs no frame for `IDLE_MS`, no input for `INPUT_QUIET_MS` and no blocker.** A blocker also wakes a sleeper; a blinking caret in a focused field keeps the guest awake.
- **Sleeping asks `SaveSafetyService.gameSavingVerdict()`; only a definite `false` sleeps.** A static "A gravar o jogo…" dialog looks idle, and sleeping mid-write truncates the `.e98`. `true` and `null` stay awake and retry.
- **Asleep policy is `probe`; `'hard'` stays disabled.** It would freeze silent computations. A frame from a sleeping guest is a stall: idle times double up to `MAX_IDLE_MS`, kept for the page's life.
- **Log only the first probe of a sleep (category `power`).** Every probe would flood the log ring.
- **Unverified on real phones.** Every measurement is a desktop's.

Before changing this area read the verified invariants in [docs/mobile-ux/idle-pause.md](docs/mobile-ux/idle-pause.md).

### Mobile platform polish (screen lock, fullscreen, sound, install, storage)

What a phone does to the app that the game did not ask for: `WakeLockService`, `FullscreenService`, `AudioHealthService`, `InstallService`, `NudgeStateService`, `StorageHealthService`, rules in `core/helpers/*.helper.ts`, numbers in `constants.ts`. Everything is feature-detected and degrades to nothing; no code path may depend on an answer.

- **A room overrides the keep-awake switch; the spectator page holds the screen too.** A locked host phone freezes every picture. Refresh last in the spectator state handler (`HOST_LEFT` drops the room silently).
- **A wake-lock refusal is a state, not an error.** Retry only on page return, new wish or tap (`GESTURE_RETRY_MIN_MS`); never loop on grant/release cycles (`QUICK_RELEASE_*`).
- **Fullscreen the document element, never `#game-container`.** Only that subtree paints, so alerts, toasts and chat vanish. Request before any await, inside the tap.
- **The orientation lock belongs to the fullscreen action; no manifest `orientation`.** It would take portrait play from people who never asked.
- **The page starts and stops wake lock, audio and fullscreen in `ngOnDestroy`;** they hold browser state, so no `clear()`.
- **The `AudioContext` is js-dos's; create none.** `resume()` on start, visibility and gesture events (not `touchstart`); never from `statechange` (loop) or for a hidden page; `activate()` resumes synchronously in the tap.
- **Never use `dosCI.mute()`; mute is gain 0 via `dosInstance.setVolume`.** The former stops samples and spectators go silent. "Apagar todos os dados" must also remove `JSDOS_STORAGE.VOLUME_KEY`. `audioSession` playback stays off unless chosen.
- **`InstallService` starts with `AppComponent`, not the game page.** Chromium fires `beforeinstallprompt` once, early; call `prompt()` from the tap before any await. `installed` must not use the `android-app://` referrer or `display-mode: fullscreen` ("Tela cheia" hid the install entry).
- **The iOS install how-to must warn that a Home Screen app has its own storage.** Saves made in Safari are not in it; offer "Exportar jogos salvos".
- **Nudges show once per install, one per page load: backup, install, rotate** (order in `GamePage.maybeNudge`). Keep the answer in memory before writing; an unreadable store counts as answered. Install and rotate never in a room.
- **Storage line only reads `persisted()`/`estimate()` and never promises protection.** The one `persist()` request is `SaveStatusService`'s.
- **No `contentHint` on the host's video track:** a product call about every spectator's picture, never informed by a two-device session.
- **Unverified on real devices** (headless Chrome with faked APIs only): iOS `interrupted`/`resume`, wake lock in an iOS web app, orientation lock, install prompt, `persist()` outcomes.

Before changing this area read the verified invariants in [docs/mobile-ux/platform-polish.md](docs/mobile-ux/platform-polish.md).

### The options menu, "Dados e avançado", and the first minute

The app's front door: the options menu, the Win9x "Dados e avançado" window, first-run coach, boot screen, `?host=1` quick host and the spectator's waiting card. Rules live in pure helpers in `src/app/core/helpers/`; components only draw them.

- **One switch acts.** `MenuHelper` builds sections, `OptionsMenuComponent` draws, `GamePage.onMenuAction` is the only place that acts; `menuSections` is memoised by context content, or NG0100 and a re-render per pass.
- **Only an `action` row closes the menu.** Switches, volume and zoom stay open. Fullscreen, install and file pickers need the tap's call stack: await nothing before `input.click()`.
- **The sheet moves nothing.** `#game-container`'s rectangle is identical open or closed. Rows below the fold are reachable only once expanded (`setCurrentBreakpoint(1)`), not by `scrollIntoView`.
- **Back closes the window first** (`NavigationGuardHelper` `close-window`), even with no emulator (`?host=1` boot). Nothing is pushed on history (`canceledNavigationResolution: 'computed'`).
- **Targets stay >= 44 px.** A switch is the whole row (label inside `ion-toggle`); the Zoom row is the camera's single-pointer twin (WCAG 2.5.1) and shows whenever the camera is on.
- **Rows ending in a reload are disabled while a room is live** (`roomBound`): a host's reload ends the room. Nothing in the menu is destructive; no row lives in two places.
- **Inverted settings keep their keys.** `DISABLE_SMOOTH_FILTER` and `DISABLE_AUTO_SAVE` still store the OFF flag; a migration can reverse an upgrader's choice. Read via `InvertedSettingHelper`.
- **"Dados e avançado" orders groups safe to unsafe;** the wipe sits last and alone in the dashed maroon **Zona de perigo**, distinct in shape as well as colour.
- **The wipe asks twice** (`WipeFlowHelper`): backup offered first, then a ticked checkbox, never a typed word. The boot-failure wipe takes the same path.
- **The coach reuses `STORAGE_KEY.HIDE_TUTORIAL`.** Shown once, after the game's screen is seen, not on a `?host=1` visit with a live room; an unreadable store counts as answered.
- **Help topics are a name table** (`HelpTopicHelper`): renaming an FAQ/manual accordion means editing it. Scroll the guide at `ionModalDidPresent`, never after a delay: `ion-segment-view` measures 0 while hidden.
- **The boot bar never makes up a number:** determinate only while js-dos reports a percentage. The boot screen is `position: fixed` at the page root, outside `ion-content`.
- **`?host=1` never reloads the host page** to go on air. Strip the flag at once (`replaceUrl`) or every patch or retry reload reopens the dialog. Quick host never stores the password.
- **A spectator's "Cancelar" leaves and reloads** to the join page with the code on the URL: every way back into a room needs a fresh page load.
- **Loaders, boot screen and waiting card are shell, not Win9x.** Retro is for companion windows and alerts only.
- **Not verified on real phones:** sheet thumb reach, Android Back and iOS edge swipe with the sheet open, notch, real keyboard in the room dialog, upgraders' old switches.

Before changing this area read the verified invariants in [docs/mobile-ux/options-menu.md](docs/mobile-ux/options-menu.md).

### Screen-scraping instead of emulator events

js-dos exposes no game-level state, so two flows read the framebuffer: load detection (`GamePage.waitForGameScreen()`, `BootStageHelper.isGameScreen`) and auto-save (`AutoSaverService` plus OCR in `EmulatorControlService`, with `OcrRegionHelper`, `RegionVerdictCache`, `OcrWorkerHost`).

- **Both are coordinate-, colour- and language-sensitive.** Canvas size, Windows video mode or game language silently breaks them; constants `GAME_SCREEN_PROBE`, `EMULATOR_CONTROL_CONFIG`, `AUTO_SAVER`.
- **Missing green never means "the game exited".** The probe samples the backdrop, lost in play at 640x480; exit is `GameExitHelper`'s job. Recheck any retune at both modes.
- **The OCR strip stays centre-relative** (`SAVING_DIALOG_REGION`). The old absolute rectangle matched nothing at 640x480.
- **Persist only AFTER the save dialog is gone.** The game writes the `.e98` while it is up; a mid-write persist overwrites a good save with a truncated one. A failed persist is retried by later ticks, a few times.
- **`isGameSaving` is `true`/`false`/`null`, and `null` (OCR unreadable) is never the all-clear.** After the dialog was seen, `null`, a throwing `screenshot()` or an overrun look means still saving.
- **Other askers (manual, leave, hidden-page saves, idle pause) go through `SaveSafetyService`'s look,** which checks `AutoSaverService.running` first. Asking with the loop stopped starts the 5 MB worker download.
- **Never slow the tick back down.** The dialog is up 0.6-1.7 s and a phone's OCR pass is slow. Only a real save shows it, so not every "Jogar" saves.
- **OCR is a cache keyed by the strip hash, never a gate.** An unchanged strip reuses its verdict; a pixel matcher must mask the cursor sprite.
- **No caller waits for the OCR worker.** `createWorker()` has no deadline; `OcrWorkerHost` returns worker or `null` at once. Keep the retry bounded: stalled starts leak a thread.
- **The OCR worker starts with the auto-saver, never in a constructor.** `stop()` terminates it; `createWorker` needs an `errorHandler` or a failed start is an uncaught exception.
- **The loop never dies and failures are never silent.** `tick()` reschedules in `finally`; looks, loader and `persist()` each have a deadline (`HEARTBEAT_MS`, `OVERLAY_TIMEOUT_MS`, `PERSIST_TIMEOUT_MS`).
- **No OCR means a forced 5-minute periodic save, announced once.** It is a separate flag from the user's own periodic save, so OCR returning never touches theirs. Offline or with jsDelivr blocked, it is the only save.
- **Hidden pages are skipped unless hosting** (`keepRunningWhileHidden`). `GamePage.ngOnDestroy` must stop the loop: the services are root singletons.
- **`STORAGE_KEY.FAIL_COUNT` counts `elifootMain` rejections only,** never a timeout; wipe is offered from the third in a row.
- Unverified on real devices: OCR and screenshot cost and heat on a phone, 640x480 auto-save at a real kickoff, tesseract assets (jsDelivr, ~5.4 MB) over mobile data.

Before changing this area read the verified invariants in [docs/mobile-ux/screen-scraping.md](docs/mobile-ux/screen-scraping.md).

### Diagnostics log (opt-in, for real-device passes)

`DiagnosticsService` (in `main`, off by default) keeps a bounded ring buffer (`DiagnosticsLog`) of what the app did on this device, so a phone can hand evidence back. Its window, `diagnostics-modal`, lives in the lazy game chunk.

- **Log via `DiagnosticsService.log(cat, msg, data?)`, never `console.log` in a hot path.** Off, it is one boolean check and a `data` thunk never runs; `cat` comes only from `DIAGNOSTICS_CATEGORIES`. Never log typed text (only `ime` does).
- **Off means no listeners and no timers.** `DiagnosticsCapture.install` is the only place a listener is added; it and the persistence interval exist only between `enable()` and `disable()`.
- **Keep `DiagnosticsErrorHandler` and the default handler both.** Window listeners miss Angular and zone.js errors.
- **`?diag=1` lives in `sessionStorage` (`DIAGNOSTICS.SESSION_KEY`).** The router's first `replaceState` drops the query; the address wins but never writes the stored choice.
- **The log tail persists twice: Ionic Storage on an interval, `localStorage` on hide/freeze/pagehide.** Writing waits for the read (`tailRestored`); a clear wins (`clearEpoch`).
- **"Apagar todos os dados" must be final.** `wipeEverything` calls `diagnostics.disable({ persist: false })` BEFORE `clearAllData`, or `pagehide` writes the tail back; the `localStorage` copy goes via `STORAGE_KEY_HOMES`.
- **Copy and share read a report built BEFORE the tap.** Safari honours clipboard/share only inside the gesture; no `await` before the call in `DiagnosticsExportHelper`.
- **The service must not import header, report, export helpers or the window.** The header never carries the query (a share link holds a room code).
- **One switch only.** `GamePage.debugMode` just reads `DiagnosticsService.enabled`; every header probe keeps its deadline (`HEADER_PROBE_TIMEOUT_MS`).
- **Measure gaps with `w` (`Date.now()`).** `t` is `performance.now()` and may not advance while suspended.
- **Unverified on real devices:** the Galaxy A07 and iPhone 15 Pro Max passes are pending.

Before changing this area read the verified invariants in [docs/mobile-ux/diagnostics.md](docs/mobile-ux/diagnostics.md).

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
the chat toggle's rules in `global.scss`), the Cheat 'O Matic modal, the diagnostics window, **"Dados e avançado"** and the **first-run coach** (companion
windows, P13), the **control deck** (keycaps, taskbar, panels, a landscape phone's rails and the launcher's sheet: it is the Windows 3.1 machine's keyboard, so it
is a companion window, decision D3), the live type bar (the deck's keys and face under a title bar, same decision) and every `AlertController` dialog. It does
**not** apply to the page toolbars (`ion-toolbar color="tertiary"`), the landing cards, the
toolbar's "Teclas" button and the round menu button in a landscape phone's rail (they are app chrome, and the first only
opens the Win9x sheet), the options menu (the bottom sheet and the desktop popover: the app's own menu), the boot screen, the spectator's waiting card and the
loaders (`ion-loading`: a state indicator, not a window; see *The options menu, "Dados e avançado", and the first minute*) — the navy `#092469` in
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
still agree (38 today; P13 removed two — the welcome and the one-step wipe — and added two, the wipe's questions) — a manual check, because `npm run lint` covers only `.ts`/`.html`
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

- **The FAQ and the manual load nothing from a third party.** Their accordions render the content slot
  immediately, so an embed (an iframe, an image from another host) would contact that host whenever the guide
  opens, against the landing page's footer, which says nothing is sent to anyone. The 'O Matic video was
  dropped for that reason as much as for its dead id; a new embed needs a click-to-load facade that requests
  nothing (not even a thumbnail) until the tap.
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

`@angular/service-worker` ([ngsw-config.json](ngsw-config.json)), the manifest and `index.html`; `AppComponent` watches `SwUpdate.versionUpdates` and applies updates by reloading.

- **Manifest identity is pinned.** `id`, `scope` and `start_url` stay put so installed copies keep their identity; no `orientation` or `display_override` (D4), since "Tela cheia" locks landscape itself.
- **One online visit must be enough to start offline.** The `jsdos` group prefetches its files by name, never a `js-dos*` wildcard (drags in 1.8 MB of maps); add any file js-dos newly fetches at runtime.
- **Icons are a cache-first `dataGroups` entry (`/svg/**`), not an asset group.** Else a thousand files enter `ngsw.json`; an icon is cached only once drawn online, so offline glyphs can be blank.
- **Maskable icons come from `scripts/pwa-icons/make-maskable.mjs`.** Lettering must stay inside the 40% safe zone; installed copies change icon only on manifest refresh.
- **After touching `ngsw-config.json`, test a production build:** serve on localhost, load `/#/game`, stop the server (CDP offline hides gaps), cold-load: no failed request.
- **An update reload saves first.** `installUpdate()` persists under `APP_UPDATE` timeouts, then reloads regardless; a bare `location.reload()` loses progress, a hung persist must not block updates.
- **A hosting browser is asked before "Instalar agora" reloads** (`MultiplayerService.isHosting`): a reload ends the room for spectators.
- **`AppComponent` reaches `MultiplayerService` by dynamic `import()` plus `Injector`.** A static import pulls trystero into the main bundle.
- Unverified on real devices: offline cold launch, a real `VERSION_READY` update, `SAVE_TIMEOUT_MS`, slow-link first visit.

Before changing this area read the verified invariants in [docs/mobile-ux/pwa.md](docs/mobile-ux/pwa.md).

### Leftover scaffolding

`ionic.config.json` / `capacitor.config.ts` still carry the Ionic starter identity
(`Elifoot98Keygen`, `io.ionic.starter`) and there are no native platform folders — Capacitor is
unused; the target is the browser/PWA only.
