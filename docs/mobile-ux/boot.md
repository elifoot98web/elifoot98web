# Booting the emulator

> Design record for this area, moved out of `CLAUDE.md` (2026-10-30/31). The first section is the VERIFIED summary of the
> invariants (each checked against the code at the time by an independent pass); the second is the verbatim record written phase
> by phase while the area was built. The plan and the as-built history are in [../mobile-ux-study.md](../mobile-ux-study.md); what only
> real phones can confirm is in [../mobile-ux-device-pass.md](../mobile-ux-device-pass.md).

## Invariants (verified summary)

`GamePage.bootGame()` starts js-dos through `elifootMain` ([game.js](../../src/scripts/game.js)), keeps the boot screen (*The boot screen*) in step with it and decides what a failure means. The `boot-progress`, `boot-stage` and `boot-failure` helpers (in [src/app/core/helpers/](../../src/app/core/helpers/)) are specced; `game.js`'s deadline logic is not (karma cannot load it), so check it in a real browser. Load-bearing:

- **A timeout is the end of one wait, not of the boot.** `elifootMain` rejects `JsdosTimeoutError` when js-dos's loading text (`.emulator-loading-pre-2`) goes `BOOT_STALL_MS` (20 s) without a *change*, `BOOT_STALL_AFTER_DOWNLOAD_MS` (60 s) once it reads "Downloading bundle 100%" (js-dos then fetches and compiles `wdosbox.wasm` over the same link and writes nothing), or when one wait passes `BOOT_HARD_CAP_MS` (120 s; the only deadline if that element is missing). A flat clock once made a slow first download a failure that reloaded into itself; the percentage exists only while the server sends a length, without one a slow download looks stalled. Both clocks key on js-dos's own English text, so a js-dos upgrade must re-check them. The boot keeps running, so `elifootMain` called again **re-attaches** to it instead of stacking a second DOSBox: a failed boot reports the same error again, and one that finished while nobody was waiting hands its `dosCI` to the next call.
- **Re-attach only inside the element the boot started in.** A boot is replaced once its result was delivered **or when `#game-container` is no longer its element** (`GamePage` is rebuilt within one document: Back, then Jogar): `Dos()` builds canvas and input inside that element, so re-attaching gave the new page a `dosCI` over a detached tree, or replayed an old failure as a new attempt that counted toward the wipe offer. The abandoned boot is not stopped (`stop()` cannot cancel a download). Alerts outlive the route, so `GamePage.ngOnDestroy` dismisses its boot dialog and "Continuar esperando" ignores a destroyed page (it would start a boot nothing is watching).
- **The bundle URL must never change.** No `blob:` URL or renamed copy to get finer progress: the changes layer is keyed `bundleURL + '.changes'` (`PatchService` hardcodes the same string), so another URL orphans every saved game.
- **"Ready" is not the game.** After `run()` resolves, `waitForGameScreen` polls the framebuffer for `GAME_BOOT.DETECTION_TIMEOUT_MS` and `BootStageHelper.classify` labels the stage (under 480 lines: DOS text; black graphics: Windows 3.1; flat `(0, 64, 128)`: desktop, game loading); only the game's green ends the wait. The label never goes back (a black frame between desktop and splash would flip it) and the blue never declares ready. The green test is the original probe (`GAME_SCREEN_PROBE`: 3 of 8 colour/point pairs, tolerance 25): re-measure at 640x480 and 800x600 before retuning (*Screen-scraping instead of emulator events*). A window that closes without green is not an error: no first-run coach, a toast "O jogo ainda está iniciando…", and the exit watcher arms itself on the same `isGameScreen`.
- **Three kinds of failure, three outcomes** (`BootFailureHelper.kindOf`, which reads the real `name`/`message` `elifootMain` rejects with). `timeout`: "Continuar esperando" / "Tentar de novo", `FAIL_COUNT` untouched, nothing reloads by itself. `network` (any non-200, a 404 included, or `js-dos.js` never loaded): counted, but a wipe cannot fix a missing download, so it is never offered. `other` (the emulator threw, e.g. "Broken bundle"): counted, and once the count (reset when the emulator starts) reaches `WIPE_OFFER_AFTER_FAILURES` (3) the dialog adds "Apagar todos os dados…", always beside "Baixar cópia dos meus dados". js-dos's English goes to the console. Only a failure to *start* the emulator is a boot failure; an exception after it (settings, coach, the room asked for) is logged and alerted, never a reload (the old catch-all reloaded a game that was running).
- **The backup and the wipe work without an emulator.** `SaveGameService.readStoredChanges()` reads the layer straight from IndexedDB (every `js-dos-cache*` database, store `files`, the `<bundle url>.changes` entry), and `clearAllData(null)` still deletes the databases (it returned early without a `dosCI`, so the wipe reloaded into the same broken disk). Without `indexedDB.databases()` (Firefox before 126) the backup opens the one known name, `js-dos-cache (emulators-ui-saves)`, and **must abort the upgrade if it does not exist**: an open that creates it leaves a database without its `files` store, which js-dos never repairs, so every later save fails. js-dos drops a layer IndexedDB cannot *read* and boots a pristine game; a readable layer that is not a valid zip fails in the worker as `other`, which is what the third-failure wipe offer is for (read from the vendored source and pinned by a `kindOf` spec, not run in a browser).
- **js-dos paints its own red toast** ("Can't start emulator…") on a failed `run()`; it sits over the failure dialog and is left alone: it is the global notyf container shared with every other js-dos message.

Not verified on a real phone or iOS: boot timings (the 45 s detection window is a ceiling chosen for a phone, not a measurement).

## Full record (verbatim)

> Written phase by phase. Where it disagrees with the summary above or with the code, those win: later phases changed some earlier facts
> (for example, which root services keep a `DosCI`, and that two-peer sessions at 640x480 were later run).

`GamePage.bootGame()` starts js-dos through `elifootMain`, keeps the boot screen (*The boot screen*) in step with it and
decides what a failure means. The pure parts are specced
([boot-progress](../../src/app/core/helpers/boot-progress.helper.ts),
[boot-stage](../../src/app/core/helpers/boot-stage.helper.ts) and
[boot-failure](../../src/app/core/helpers/boot-failure.helper.ts) helpers); the deadline logic lives in
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
  a `dosCI` whose picture and input sat in a detached tree (a dialog over an empty game
  area), or replayed the old failure as if it were a new attempt: three round trips counted
  three failures and reached the wipe offer without one real try. The abandoned boot is not
  stopped (`stop()` cannot cancel a download in flight): the same ghost emulator the code had
  before any of this. Because alerts outlive the route,
  `GamePage.ngOnDestroy` also dismisses its timeout/failure dialog, and "Continuar esperando"
  does nothing for a destroyed page (it would start a boot nothing is watching). Without an
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
  A window that closes without green is not an error: the page carries on without the first-run
  coach and says "O jogo ainda está iniciando…" in a toast. Measured on a desktop dev server
  (frames every 250 ms): DOS text at 0.5 s, black graphics at 1.8 s, the desktop at 2.0 s and the
  game's green at 4.1 s after navigation, 3.5 s after `run()` resolved; a phone's numbers are
  unknown, which is what the 45 s is a ceiling for.
- **Three kinds of failure, three outcomes** (`BootFailureHelper.kindOf`). `timeout`: dialog with
  "Continuar esperando" / "Tentar de novo", `FAIL_COUNT` untouched, nothing reloads by itself.
  `network` (js-dos's "Network error, can't download", which is *any* non-200 including a 404, or
  `js-dos.js` never loaded): counted, but a wipe cannot fix a missing download, so it is never
  offered. `other` (the emulator itself threw, e.g. "Broken bundle"): counted, and from the third
  in a row the dialog adds "Apagar todos os dados…", always beside "Baixar cópia dos meus dados".
  Nothing is shown from js-dos's English: it goes to the console. Only a failure to *start* the
  emulator is a boot failure; an exception in the settings, the first-run coach or the room asked for after
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
