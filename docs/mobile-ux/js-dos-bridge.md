# The Angular ↔ js-dos bridge

> Design record for this area, moved out of `CLAUDE.md` (2026-10-30/31). The first section is the VERIFIED summary of the
> invariants (each checked against the code at the time by an independent pass); the second is the verbatim record written phase
> by phase while the area was built. The plan and the as-built history are in [../mobile-ux-study.md](../mobile-ux-study.md); what only
> real phones can confirm is in [../mobile-ux-device-pass.md](../mobile-ux-device-pass.md).

## Invariants (verified summary)

js-dos is **vendored, not an npm dependency**: `src/assets/js-dos/` (js-dos.js, wdosbox.wasm) is loaded by plain `<script>` tags in [index.html](../../src/index.html), which also loads `elifootweb.js` — the bundle name `angular.json` gives [src/scripts/game.js](../../src/scripts/game.js) (`inject: false`, so the tag is hand-written). `game.js` is plain JS outside the TypeScript build and **not loaded by the karma specs** (they stub the globals), so a change to it is only ever checked in a real browser.

`game.js` exposes four browser globals, typed in [src/scripts/game.d.ts](../../src/scripts/game.d.ts) and called directly from Angular services, and reads one the other way round (`holdGuestAwake`):

- `elifootMain(pathPrefix, gameBundleURL, onProgress?)` — creates the DOS instance in `#game-container`, runs the bundle, resolves the command interface (`dosCI`). `onProgress(text)` gets js-dos's own loading text on every change, in English and unparsed (`BootProgressHelper` makes the pt-BR line). That text (`.emulator-loading-pre-2`) is the only progress js-dos exposes; if a js-dos update drops the element, only `BOOT_HARD_CAP_MS` is left as a deadline, and if it rewords "Downloading bundle 100%" (the cue for the longer window) the boot silently falls back to `BOOT_STALL_MS` (the `BOOT_*` constants sit at the top of `game.js`).
- **Error contract.** `elifootMain` rejects with the real error from `Dos()`/`run()`, name and message untouched (a non-Error rejection is wrapped, keeping the `name`/`message` it carries), or with an Error named `JsdosTimeoutError` (carrying `lastProgress`) when the text stops changing for `BOOT_STALL_MS` (`BOOT_STALL_AFTER_DOWNLOAD_MS` once the download is complete, the one silent step) or one wait passes `BOOT_HARD_CAP_MS`. Callers tell a slow boot from a broken one by `name`. **A timeout ends the *wait*, not the boot**: calling again re-attaches to the boot in flight, while `#game-container` is still the element it started in, instead of stacking a second DOSBox on the first. See *Booting the emulator*.
- **Never hand `gameBundleURL` anything but the bundle's own URL** (no `blob:`, no renamed copy): js-dos keys the saved changes layer by `"<url>.changes"` and `PatchService` hardcodes the same key, so any other URL orphans every existing save.
- **js-dos's on-screen keyboard is built where nothing can see it, and must stay that way.** `Dos()` gets `layersOptions: { keyboardDiv: <a div that is never attached> }`, because its 63 keys cover 60% of a portrait picture and press through `simulateKeyPress`, which wedges the guest when two land within 16 ms (the control deck, through `GuestKeyQueueService`, is the keyboard). `global.scss` hides `.emulator-keyboard` as the net if a js-dos update stops honouring the option, and ESLint rejects any `simulateKeyPress` in app code; `toggleSoftKeyboard` is gone.
- `saveGameFileSystem()` — `dosInstance.layers.save()`, i.e. flush the changed FS to IndexedDB, with the guest held awake for the flush; a no-op while there is no emulator (the update prompt in the main bundle relies on that).
- `dosInstance` — the raw js-dos instance, **undefined until the game page has started js-dos** (`Dos()` assigns it when `elifootMain` begins, before the boot finishes; guard with `typeof` or `?.`). `PatchService` needs it for `emulatorsUi.persist`, `GamePage` for `layers` (`root`, `mouseOverlay`, `canvas`), the elements direct touch attaches to, and the O Matic modal takes the current `dosCI` from `dosInstance.ciPromise`.
- `getDosAudioNode()` — js-dos's own `ScriptProcessorNode`, or `null`. js-dos builds its `AudioContext` privately inside `run()`, so `game.js` wraps `AudioContext.prototype.createScriptProcessor` at load (before `elifootMain` can run) and keeps the one node created with no inputs and one output, so no other processor can be mistaken for js-dos's. That wrapper is the only patch to a global in the app; `MultiplayerAudioService` (see the audio invariant in the Multiplayer section), `AudioHealthService` and `TouchInputService` read the node.
- `holdGuestAwake(reason)` — **the other direction**: Angular registers it, `game.js` calls it. `EmulatorPowerService` sets `globalThis.holdGuestAwake` while it runs and clears it when it stops, only if the function is still its own; `saveGameFileSystem()` calls it around `layers.save()` and releases in `finally`; TypeScript outside the service goes through `GuestAccessHelper.hold` / `whileAwake`. **Any new bulk read or write of the guest (a persist, a backup, a memory sweep) goes through one of those, never bare**: the update prompt cannot import a game-chunk service, and every persist must meet in one place to wake a sleeping guest (a persist was never run against a paused one). See *Letting the guest sleep*.

[src/app/core/typings/jsdos.d.ts](../../src/app/core/typings/jsdos.d.ts) is a hand-maintained typing of the js-dos command interface (`DosCI`) — screenshot, key/mouse injection, `persist()`, `readMemory`, `writeMemory`. **`GamePage.dosCI` is `any` and is threaded into every service as a parameter (into the control deck as an `@Input` that sends through the key queue and keeps nothing); no singleton owns it.** The root services that keep driving it between calls (`TouchInputService`, `SaveSafetyService`, `GameExitWatcherService`, `EmulatorPowerService` (only while its battery-saver setting is on), `FieldHintService`, `AutoSaverService`; the key queue only for the length of one job) outlive `GamePage`, which is destroyed and rebuilt within one document, so `GamePage.ngOnDestroy` must cancel the queue and detach or stop each of them, or they keep driving a dead emulator. `CheatOmaticService` also remembers the last one but acts only when its modal asks, so it needs no stop. A new service that keeps `dosCI` must be added there.

## Full record (verbatim)

> Written phase by phase. Where it disagrees with the summary above or with the code, those win: later phases changed some earlier facts
> (for example, which root services keep a `DosCI`, and that two-peer sessions at 640x480 were later run).

js-dos is **vendored, not an npm dependency**: `src/assets/js-dos/` (js-dos.js, wdosbox.wasm) is
loaded by plain `<script>` tags in [index.html](../../src/index.html), which also loads `elifootweb.js` —
the bundle name `angular.json` gives [src/scripts/game.js](../../src/scripts/game.js) (`inject: false`, so
the tag is hand-written).

`game.js` exposes four browser globals, typed for TypeScript in
[src/scripts/game.d.ts](../../src/scripts/game.d.ts) and called directly from Angular services, and reads one the other way round
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

[src/app/core/typings/jsdos.d.ts](../../src/app/core/typings/jsdos.d.ts) is a hand-maintained typing of the js-dos
command interface (`DosCI`) — screenshot, key/mouse injection, `persist()`, `readMemory`,
`writeMemory`. `GamePage.dosCI` is `any` and gets threaded into every service as a parameter, and into the control deck as an `@Input` (which
sends through the key queue and keeps nothing); no singleton owns it. Five root services touch it for longer than a call: the key queue (see *Typing into the
guest*), which keeps it only for the length of a job, `TouchInputService` (see *Touching the guest*), which
holds it from `attach()` to `detach()`, and `SaveSafetyService`, `GameExitWatcherService` and `EmulatorPowerService` (see *Save safety
nets* and *Letting the guest sleep*), which hold it from `GamePage.loadConfig()` to `stopSafetyNets()` (the last only while its
setting is on). `GamePage.ngOnDestroy` cancels whatever is still queued, detaches and stops them.
