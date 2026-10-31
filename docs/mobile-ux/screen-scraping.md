# Screen-scraping instead of emulator events

> Design record for this area, moved out of `CLAUDE.md` (2026-10-30/31). The first section is the VERIFIED summary of the
> invariants (each checked against the code at the time by an independent pass); the second is the verbatim record written phase
> by phase while the area was built. The plan and the as-built history are in [../mobile-ux-study.md](../mobile-ux-study.md); what only
> real phones can confirm is in [../mobile-ux-device-pass.md](../mobile-ux-device-pass.md).

## Invariants (verified summary)

Two flows read the framebuffer because js-dos exposes no game-level state (and the guest is a 16-bit Windows app, so there is nothing to hook):

- **Load detection** — `GamePage.waitForGameScreen()` polls `dosCI.screenshot()` (`GAME_BOOT`: 500 ms looks, 45 s window, each look raced against `SCREENSHOT_TIMEOUT_MS` because `screenshot()` has no deadline) and `BootStageHelper.isGameScreen` samples four hardcoded pixels (`GAME_SCREEN_PROBE`, tolerance 25) for the game's green. It waits for the *game's* screen, so it also covers the DOS + Windows 3.1 boot, and the same frames label the boot screen's stage (see *Booting the emulator*). `STORAGE_KEY.FAIL_COUNT` counts rejections of `elifootMain` only (never a timeout; an undetected screen resets it), and the wipe is offered from the third in a row, for a failure of the emulator itself only.
- **Auto-save** — [auto-saver.service.ts](../../src/app/core/services/game/auto-saver.service.ts) samples the framebuffer every `DEFAULT_TICK_INTERVAL_MS` and [emulator-control.service.ts](../../src/app/core/services/game/emulator-control.service.ts) OCRs one strip with tesseract.js (`por`) for "a gravar o jogo…" by sliding-window Levenshtein distance. When the game finishes its own save, the VM is persisted so progress survives a reload. Helpers: `OcrRegionHelper`, `RegionVerdictCache`, `OcrWorkerHost`, `TimeoutHelper`.

Load-bearing invariants:

- **Both are coordinate-, colour- and language-sensitive.** Changing the canvas size, the Windows 3.1 video mode or the game's language silently breaks them; constants are in [constants.ts](../../src/app/core/models/constants.ts) (`GAME_SCREEN_PROBE`, `EMULATOR_CONTROL_CONFIG`, `AUTO_SAVER`). Re-check any retune of the probe at both video modes (next bullet).
- **The green probe is a boot-only signal; at 640x480 "green lost" is the normal state.** The four points sample Elifoot's green BACKDROP form, not the game window: at 800x600 the window is centred and the backdrop shows for the whole run, at 640x480 the window fills the frame and in play the points read the menu bar and the squad list. It passes at boot only because the splash is smaller than the frame and sits on the backdrop. Nothing may read a missing green as "the game exited": that is told by Windows' desktop blue `(0, 64, 128)` plus the Program Manager icon (`GameExitHelper`, see *Save safety nets*).
- **The OCR strip is centre-relative** (`OcrRegionHelper.savingDialogRegion`, `SAVING_DIALOG_REGION`), because the dialog is centred and byte-identical at both video modes; the old absolute rectangle silently matched nothing at 640x480.
- **The save dialog is brief, and only a real save shows it.** It is up 0.6 s to 1.7 s depending on the machine (the video mode does not change it), which is what the 300 ms tick must catch on a phone whose OCR pass is slow: never slow the tick back down. A loaded game's later kickoffs and end of round show none, so not every "Jogar" saves; "A iniciar o jogo…" and "A carregar o jogo…" sit in the same place and read `false` only because their edit distance is above `DEFAULT_TOLERANCE_GAME_SAVING_DETECTION`, as do the half-time and end-of-round screens.
- **Persist only AFTER the dialog is gone.** The game writes the `.e98` while it is up, and a persist that lands mid-write stores a truncated save over a good one; `monitor()` waits for it to disappear (`MAX_WAITING_TIME_FOR_GAME_SAVE_DETECTED`), then persists. A persist that fails is owed and retried by the next tick that finds no dialog, a few times, then dropped.
- **`isGameSaving` answers `true`, `false` or `null` ("OCR could not read the strip"), and `null` is never the all-clear.** Once the dialog has been seen, a `null`, a throwing `screenshot()` and a look that overruns the heartbeat all count as "still saving"; before, `null` is "not saving". Folding OCR failures into `false` would persist mid-write when the worker dies under the save's memory spike. A `null` is not remembered. Other askers (the manual, leave and hidden-page saves and the idle pause) go through `SaveSafetyService`'s look, which counts `null` the same way and checks `AutoSaverService.running` first, because asking with the loop stopped starts the 5 MB worker download for a page that switched auto-save off.
- **OCR is a cache keyed by a hash of the strip, never a gate in front of it.** A look is `screenshot()` plus an FNV-1a of the strip; OCR runs only for a strip it has not read, and an unchanged one gets the verdict it got last time (`RegionVerdictCache`) — remembered, not just "unchanged", because while the dialog is up the strip is static and the caller asks whether it is *still* up. A moving guest cursor changes the hash and costs one more pass; it cannot suppress one. **A future pixel-signature matcher must mask the cursor sprite**, which is drawn into the framebuffer.
- **No caller ever waits for the OCR worker.** `createWorker()` has no deadline (with the language file unreachable it stays pending for ever), so `OcrWorkerHost` hands out the worker or `null` at once; a start is one memoised attempt raced against `OCR_WORKER_TIMEOUT_MS`, retried on `OCR_RETRY_BACKOFF_MS`, then abandoned until auto-save is switched off and on. tesseract.js returns the `Worker` only once initialised, so a stalled start leaves a thread nobody can terminate (a late one is adopted if nothing is ready, terminated if something is) and the bounded retry count is what bounds the leak: **do not "fix" it into an unbounded retry.** The worker starts when the auto-saver does (after the game loaded), never in a constructor, and `stop()` terminates it; `createWorker` gets an `errorHandler` or a failed start is also an uncaught exception.
- **The loop never dies, and a failure is never silent.** `tick()` reschedules in `finally` (a throw once set `ERROR` and ended auto-save while the menu still showed it on); a failed tick is retried on `RETRY_BACKOFF_MS`, then every 60 s. Each look is guarded by `HEARTBEAT_MS` (`isGameSaving` has no deadline), the tick as a whole is not (it lasts as long as the save). The "Salvando máquina virtual…" loader is dismissed in `finally` and its present/dismiss bounded by `OVERLAY_TIMEOUT_MS` (a page Chrome counts as hidden never finishes those animations); `persist()` is serialised and bounded by `PERSIST_TIMEOUT_MS`; the periodic save is awaited and caught.
- **When OCR is unavailable the 5-minute periodic save is forced and the user is told once** (a toast from `AutoSaverService`, because only it knows the fallback is on). It is a separate flag from the user's own periodic save, so OCR coming back, or `stop()`, ends the forced one without touching theirs.
- **Hidden pages are skipped unless hosting.** A host keeps streaming and playing from a tab behind another, so `start()` takes `keepRunningWhileHidden` (the page passes `MultiplayerService.isHosting`). The loop runs outside the Angular zone (several ticks a second would each cost a change-detection pass), and `GamePage.ngOnDestroy` stops it: the services are root singletons that survive errors by design.
- **Known, not fixed:** the tesseract worker, core and `por` model (~5.4 MB) come from jsDelivr at runtime (decision D5: self-host later). Offline or with the CDN blocked, OCR is unavailable and the forced periodic save is all that saves the game; the fixed worker deadline can be shorter than a slow mobile link needs (the retries and a late worker's adoption mostly absorb that).
- **Unverified on real devices** (the Galaxy A07 / iPhone 15 Pro Max passes are pending): the OCR and 3.3 Hz screenshot cost and heat on a phone, auto-save at 640x480 on a real kickoff, and the tesseract assets loading over mobile data.

Details and measurements: [docs/mobile-ux/screen-scraping.md](../../docs/mobile-ux/screen-scraping.md).

## Full record (verbatim)

> Written phase by phase. Where it disagrees with the summary above or with the code, those win: later phases changed some earlier facts
> (for example, which root services keep a `DosCI`, and that two-peer sessions at 640x480 were later run).

Two flows read the framebuffer because js-dos exposes no game-level state (and the guest is a 16-bit
Windows app, so there is nothing to hook):

- **Load detection** — `GamePage.waitForGameScreen()` polls `dosCI.screenshot()` every 500 ms for up
  to 45 s (each look raced against 5 s, because `screenshot()` has no deadline) and
  `BootStageHelper.isGameScreen` samples four hardcoded pixels for the game's green background
  (tolerance 25). Note this waits for the *game's* screen, i.e. it also covers the DOS + Windows 3.1
  boot time, and the same frames label the boot screen's stage (see *Booting the emulator*). Failures
  increment `STORAGE_KEY.FAIL_COUNT`, timeouts and an undetected screen do not; the wipe is
  offered from the third failure of the emulator itself.
- **Auto-save** — [auto-saver.service.ts](../../src/app/core/services/game/auto-saver.service.ts) samples
  the framebuffer every 300 ms and [emulator-control.service.ts](../../src/app/core/services/game/emulator-control.service.ts)
  OCRs one 132x20 strip with tesseract.js (`por` model) looking for "a gravar o jogo…" via
  sliding-window Levenshtein distance. When the game finishes its own save, the VM is persisted so
  progress survives a browser reload.

Both are coordinate- and color-sensitive: changing the emulator canvas size, the Windows 3.1 video
mode/resolution, or the game's language will silently break them. Constants live in
[constants.ts](../../src/app/core/models/constants.ts). The load-detection pixels are absolute and pass at
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
Confirmed on a real boot at 640x480 in the app: `Green check passed`, and the boot screen reads "Iniciando
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
