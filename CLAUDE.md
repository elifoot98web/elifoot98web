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
  `dependabot[bot]` is exempt — it only edits dependency ranges and cannot bump `version`, so without
  that exemption none of its PRs could ever land.
- Push to `main` → build `githubpages` config, deploy to GitHub Pages, push a `v<version>` tag.
- Push to the `firebase` branch → Firebase Hosting (project `elifoot-98`); PRs also get preview channels.
- `lockfile-hygiene.yml` fails any PR whose `package-lock.json` resolves from a non-public registry.

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

- `elifootMain(pathPrefix, gameBundleURL)` — creates the DOS instance in `#game-container`, runs the
  bundle, resolves the command interface (`dosCI`); rejects after 15 s.
- `saveGameFileSystem()` — `dosInstance.layers.save()`, i.e. flush changed FS to IndexedDB.
- `toggleSoftKeyboard()` — shows/hides the js-dos `.emulator-keyboard` div.
- `dosInstance` — the raw js-dos instance, needed by `PatchService` for `emulatorsUi.persist`.

[src/app/models/jsdos.d.ts](src/app/models/jsdos.d.ts) is a hand-maintained typing of the js-dos
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
([save-game.service.ts](src/app/services/save-game.service.ts)) plus the Ionic Storage keys.

### Patching (the central trick)

[patch.service.ts](src/app/services/patch.service.ts) modifies the virtual disk without any guest-side
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
- **Auto-save** — [auto-saver.service.ts](src/app/services/auto-saver.service.ts) ticks every 1.5 s
  and [emulator-control.service.ts](src/app/services/emulator-control.service.ts) OCRs a fixed
  rectangle (`EMULATOR_CONTROL_CONFIG.DEFAULT_AREA_OF_INTEREST`) with tesseract.js (`por` model)
  looking for "a gravar o jogo…" via sliding-window Levenshtein distance. When the game finishes its
  own save, the VM is persisted so progress survives a browser reload.

Both are coordinate- and color-sensitive: changing the emulator canvas size, the Windows 3.1 video
mode/resolution, or the game's language will silently break them. Constants live in
[constants.ts](src/app/models/constants.ts).

### Other services

- [cheat-omatic.service.ts](src/app/services/cheat-omatic.service.ts) — a Cheat-Engine-style memory
  scanner over `readMemory`/`writeMemory`, sweeping the 8 MB address space in 1 MB chunks and
  narrowing matches across successive searches (`SearchState` machine, byte/word/dword/string type
  inference, saveable `0x…` addresses).
- [emulator-control.service.ts](src/app/services/emulator-control.service.ts) — also converts strings
  to DOSBox keycode sequences (`EmulatorKeyCodeHelper`, 30 ms between strokes) for the text-input dialog.
- [local-storage.service.ts](src/app/services/local-storage.service.ts) — thin wrapper over
  `@ionic/storage-angular`; all keys in `STORAGE_KEY`.
- [layout-helper.service.ts](src/app/services/layout-helper.service.ts) — synchronous
  `window.innerWidth/Height` checks; drives mobile/landscape template branches (e.g. the F1–F12
  formation buttons are reversed in portrait).

### PWA

`@angular/service-worker` with [ngsw-config.json](ngsw-config.json) prefetching the game bundle and
lazily caching js-dos wasm. `AppComponent` watches `SwUpdate.versionUpdates`, records
`STORAGE_KEY.PENDING_UPDATE`, and applies updates by reloading (immediately or on next launch).

### Leftover scaffolding

`ionic.config.json` / `capacitor.config.ts` still carry the Ionic starter identity
(`Elifoot98Keygen`, `io.ionic.starter`) and there are no native platform folders — Capacitor is
unused; the target is the browser/PWA only.
