# Letting the guest sleep (battery saver)

> Design record for this area, moved out of `CLAUDE.md` (2026-10-30/31). The first section is the VERIFIED summary of the
> invariants (each checked against the code at the time by an independent pass); the second is the verbatim record written phase
> by phase while the area was built. The plan and the as-built history are in [../mobile-ux-study.md](../mobile-ux-study.md); what only
> real phones can confirm is in [../mobile-ux-device-pass.md](../mobile-ux-device-pass.md).

## Invariants (verified summary)

DOSBox pins a core at ~100% even on a menu that never changes (lowering `cycles` changes nothing), and a manager game is mostly still menus, so on a phone that is battery and heat. [`EmulatorPowerService`](../../src/app/core/services/game/emulator-power.service.ts) calls `dosCI.pause()` when the picture has been still long enough and `resume()` the moment anything wants the guest. The rule is [`IdlePowerMachine`](../../src/app/core/helpers/emulator-power.helper.ts) (no clock, timer or emulator: every call carries the time, so a spec can run a minute of idling in microseconds), the numbers are `EMULATOR_POWER` in [constants.ts](../../src/app/core/models/constants.ts), and bulk work outside the service (a persist, a backup, a memory scan) holds the guest through [`GuestAccessHelper`](../../src/app/core/helpers/guest-access.helper.ts), which does nothing without a running service (the key queue and the page call `wake()` directly). The service runs outside Angular's zone, hooks js-dos's `onFrame` once per emulator (it cannot be removed), and lives only while the setting is on and `GamePage`'s safety nets are up (`syncIdlePause`; `stopSafetyNets` stops it first).

- **Off by default, one constant from on.** `STORAGE_KEY.IDLE_PAUSE` ("Economizar bateria quando parado", Dados e avançado > Recursos experimentais) is stored as an explicit boolean, so flipping `EMULATOR_POWER.DEFAULT_ENABLED` reaches only people who never touched the switch. *Why off:* at the roadmap's 2 s idle time the scripted Elifoot rounds ran 1.8x slower, because the game computes for whole seconds with the picture untouched and a guest put to sleep mid-computation finishes at the probe's duty cycle (about a ninth of its speed). `IDLE_MS` is 20 s, above the longest such stretch seen on a desktop (~10 s); a phone's are unmeasured. The FAQ entry follows `DEFAULT_ENABLED` and `IDLE_MS` by binding (the menu description only `IDLE_MS`); the "Ainda não foram testados em celulares de verdade" prose (`AdvancedMenuHelper`'s experimental group, the manual's accordion) is revised by hand in the commit that flips it.
- **Anything that talks to the guest calls `wake()` first, or `hold()` for the length of a job** (both are no-ops when the service is not running, i.e. whenever the setting is off). *Why:* `pause()` is a flag that stops the guest's clock; input sent to a paused guest is not lost but piles up and lands in one burst on resume, and the guest sums close mouse motion and applies its gain to the sum (the pointer engine's pacing exists for that) while DOSBox's key buffer drops what a burst overruns (the 14-event rule); waking first means the guest is already running when the first event lands, so every sender's pacing holds. Each of these must keep doing it: the page's capture-phase passive listeners on `document` (`EMULATOR_POWER.INPUT_EVENTS`, capture so they run before the touch layer stops the event on the emulator's root; `pointermove` only with a button down or the pointer locked, because a hovering mouse sends the guest nothing); `GuestKeyQueueService` (`submit`, and `run` before each task, so a long text never sees the guest fall asleep under it); `GuestPointer.beforeSend`, wired as `TouchSurface.beforeSend` (before every motion and button, its timers outlive the finger); the camera's gestures and buttons (`CameraOptions.activity`); the Cheat 'O Matic sweep and write (`hold`: memory access works on a paused guest, but a written value is not seen until it wakes). A missed path degrades to "delayed until the next probe", not "lost", and that probe's frame is then misread as a stall (below); a send that bypasses `wake`, like the harness's direct RAM oracle, shows exactly that.
- **Every persist holds the guest awake.** `saveGameFileSystem()` in `game.js` calls `globalThis.holdGuestAwake`, which the service registers in `start()` and clears in `stop()` only if it is still its own (the update prompt in the main bundle cannot import a game-chunk service, and every persist meets in that one function); `PatchService` and `SaveGameService` call `dosCI.persist()` through `GuestAccessHelper.whileAwake`. A persist works on a paused guest, but a probe resuming it halfway was never run in this app. Flows that rewrite the saved disk, exit the emulator or leave (patch, import, resolution switch, restart, leaving) stop the service first; `stop()` resumes a sleeper.
- **Only the emulator, and its sound with it, is paused.** No `cycles`, stream or audio node is touched. `screenshot()`, `persist()` and `readMemory()` work on a paused guest, so the auto-saver, the exit watcher and the OCR keep looking and never wake it.
- **Never paused: a hosting browser, a hidden page, a boot.** Hosting (v1 is conservative: what a paused guest does to the encoder and to a spectator who joins meanwhile is unlooked-at; a room that starts while asleep wakes it on the next tick). Hidden: js-dos pauses and resumes the emulator itself on `visibilitychange`, so the service adds no pause, probe or `resume()` meanwhile (`apply` skips them) and `visible()` resets its belief to awake with the idle time restarted. Boot: nothing sleeps until the exit watcher or the page has seen the game's own screen, because DOS, Windows and the game load quietly.
- **Asleep needs all of: no frame for `IDLE_MS`, no input for `INPUT_QUIET_MS`, no blocker** (hosting, game not seen, a hold, keys queued, a finger or held button or pending motion in the touch layer; a blocker also counts as activity and wakes a sleeper). The input window guards the one thing a frame counter cannot see, a computation that starts with a tap. A caret blinking in a focused text field is a frame every ~0.55 s and keeps the guest awake for as long as it has focus.
- **Sleeping is a handshake: it asks `SaveSafetyService.gameSavingVerdict()` whether the game's "A gravar o jogo…" dialog is up, and only a definite `false` sleeps.** *Why:* a static dialog is what a slow save looks like to a frame counter, and a guest asleep mid-write is the truncated `.e98` the auto-saver waits for the dialog to close to avoid. `true` and `null` (no OCR, auto-save off, a failed or slower-than-`LOOK_TIMEOUT_MS` read) stay awake and are asked again after `LOOK_RETRY_MS`, a repeating `null` doubling up to `LOOK_RETRY_MAX_MS` (the page cannot tell, and it would otherwise ask and log once a second); an answer overtaken by a frame, input or blocker is dropped. So the feature is inert with auto-save off or no OCR, which the menu says.
- **Asleep, the policy is `probe`:** resume for `PROBE_MS` every `SLEEP_MS`, awake the moment a frame arrives, so work that never redraws still advances. `POLICY: 'hard'` never resumes by itself and is not enabled: it would freeze each silent computation until the next touch.
- **A frame from a guest that was asleep is a stall, and the machine learns:** idle and input-quiet times grow to twice the quiet stretch that ended, up to `MAX_IDLE_MS`, and are kept for the page's life (the service singleton keeps them across toggles; a reload starts from the constants), so the first stall on a slow phone costs one stretched computation, not one per round.
- **Log category `power`, and only the first probe of a sleep is written:** a still screen probes every ~2.25 s, which would fill the ring and rewrite its persisted tail.
- **Unverified:** any real phone (the Galaxy A07 pass is pending): how long Elifoot's silent computations last there, the probe's cost, iOS Safari's worker, a real hidden tab or screen lock, the real battery, and a sound that outlasts `IDLE_MS` with no frame (it is paused with the emulator). Every measurement so far is a desktop's.

## Full record (verbatim)

> Written phase by phase. Where it disagrees with the summary above or with the code, those win: later phases changed some earlier facts
> (for example, which root services keep a `DosCI`, and that two-peer sessions at 640x480 were later run).

DOSBox pins one core at about 100% even on a menu that never changes (measured: 101.9% of an Apple-silicon core on a still screen, and
lowering `cycles` changes nothing), and a manager game is mostly still menus, so on a phone that is battery and heat.
[`EmulatorPowerService`](../../src/app/core/services/game/emulator-power.service.ts) calls `dosCI.pause()` when the picture has been still long
enough and `resume()` the moment anything wants the guest. It is phase P9 (decision D6); the design record is
[docs/mobile-ux-study.md](../../docs/mobile-ux-study.md). The rule itself is [`IdlePowerMachine`](../../src/app/core/helpers/emulator-power.helper.ts)
(no clock, no timer, no emulator: every call carries the time), the numbers are `EMULATOR_POWER` in [constants.ts](../../src/app/core/models/constants.ts),
and everything outside the service reaches the guest through [`GuestAccessHelper`](../../src/app/core/helpers/guest-access.helper.ts).

**Off by default, and one constant from on.** The setting is `STORAGE_KEY.IDLE_PAUSE` ("Economizar bateria quando parado" in "Dados e avançado" > "Recursos experimentais"), stored as an explicit boolean so that changing `EMULATOR_POWER.DEFAULT_ENABLED` reaches only people who never touched the switch;
the window says it has not been tried on real phones, and the FAQ has an entry. *Why off:* the rule the roadmap proposed, asleep after 2 s
without a frame or an input, was played on real Elifoot rounds and it made the game's own computations **1.8 times slower on average and 2.7 in the worst round**, because
Elifoot spends whole seconds with the picture untouched while it works (on this desktop a 6 to 7.4 s stretch two seconds after the key that
starts a round, and a 9 to 10.3 s one 38 s after the last key, the end of the match) and a guest put to sleep in the middle of that runs the
rest at the probe's duty cycle (about a ninth of its speed). With the idle time at 20 s the saver never slept in play (0 sleeps in 20 ON rounds over four runs; the longest gap 10.3 s with the saver on and
the same with it off), and with the learning below it costs one stretched computation at most, but every number here is a desktop's: the
feature exists for a phone whose silent stretches are unmeasured, and a computation that outlasts the idle time on a slow phone is stretched
for as long as it takes to be seen once. The owner flips `DEFAULT_ENABLED` after the Galaxy A07 pass, or does not; the FAQ entry follows the constant (and `IDLE_MS`) by binding, but the
experimental group's "Ainda não foram testados em celulares de verdade" (`AdvancedMenuHelper`) is prose about that pass and is revised by hand in the same commit.

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
