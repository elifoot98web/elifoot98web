# Touch harness

Drives the real game in a headless Chrome, through the app's own touch layer, and grades it against the guest's RAM. It exists
because direct touch ([touch-input.service.ts](../../src/app/core/services/game/touch-input.service.ts)) is blind dead
reckoning: nothing in the app reads the cursor back, so the only way to know a tap landed where the finger was is to look at the
guest from outside. Every constant in `TOUCH_INPUT` ([constants.ts](../../src/app/core/models/constants.ts)) rests on a table
below, and **must be measured again after any change to the video mode, the Windows mouse settings (`WIN.INI`/`SYSTEM.INI`),
js-dos or the disk image**: the gain, the corner and the frame period are properties of the guest, not of the app.

No dependencies: node 22 has `fetch`, and Chrome is whatever is installed. Nothing in `scripts/` reaches the bundle.

## Running it

```bash
npm start -- --live-reload=false         # a dev server on :4200 (see trap 3); the harness needs a DEV build, it reads window.ng
node scripts/touch-harness/driver.mjs &  # one headless Chrome, on http://127.0.0.1:9444
export APP=http://localhost:4200/        # which dev server boot.mjs loads (not 127.0.0.1: see trap 10)
node scripts/touch-harness/boot.mjs acc android     # fresh boot, Android user agent, 390x844 (wipes the profile's site data)
node scripts/touch-harness/accuracy.mjs --spacings 18,20,24,32,40 --taps 8
```

`driver.mjs` takes extra Chrome switches from `CHROME_FLAGS` (space separated); a second browser for a room needs one (`room.mjs` says which). It uses `--remote-debugging-pipe` and serves the pipe over HTTP (`CDP_PORT`, default 9444), because the sandbox this was
written in lets node bind sockets but not Chrome. It picks `CHROME_BIN`, then a puppeteer `chrome-headless-shell`, then Chrome.
**Only the headless shell was exercised.** Screenshots and results go to `$TOUCH_HARNESS_OUT` (default
`$TMPDIR/elifoot-touch-harness`); `boot.mjs` and the scripts print what they read.

| Script | Question it answers |
| --- | --- |
| `boot.mjs [label] [android\|ios\|mac\|default] [w] [h] [dpr]` | Loads the app with a device emulated. The user agent is set BEFORE the page, because js-dos reads it once. |
| `gain.mjs` | The guest's relative-motion rules: gain, clip, wrap, homing, summing. |
| `spacing.mjs` | How close can two sends be before the guest sums them? |
| `homecheck.mjs` | Does a home always land on (0, 0)? |
| `accuracy.mjs` | How close does a tap land, per send spacing, over 18 distinct screens? |
| `drift.mjs` | Does the model drift over many taps with re-homing off? |
| `warpcheck.mjs` | Does Elifoot or Windows ever move the cursor when a window opens? |
| `gestures.mjs` | Palm, two fingers, cancel, tap, aim mode, double tap vs two slow taps, scrollbar thumb, trough. |
| `stuck-button.mjs` | Is the button released in every way a drag can end? |
| `ipad.mjs` | The Macintosh-user-agent iPad matrix, with the control that shows stock js-dos gives it no input. |
| `edge-cases.mjs` | The cases a review found: a second tap 40 ms after the first lifted (it used to be cancelled), a retry after a miss outside the picture, no home with the button held, a tap asking a suspended audio context to resume. |
| `idle-pause.mjs static\|hidden\|save\|wake\|inert\|ui\|season` | The battery saver ("Economizar bateria quando parado", `EmulatorPowerService`) on the real game; header of the script has the commands. `static`: CPU of the busiest renderer on a still screen, off, duty-cycle probe and hard pause. `hidden`: the page hidden and shown while the guest sleeps (the property is overridden and `visibilitychange` dispatched, because CDP delivers no lifecycle event; js-dos owns the hidden page). `save`: the first kickoff of a NEW game with the idle time cut to 150 ms, so the saver is asking while the game's save dialog is up. `wake`: input sent to a guest that is ASLEEP, graded as awake (taps against the RAM oracle with the engine's own idea of the cursor beside it, `CONTROL=1` for the awake baseline; arrows against the screen; a string of digits on the raw key events: one resume, before the first key, 10 ms between groups). `inert`: auto-save off, so the saver cannot tell whether the game is saving and must not sleep the guest; it asks less and less often and sleeps again when auto-save is back. `ui`: the menu entry through a real tap. `season`: plays Elifoot rounds like a person (Enter on every new screen, the injury and penalty pickers answered, the auction skipped), `MODE=off\|on\|alt` (alt flips the setting every round, so ON and OFF are compared inside one game), per round wall time, longest gap between frames, every gap over 2 s with the time since the last input, CPU, what the saver did and whether a pause landed on a loud sound. |
| `setting-ui.mjs [portrait\|landscape]` | "Modo de toque" through the real menu: offered, live, persisted, wiped, and it fits a 390 px phone. |
| `deck.mjs layout\|keys\|repeat\|scroll` | The control deck: the picture's box with the deck on, off and the sheet open at twenty viewports (the phones, the tablets and the short windows that once broke it), and for every panel in the presentation the page picked, each keycap's size, that no two overlap and that each is inside the viewport or reachable by scrolling; one real tap on each key that is safe to press and the codes the emulator received; a 1.5 s hold on Down (first repeat, interval, stop on release); in the scrolling sheet at 667x320, a held arrow through 40 px of vertical drift and a drag that starts on a landing key (types, no scroll) against one that starts on a release key (scrolls, types nothing). Run `keys` and `repeat` on Acerca or Registo: it never taps Enter, Esc or Sair. |
| `typebar.mjs walk\|layout\|ime\|hint\|moves` | The live type bar (experimental) on the real game. `walk` goes from the splash to the Jogadores dialog (the coach names) with the setting on. `layout`: the bar over twelve phones and tablets with a SIMULATED OS keyboard (`visualViewport.height` shrunk, the real `KeyboardInsetService` told): full window or one row, the bar's bottom on the keyboard's top, 44 px keys, no overlap, and the picture's rect unchanged with the bar open, folded and closed. `ime`: CDP `imeSetComposition` / `insertText` / `dispatchKeyEvent` into the bar, graded on the keys the emulator received (accents as Alt codes, a composition mirrored once at its end, the keyboard's trailing space held back, Backspace once and in an empty bar, Enter / Tab / Esc / F5 from the hardware path, an 80 character paste with progress and Cancelar). `hint`: a tap on a game field keeps the bar's focus and is seen as an I-beam, the Texto cue, and the caret's latency from a cold start (about 2 s). `moves`: the guest leaves the field the bar describes, read on the keys the emulator got and on the screen: a tap on the game (the bar is emptied and keeps the focus, the next word goes to the new field alone), a key the deck sends, a strip Tab and a strip Backspace in the middle of a composition (`imeSetComposition`: the word goes out first, the composition is ended, the focus stays), a pasted Tab (a space, no Tab) and closing the bar in the middle of an 80 character paste (the rest is cancelled and the player is told). **None of it is a real keyboard**; the device checklist is in the PR. |
| `stage.mjs layout\|rails` | The stage on the real page (CLAUDE.md, *The stage*). `layout`: at 19 windows (the phones and tablets of the earlier phases, a notch emulated with CDP's `Emulation.setSafeAreaInsetsOverride`), `#game-container` is the canvas to the pixel, the size and place the plan wrote and exactly 4:3, the rails are as wide as the plan says and beside the picture, and the picture's rect is IDENTICAL with the sheet open, the OS keyboard simulated (`visualViewport`) and as a browser that really shrinks its layout viewport to half with an `<input>` focused (landscape windows), the deck off and on and a room starting; it moves only for the chat and the view mode, and gets the old rect back; prints a table of the sizes, places and what the chat and Ampliar cost. `rails`: at 10 windows every control of a landscape phone's rails is 44x44 or more, none overlap, none is over the picture, all are inside the window or reachable by scrolling; one real tap on each safe key; a held arrow (first repeat, interval, nothing after the lift); the sheet opens beside the rail; a held arrow in a scrolling rail survives 40 px of drift; the room's pill (with and without the lock) has its dot, code and lock inside the capsule that is painted, at five windows. |
| `camera.mjs layout\|identical\|pinch\|accuracy\|radio\|overlay\|deck\|bar\|chat\|rotate\|power` | The in-app camera ("Zoom e movimento", `CameraService`, CLAUDE.md *The camera*) on the real page; the header of the script lists each mode. `layout`: at 12 windows and 1.5x, 2x and 3x the picture's box (`offset*`, the canvas's style) and the stage plan are what they were at the fit (js-dos is never asked to re-letterbox, not even when the clip grows into the band), the rectangle is the box times the scale at the place the camera says, the clip is on the screen and the taskbar below it, and at the fit there is no transform. `identical`: the camera off and on at the fit leave the root's attributes, its computed transform and every rectangle byte for byte equal. `pinch`: real two-finger CDP touches (a spread, a pan, a pinch in to the fit, a second finger cancelling a drag with no stuck button, a two-finger tap, a third finger, one finger lifting, a cancelled touch, two quick taps = a double CLICK and no zoom, fingers on the part of the clip the picture does not cover). `accuracy`: taps over the visible picture at 1x to 3x (in four places of the picture each), graded against the RAM oracle, the buttons swallowed. `radio`: a real click on a 12 px radio, missed at the fit and hit at 2x by the same finger. `overlay`: hosting without a peer, a spectator's cursor lands on its canvas fraction at every zoom; the `captureStream` is the whole 640x480 frame, equal to the framebuffer, and over a same-page WebRTC pair too. `deck`: real taps on the Zoom tab and its keys, the band folding and coming back, the pad and its hold, the options-menu switch. `bar` and `chat`: the live type bar and the chat while zoomed. `rotate`: one camera per orientation. `power`: the battery saver wakes on a pinch and on the buttons. |
| `room.mjs host [CODE]`, `room.mjs join <port> [CODE]` | A room between two browsers, for the modes below: `host` starts one on the booted game page; `join` drives a SECOND driver (own profile and port, both started with `CHROME_FLAGS='--disable-features=WebRtcHideLocalIpsWithMdns'`) through the room dialog as a spectator. Use a NEW code each run (see the header). |
| `stage.mjs guest\|room\|leave <port>` | With a spectator in the room: `guest`, the spectator's picture against the host's at 9 windows (same size to 1 px, same place, `#stream-target` equal to the stage, the cursor overlay on the picture, the toolbar dropped on a landscape phone); `room`, a remote cursor lands where the guest pointed, the chat both ways from the rail's key and the floating tab with each picture's box before, during and after; `leave`, the spectator's rail (Sala, Sair, the reload) and the host's roster. |

`oracle.js` (injected by `nav.mjs`), `nav.mjs` (taps, keys, screenshots), `measure.mjs` and `tour.mjs` are the parts the scripts share.

## The oracle

Windows 3.1 keeps the cursor as two `uint16`s in guest RAM. `oracle.js` reads them with `dosCI.readMemory`, so a script can ask the
guest where the cursor really is. **It is verify-then-scan, and nothing trusts the address:** `calibrate()` takes the two
hint addresses (`0x45c12`, `0x5eaae`, which were the same after a reboot, on every screen and at both video modes), nudges the
cursor by +-20 units and checks the value moved by exactly 40, and scans all 8 MB for the pair that read (0,0), (120,80), (360,260) at
three known positions if neither hint holds (~1.5 s). At 640x480 both hints verified, and the scan found them again (plus a third
hit in the heap, which moves per boot). The app itself reads no memory: that is the point of the blind engine, and it also keeps it
out of the way of the Cheat 'O Matic, which rejects concurrent reads.

## What was measured (640x480, headless Chrome 143 on Apple silicon, 2026-10-28)

**Everything here is synthetic input on a desktop CPU. No finger, no phone, no iOS.** The guest was the shipped bundle, and the
numbers are the guest's, which does not care what the host is, except for one: the worker that runs the emulator on a phone is
slower, and nothing below says how slow (see the device checklist in the PR).

### The guest's relative-motion rules (`gain.mjs`)

| Rule | Measured |
| --- | --- |
| Gain, per axis | 1 px per unit for 1 and 2 units; 2 px per unit from 3 (`d` = 3, 4, 5, 8, 100, 200 gave 6, 8, 10, 16, 200, 400). The axes do not influence each other: (1, 100) moved 1 and 200, (3, 2) moved 6 and 2. |
| Clip | The frame, [0, 639] x [0, 479]: `d` = 240 gave x 480 and y 479. |
| Wrap | A single positive event of 256 units or more wraps modulo 256: 256 gave 0, 257 gave 1, 300 gave 88, 350 gave 188. 255 gave 510. |
| Big negative | -200 and -255 clip into the corner; -300 gave (212, 132) and -400 (12, 0) (they wrap too); a single -2000 gave (0, 0) once and is unproven across boots. |
| Home | Four sends of (-200, -200), 24 ms apart, from 60 random starts: (0, 0) 60 times of 60 (`homecheck.mjs`). |
| A 2 px quantum | Now and then a send lands 2 px further than the rules say, on one axis: (50, 50) gave (100, 102), (150, 150) gave (302, 302), (1, 200) gave y 402. Always one mickey at the 2x gain, at every gap (96 ms included), and it comes and goes instead of accumulating. This is why a tap is graded against 3 px and not 1. |

### The frame period (`spacing.mjs`)

The guest sums the units of sends that arrive close together and only then applies the gain: a pair of 2-unit sends is 1x each, but
summed it is 4 units and moves 8 px. Pair (2, 0) then (2, 0), 40 repetitions per gap: summed they move 8 px instead of 4, an error of "4,0".

| Gap between the two sends | 14 ms | 16 ms | 18 ms | 20 ms | 22 ms | 24 ms | 28 ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Summed (error 4,0) | 40 of 40 | 11 of 40 | 0 | 0 | 0 | 0 | 0 |

The boundary is the frame (~16.7 ms). Sends in one JS tick are summed outright, and then the wrap applies to the sum: four sends of
(70, 0) in one tick moved 48 or 50 px instead of 560 (280 units wrap), and 6 sends of (2, 2) in one tick moved 24 instead of 12. The wrap needs the
same tick: 2 ms apart the four (70, 0) were exact, whereas the small sends stayed summed up to 14 ms (6 x (2, 2) moved 22, 20, 20, 16 at 2, 4, 8, 12 ms
and 12, exact, from 16 ms). The engine counts the gap from the previous send's real time, so a late timer widens it and never narrows it.

### The tap itself (`accuracy.mjs`): 18 screens, 8 seeded taps each, graded after every tap

Screens: Acerca, new/continue, country list, currency, the manager's name, the draw, the main window and its five tabs, two menus
(Elifoot, Campeonato) and five modals (Opções, Estádio, Historial, Melhores marcadores, Calendário). 144 taps, 288 axis readings
per spacing. "Against the finger" is where the cursor was against where the tap was; "the model" is the engine's own idea.

| Spacing | Against the finger: 0 / 1 / 2 / 3 px | Worst | The model off by 2 px | Runs of 18 with that | Click after lift (median) |
| --- | --- | --- | --- | --- | --- |
| 16 ms | 232 / 34 / 20 / 2 | **3** | 23 of 288 | 4 | 0.1 ms |
| 18 ms | 244 / 36 / 8 / 0 | 2 | 9 | 3 | 0.1 ms |
| 20 ms | 248 / 36 / 4 / 0 | 2 | 5 | 2 | 0.1 ms |
| **24 ms** | 245 / 36 / 7 / 0 | 2 | 8 | 2 | 0.1 ms |
| 32 ms | 243 / 36 / 9 / 0 | 2 | 11 | 2 | 0.1 ms |
| 40 ms | 251 / 36 / 1 / 0 | 2 | 1 | 1 | **9.2 ms** |

Every spacing stayed within 3 px on every screen, and all clicks were exactly one down and one up. The click comes ~0.1 ms after
the finger lifts, because the cursor is already there: the engine walks it during the touch. At 40 ms the click waits for the last
send's spacing to run out (9 ms, 14 at the 95th percentile), which is the whole cost of a longer spacing.

**24 ms was chosen, which is not the smallest.** 18 ms already passes, and 16 ms passes the 3 px test too, but 16 ms is the spacing
that sums sends (11 of 40 small pairs above; and in the (90, -90) then (2, -77) pair of `spacing.mjs`, 16 of 24 repetitions at 16 ms
ended 182 to 564 px off), so that pass is luck of a workload made of long moves. 24 is the measured boundary (16-18 ms) plus 7 ms,
because the only thing the extra margin costs is latency nobody can perceive, and the emulator on a phone is unmeasured. If the
device pass shows summed sends, raise `TOUCH_INPUT.SEND_SPACING_MS` first.

### Other results

- **Drift** (`drift.mjs`, re-homing off, 24 ms): 160 taps at random places and 250 short random-walk taps, model error 0 on every one.
  The 2 px quantum is the only thing that moves it, and it does not accumulate. The idle re-home (more than 12 moves and 900 ms of quiet)
  exists for what the model cannot see, not for drift.
- **No warp** (`warpcheck.mjs`): after each of 12 menus, tabs and modals opened, the guest's cursor was exactly where the model had it. Not reached: the loan and auction
  prompts, the live match's dialogs, any flag editor.
- **Gestures** (`gestures.mjs`, `stuck-button.mjs`): a palm, a second finger and a cancelled touch click nothing; a tap clicks once; aim mode
  puts the cursor on a 6 px radio from a finger 56 px below it and the release selects it; a double tap on a list row clicks twice
  at one position and the row stays selected, two taps 900 ms apart toggle it on and off (a real `WM_LBUTTONDBLCLK`); dragging the
  16 px scrollbar thumb scrolls the list and releases; a tap in the trough pages it. The button was released after `pointercancel`, a
  second finger, blur, pagehide, a `touchend` without a `pointerup`, `visibilitychange`, `freeze` and a detach.
- **Scrolling with keys does not work**: in the country list Home, Down x3, PageDown and Up took the selected-teams counter from 20 to 25, 38,
  40 and 43, because the keys select as they move, so mapping a two-finger drag to Up/Down would break the selection. The thumb and the
  trough are the scroll gestures.
- **Edge cases** (`edge-cases.mjs`): a second tap 40 ms after the first lifted gives two clicks (the 80 ms lost-pointerup check used to cancel it);
  in landscape, a tap in the strip beside the picture followed 120 ms later by one inside it clicks once, under the second finger (it used to
  click again where the cursor had been left); a 12-move drag with the send budget forced down to 4 sends no home between the button going down
  and up (14 motion sends, 0 homes); and a tap calls `resume()` on a suspended `AudioContext`. The state after the call is printed, not
  graded: this headless shell resumed a context once per boot and left every later `resume()` pending.
- **The Macintosh-user-agent iPad** (`ipad.mjs`, Chromium emulation): js-dos binds `mousedown`, the layer is attached, a tap clicks without a
  pointer-lock request, a real mouse still reaches js-dos, the setting is not offered, and with the layer off a tap sends the guest nothing.

## Traps that silently invalidate a run

1. **The guest sometimes stays at the DOS prompt.** In about 3 boots of ~35 the screen stayed at `C:\>D:\ELIFOOT.BAT` with Windows never
   starting (a black 640x400 frame; after the 45 s detection window "O jogo ainda está iniciando…" appears and the page is "up" anyway).
   Two of them came after minutes of play in the same profile (a persisted layer, written by the 5-minute forced periodic save since OCR
   cannot load in the sandbox, is the first suspect); the third came with the site data wiped, right after a stuck-button run. Not
   understood, and it happens before any touch code runs. `boot.mjs` wipes the site data (`KEEP=1` keeps it) and retries up to three times
   until the frame is a graphics mode; a run on a guest that never reached Windows measures nothing, though `ipad.mjs` and
   `stuck-button.mjs` would still pass on one (they test routing and button events, not the screen).
2. **The scripts drive `window.ng`**, the dev-mode debug API, and reach private members of the app (`touchInputService['session']`) to
   retune and to invalidate the model. They will not work against a production build.
3. **A source edit reloads the page** under `ng serve`, in the middle of a run (it killed a sweep once). Serve with `--live-reload=false`.
4. **A covered window is a broken window** (the multiplayer harness's trap 1 applies): the driver passes the flags that stop timer
   throttling, and a spacing measurement is meaningless on a throttled page.
5. **`gain.mjs`, `spacing.mjs` and `homecheck.mjs` detach the touch layer** to drive `dosCI` themselves, and put it back at the end; a script that
   dies in between leaves it off (`__g.applyTouchMode()` in the page restores it). They also invalidate the layer's model, so the next tap homes.
6. **CDP's `Page.setWebLifecycleState` delivers nothing here** (not even `blur`), so a real background/foreground switch cannot be reproduced; the
   lifecycle events are dispatched by hand, and the real thing is on the device checklist.
7. **Enter closes Elifoot's dialogs, Esc closes its menus, and Esc does not close a dialog.** The tour relies on that; a step that leaves a
   modal open makes every later step click inside it.
8. **Ionic moves `aria-label` from the `ion-button` host to the inner `<button>`**, so `ion-button[aria-label=...]` finds nothing.
9. **The oracle's address can differ between boots** (the first hint failed verification once and the second took over); always
   `calibrate()`, never hard-code.
10. **`ng serve` listens on `localhost`, which can be `[::1]` only**, so `http://127.0.0.1:PORT/` is refused while `http://localhost:PORT/` works
   (Chrome tries both). `boot.mjs` defaults to `localhost`; the driver's own port is the one that is `127.0.0.1`, because node binds that.
11. **The oracle talks to the guest directly, so it does not wake it.** With the battery saver on, `calibrate()` and `home()` send mouse
   motion to a guest that is asleep, where it waits for the next probe (and the probe sees a frame, which the saver reads as a stall and answers
   by raising its idle time). `idle-pause.mjs` calibrates with the saver off. The service is a root singleton and `retune()` changes it for the
   page, not for a run: every mode starts from `EmulatorPowerService.defaults()` and gives them back (a retuned 1.5 s idle time left over from a
   scratch script once turned a "20 s" season into a 1.5 s one).

12. **A fresh profile on a portrait phone shows the "Gire o aparelho" toast (P14), which covers the toolbar** for several seconds: a tap on the options button right after `boot.mjs` lands on the toast, and the popover does not open. `setting-ui.mjs` and `camera.mjs` dismiss it first.
13. **The options button is the slot's own `ion-button`** (`ion-buttons[slot="end"] > ion-button`). The save chip (P5) and the sound chip (P14) hold `ion-button`s of their own earlier in the same slot, and a tap on the first of those saves the game.
14. **A WebGL canvas reads back transparent.** js-dos's context has `preserveDrawingBuffer: false`, so `drawImage(canvas)` outside the paint (a harness call) is blank. Compare a stream, or anything else, against `dosCI.screenshot()`, the framebuffer, and never against the canvas (`camera.mjs overlay`). A `<video>` that is not in the document decodes nothing in the headless shell either: attach it, off screen.
15. **The sandbox that built the camera could not resolve the public signalling relays from Chrome** (`ERR_NAME_NOT_RESOLVED` for `chorus.pjv.me`, while node reached `relay.damus.io`), so `room.mjs join` failed twice with state 6 and no real spectator was ever connected. Hosting itself needs no peer, and the stream is checked over a WebRTC pair inside the host's page instead.

## What it does not cover

A finger, and above all two. `camera.mjs` pinches with synthetic touches whose paths are perfectly straight and whose fingers move in lockstep; a real pinch has uneven fingers, a slope between them and a thumb that rolls, and the dead band, the pace of the steps and the feel of the pan are untested where they matter. Also not covered: any WebKit (a transform on a WebGL canvas, `gesturestart`, edge-swipe Back, the installed app). Real fingers err by about 25-40 css px (recalled, not measured), so the thresholds (10 px slop, 450 ms hold, 56 px aim offset,
400 ms / 32 px double tap) are untested where they matter. Also not covered: iOS Safari in any form, a phone's CPU (CDP throttling does
not slow the emulator's worker), the real lifecycle, a hosting phone with a spectator, and the live-match and auction dialogs.
