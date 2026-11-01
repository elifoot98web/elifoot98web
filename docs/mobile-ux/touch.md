# Touching the guest (direct touch)

> Design record for this area, moved out of `CLAUDE.md` (2026-10-30/31). The first section is the VERIFIED summary of the
> invariants (each checked against the code at the time by an independent pass); the second is the verbatim record written phase
> by phase while the area was built. The plan and the as-built history are in [../mobile-ux-study.md](../mobile-ux-study.md); what only
> real phones can confirm is in [../mobile-ux-device-pass.md](../mobile-ux-device-pass.md).

## Invariants (verified summary)

A tap lands where the finger is. js-dos cannot do that against this guest: its pointer binding is a user-agent test (`/iPhone|iPad|iPod|Android/` gets a touchpad, anything else gets desktop pointer lock, under which a touch does nothing; a default-UA iPad reports a Mac) and its absolute mode lands 150-350 px off. So [touch-input.service.ts](../../src/app/core/services/game/touch-input.service.ts) (`TouchInputService`, `attach()`/`detach()`; `clicks$` says where each click it sent landed) takes the finger before js-dos sees it and drives the guest's mouse with relative motion through [gesture-recognizer.helper.ts](../../src/app/core/helpers/gesture-recognizer.helper.ts) (samples in, intents out, no timer, no DOM: the hold is a `deadline` the caller schedules), [guest-pointer.helper.ts](../../src/app/core/helpers/guest-pointer.helper.ts) (`GuestPointerMath`, the guest's rules as pure functions; `GuestPointer`, a serial queue that needs only `DosCI` and a clock), [touch-mode.helper.ts](../../src/app/core/helpers/touch-mode.helper.ts) (the setting, pure) and [touch-feedback.helper.ts](../../src/app/core/helpers/touch-feedback.helper.ts) (the ring). Every tunable is in `TOUCH_INPUT`.

Load-bearing invariants — each of these was a bug, or a measured trap:

- **The guest's rules are measured, and they are `GuestPointerMath`'s contract.** Per axis 1 px per unit for an event of 1 or 2 units, 2 px per unit from 3; clipped to the frame; a single positive event of 256 units or more wraps modulo 256 (a big negative one does something else again), so nothing over `MAX_SEND_UNITS` is sent and a chunk is at most `MAX_CHUNK_UNITS` (two summed chunks must stay under the 256 that wraps); `HOME_SENDS` sends of `HOME_UNITS` clip into (0, 0), the one position the model knows. Measured at 640x480 with the RAM oracle in [scripts/touch-harness/](../../scripts/touch-harness/README.md): **re-measure after any change to the video mode, the Windows mouse settings, js-dos or the disk image**, because nothing in the app reads the cursor back and a change shows up only as taps that miss.
- **Blind dead reckoning, no `readMemory`.** The model adds exactly what the guest applies and clips as it does, after homing. *Why:* the oracle couples to addresses that may move, and `readMemory` rejects concurrent calls, which the Cheat 'O Matic would hit; it is a harness tool only.
- **One motion send per frame, never two in a tick: `SEND_SPACING_MS`, counted from the previous send's real time (a late timer only widens the gap) and also between the last send and a button event.** *Why:* the guest sums sends that arrive within a frame (~16.7 ms) and applies the gain to the sum, so two 2-unit sends move 8 px, not 4, and sends in one tick are summed before the wrap. 24 ms is the boundary plus margin, not the smallest passing value; if a phone's slower emulator shows summed sends, raise it first.
- **The guest has a 2 px quantum:** now and then a send lands 2 px further on one axis, at any gap, and it does not accumulate. A tap is graded against 3 px, not 1. Elifoot and Windows do not warp the cursor when a menu, tab or modal opens (not checked: the loan and auction prompts and the live match's dialogs).
- **The listeners are on `layers.root`, or on the clip around it (`TouchSurface.stage`, `.game-stream-container`, which `GamePage` always gives), in the capture phase, chosen by `pointerType` (`touch`, `pen`), never by user agent.** They `stopPropagation()` for touches aimed at js-dos's overlay, its canvas or the clip itself, so js-dos's own handlers never see a finger; the clip is there because the camera's tall view has parts of it that are not the picture (*The camera*). **Nothing a finger has to reach may be put inside the clip.** A real mouse and js-dos's own controls are not touched (desktop pointer lock, a hybrid laptop, an iPad with a mouse behave as before; the control deck is outside the root). `layers.pointerDisabled` was rejected: it disables the mouse path too. Touch events and `gesturestart` are cancelled as well; js-dos's sheet already gives `.emulator-root` `touch-action: none`, and `#game-container` adds `overscroll-behavior: none` so a drag never chains into pull-to-refresh.
- **A mouse event within `COMPAT_MOUSE_WINDOW_MS` of a touch is the browser's copy of it and is dropped.** *Why:* on a default-UA iPad js-dos answers a stray `mousedown` with a pointer lock. **A real mouse makes the model forget the cursor** (`invalidate()`): on a hybrid device both move one guest cursor and the engine only knows what it sent, so the next touch re-homes.
- **Every finger moves the focus to `layers.root`, unless `TouchSurface.keepFocus` says a page text field keeps it (the live type bar).** *Why:* cancelling the touch cancels the browser's focus change and js-dos reads the keyboard from that element, so a hardware keyboard on an iPad would stop reaching the game; but taking it would close the OS keyboard over the field being tapped. Page px reach the guest through the canvas's own `getBoundingClientRect` (`ViewportTransform.clientToGuest`), so the letterbox and the camera's zoom and pan are one formula.
- **Every way a gesture can end releases the button, synchronously: `GuestPointer.abort()`.** It drops the queue and bumps an epoch so an op in flight stands down (a late timer must not press or release for a cancelled gesture). It runs on the recognizer's cancel, `pointercancel`, a `touchend` with no `pointerup` (checked 80 ms later, and called off by any finger that lands in between, or a fast second tap is lost), any `visibilitychange`, `freeze`, `blur`, `pagehide`, a finger silent for `GESTURE_STALL_MS`, and `detach()`. *Why:* a hidden page's timers are throttled or frozen, so the release cannot wait for one, and a stuck button drags what is under the cursor. A press whose position is lost (the frame changed, a real mouse moved the cursor) is released, never homed (a home with the button down drags what is under the cursor to the corner). A real background/foreground switch could not be reproduced (CDP delivers no lifecycle event).
- **The click is at release, at the point where the finger landed** (the cursor was sent there at touch-down, `preAim`). *Why:* that is what lets a second finger cancel a touch before anything happened.
- **A double tap is a real `WM_LBUTTONDBLCLK`:** a second tap within `DOUBLE_TAP_MS` and `DOUBLE_TAP_SLOP_PX` clicks again without moving the cursor, and its touch-down says `preAim: false`, because re-aiming at a finger that landed 20 px away could leave Windows' double-click rectangle. A tap that clicked nothing (outside the picture) is taken back with `forgetTap()`, or the retry would click wherever the cursor was last left. **Known risk:** two quick taps on adjacent list rows read as a double tap on the first; the thresholds are one line each in `TOUCH_INPUT`. There is no double-tap zoom, for the same reason.
- **A drag presses where the finger landed** (past `TAP_SLOP_PX` before `HOLD_MS`), follows at the engine's pace (latest target wins) and releases where it lifted. **Holding still `HOLD_MS` is aim mode:** the cursor is parked `AIM_OFFSET_PX` above the finger (the sprite is smaller than a fingertip), follows it, and the click is at release; `HOLD_MODE: 'none'` turns it into a slow tap.
- **A second finger cancels the gesture and the touch stays dead until every finger is up.** The cancel is this layer's and comes first (the press is released before a pinch starts); what two fingers mean is the camera's (`CameraGesture`, fed the same samples; with the camera off they mean nothing). A palm (contact radius over `PALM_RADIUS_PX`) is ignored outright. No right click: no tested Elifoot screen reacts to one.
- **Scrolling is the scrollbar** (drag the thumb, tap the trough). Mapping a drag to Up/Down was rejected: in the country list the arrow and page keys SELECT as they move.
- **A move is one op whose target is replaced while it runs, and `GuestPointerMath.isSendable` refuses anything that is not a whole number in range.** *Why:* a NaN poisons the guest's mouse until the page reloads.
- **Re-homing is rare and in place.** *Why:* the cursor is part of the stream spectators watch, so a re-home flings it to the corner. It happens only after `IDLE_REHOME_MS` of quiet and more than `REHOME_AFTER_MOVES` moves, or on a frame-size change, `invalidate()` or the `FORCED_REHOME_SENDS` safety net, and the cursor walks back to where it was, as an ordinary move a landing finger redirects. **Never while a finger is down** (aim mode looks idle to the engine; the layer says otherwise with `setFingerDown()`) **and never with the button held** (the budget waits for the release). It also homes once on attach, only where `any-pointer: coarse` (on a plain desktop it would move the guest's cursor for nothing).
- **A lifted finger wakes the game's audio:** `pointerup` and `touchend` of a handled touch call `resume()` on `getDosAudioNode()`'s context when it is not running. *Why:* js-dos wakes its `AudioContext` from a document-level one-shot `click`/`touchstart`/`keydown`, which this layer stops, so on iOS the game (and a hosting phone's stream) would stay silent.
- **The tap ring is DOM on the host, never pixels in the guest's frame:** `.touch-feedback` nodes in `#game-container`, absolute, `pointer-events: none`, transform and opacity only. *Why:* spectators' stream and every `dosCI.screenshot()` scraper must not see them, and a resize makes js-dos re-letterbox. Neutral look, not Win9x; it fades under `prefers-reduced-motion`.
- **The engine wakes a sleeping guest before every send** (`GuestPointerOptions.beforeSend`, from `TouchSurface.beforeSend`, which the page wires to `EmulatorPowerService.wake('touch')`). *Why:* its timers keep sending after the finger has gone, and motion that reaches a paused guest is applied in one go on resume, so the model is off by hundreds of pixels. `TouchInputService.busy` is one of the things that keep the guest awake.
- **The layer runs outside Angular's zone** (pointer events arrive at the display rate), holds the emulator only between `attach()` and `detach()` (`GamePage.ngOnDestroy`, "Voltar ao menu" and a switch to classic detach), and sends no keys: all keys go through the key queue.
- **"Modo de toque": Direto (default) | Touchpad (clássico)** (`STORAGE_KEY.TOUCH_MODE`, cleared by "Apagar todos os dados"). Classic means the layer is not installed, so stock js-dos takes the finger; it switches live. **Classic is only real where js-dos itself calls the device a phone** (`TouchModeHelper.stockTouchWorks`, a copy of its test): on a default-UA iPad or a phone asking for its desktop site it would be a dead screen, so `effective()` turns a stored `classic` into `direct` there and the entry is not offered (it needs `(pointer: coarse)`, `touchModeChoice$`); the layer itself is installed everywhere, because it reacts only to fingers and pens. An unreadable stored choice is `direct`.
- **Still unverified:** everything above was checked with synthetic touches in headless Chromium on a desktop CPU; the gesture thresholds are recalled, not tuned on a finger, and iOS Safari, a phone emulator's speed (sums sends?), the real app lifecycle and a hosting phone with a spectator watching the cursor await the Galaxy A07 / iPhone 15 Pro Max passes ([docs/mobile-ux-device-pass.md](../../docs/mobile-ux-device-pass.md)).

## Full record (verbatim)

> Written phase by phase. Where it disagrees with the summary above or with the code, those win: later phases changed some earlier facts
> (for example, which root services keep a `DosCI`, and that two-peer sessions at 640x480 were later run).

A tap lands where the finger is. js-dos cannot do that against this guest: it treats a user agent that matches
`/iPhone|iPad|iPod|Android/` as a phone and gives it a touchpad (a tap clicks at the OLD cursor position, a swipe moves
the cursor two guest pixels per unit, no drag), gives anything else the desktop pointer-lock path, under which a touch
does NOTHING (a default-UA iPad reports a Mac, so it is the second case), and its absolute mode lands 150-350 px off
(DOSBox keeps its int33 range at 640x200 and Windows 3.1 consumes mickey deltas). So
[touch-input.service.ts](../../src/app/core/services/game/touch-input.service.ts) takes the finger over before js-dos sees it
and wires four helpers together, the first two of them testable without a DOM:

- [gesture-recognizer.helper.ts](../../src/app/core/helpers/gesture-recognizer.helper.ts): samples in, intents out, no timer
  and no DOM (the hold is a `deadline` the caller schedules and answers with `advance()`).
- [guest-pointer.helper.ts](../../src/app/core/helpers/guest-pointer.helper.ts): the engine, `GuestPointerMath` (the guest's
  rules as plain functions) and `GuestPointer` (a serial queue that drives the guest's mouse, with a clock it is
  handed). Depends on nothing but the `DosCI` interface.
- [touch-mode.helper.ts](../../src/app/core/helpers/touch-mode.helper.ts): the setting, and what the device can run (pure).
- [touch-feedback.helper.ts](../../src/app/core/helpers/touch-feedback.helper.ts): the ring (DOM, see below).

**The guest's rules, measured with the RAM oracle in [scripts/touch-harness/](../../scripts/touch-harness/README.md) at
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
the entry is not offered. It is offered only under `(pointer: coarse)` (the options menu, `touchModeChoice$`); the layer
itself is installed everywhere, because it only reacts to fingers and pens.

**Verified only in headless Chromium with synthetic touches on a desktop CPU.** Real fingers err by 25-40 css px
(recalled), so the thresholds are untested where they matter; iOS Safari (compat events, `touch-action`, edge swipes,
pull-to-refresh, callouts), a phone's emulator speed (which could sum sends the desktop never did), the real lifecycle
and a hosting phone with a spectator watching the cursor are not. The PR carries the device checklist.
