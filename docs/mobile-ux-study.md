# Mobile UX study

Investigation record for the mobile/touch UX refactor. Written 2026-10-27 from seven
parallel investigations (baseline capture, resolution, touch, text entry, layout, shell audit,
platform), a synthesis and a completeness critique. **Nothing in this document is implemented.**
The raw reports (about 100 findings, with ids such as `BASE-3`, `TOUCH-8`, `RES-3`) are in
`ux-research-2026-10-27/investigation-result.json`, next to the repo, together with the working
prototypes and the CDP harness scripts. They are not in git.

## How much of this is verified

Everything measured here was **headless Chromium with synthetic input on a desktop CPU**.
iOS Safari, real fingers, real IME behaviour, real phone CPU and the spectator page at phone
sizes were **not** exercised. Every claim touching them is recalled, not observed, and the
phases that depend on them are gated on a device pass (decision D9).

## What is actually wrong

| Pain point | Root cause (measured) |
|---|---|
| Touchpad pointer | The bundle has `autolock=true` and js-dos treats UAs matching `iPhone\|iPad\|iPod\|Android` as mobile, so touch becomes `mouse-swipe`: a tap sends a click at the **old** cursor position, a swipe moves the cursor 2 guest px per unit, a 3-8 px finger drift moves the cursor 12-32 guest px before clicking. No drag, no right-click. The cursor sprite is ~6x10 css px, hidden under a fingertip. |
| iPad | With the default iPadOS user agent (`Macintosh`) js-dos takes the desktop pointer-lock path and touch produces **no input at all** (Chromium emulation; real Safari untested). |
| Typing | `simulateKeyPress` stamps its release 16 ms in the future; two calls closer than that **permanently wedge the guest keyboard** (5 of 5 repros). Non-ASCII becomes a space. The only app call sites are `emulator-control.service.ts:19-25`. |
| Small text | The framebuffer is 800x600, so the scale is 0.45-0.52 css px per guest px in portrait phones and 0.60-0.69 in landscape. The game's smallest labels are ~5-6 px effective (portrait) against a 12 px floor. The picture uses only 34-42% of a portrait phone. |
| Letterbox | Elifoot's window is ~634x474 inside the 800x600 frame, not maximised; its design size is 640x480. |
| FABs | 40 px, three clusters that collide with each other, the header and the chat; F1 is off-screen on small portrait phones; the js-dos keyboard covers 60-68% of the portrait picture with 19 px keys; the same action lives in 3-4 places. |

Beyond the brief: auto-save dies silently (the OCR loop stops on its first exception and loads
tesseract from a CDN); the update prompt reloads **without saving** (`app.component.ts:86`);
the 15 s boot deadline includes the 6.7 MB download and leads to a reload loop and a wipe offer;
the backup zip cannot be re-imported; the offline PWA is missing `wdosbox.js`; the emulator pins
a core at ~100% even on a static screen; sub-44 px targets, 2.2-4.1:1 contrast, unlabeled icon
buttons, English error strings, an eager YouTube iframe that overflows phones.

## Facts any design must respect

- **js-dos absolute mode is unusable here.** `setAutolock(false)` / `sendMouseMotion` lands
  150-350 guest px off (four independent measurements): DOSBox keeps int33 at 640x200 and
  Windows 3.1 consumes mickeys. Relative motion is exact only if chunked and paced:
  `|d| <= 2` applies 1x, `>= 3` applies 2x, a single positive event of 256+ wraps mod 256, and
  back-to-back sends coalesce into one callback. Rule: **one send per frame, never two in a tick.**
- **Blind dead reckoning** (home with four `relative(-200,-200)`, then chunked moves of <= 90-100
  units) was accurate to <= 3 px over 40 taps. Reading the cursor from guest RAM was exact but
  couples to addresses that may shift; it is deferred.
- **Accents work through Alt+0nnn** on the numeric keypad (verified in Notepad and in Elifoot's
  own coach-name fields: "João Silva", "André Açores"). NFD stripping is rejected.
- **Do not change the bundle URL.** The js-dos changes layer is keyed by `bundleURL + '.changes'`
  and `patch.service.ts:178` hardcodes it. A new URL orphans every saved game. So: no blob URLs
  for progress, no renaming the bundle.
- **Do not edit `SYSTEM.INI` inside `hdd.img`.** Every persisted layer carries its own full
  `hdd.img` copy and shadows the bundle's. A `dosbox.conf [autoexec]` step that copies an INI
  from `d/` reached users with stale layers and users with PatchService-patched batch files.
- **A CSS transform on `#game-container` does not break `OverlaySyncHelper`** (1.25 px error at
  2.5x, Chromium only): it reads untransformed `offset*` of two nodes that scale together. WebKit
  is untested.
- **Elifoot is Delphi 1** (46 `TPF0` forms, `BIVBX11.DLL`), not VB3. The largest client area is
  632x453, so no static form exceeds 640x480. Runtime-created windows were not checked.
- At 640x480 the Elifoot window fills the frame and hides the green backdrop, so the four
  load-detection pixels read UI during normal play. They still pass at boot only because the
  splash sits on the backdrop. "Green lost" becomes the normal state at 640x480.
- The OCR rectangle is 800x600-anchored; make it centre-relative (`left = W/2-68`,
  `top = H/2-25`, 132x20) which is bit-identical at 800x600 and `(252,215)` at 640x480.

## Decisions for the owner

### Resolved 2026-10-27

- **D1 — yes.** Direct tap-to-click is the default; the stock touchpad stays as the opt-in
  "Modo touchpad (clássico)".
- **D2 — one-size-fits-all 640x480**, with the `use800.flg` switch built into the same bundle and a
  "Resolução do jogo" toggle so desktop users can go back to 800x600. A per-device default was
  rejected: the guest needs the mode set *before* it boots, so it costs either a one-time reload on
  first visit or a patch between `Dos()` and `run()` in `game.js`. The `dosbox.conf [autoexec]`
  route (not an `hdd.img` edit) is the one that reaches users with an old persisted layer; the
  upgrade path (old layer, then the new bundle) must be re-tested before the bundle is committed.
- **D3 — Win9x look** for the dock and the type bar; flat shell for toolbar, save chip, menu
  sheet and install banner.
- **D8 —** `*` opens the player search for the "craque/estrela" attribute; `-` is used to enter
  the serial registration key. Label them accordingly in "Mais teclas".
- **D9 — yes**, real-device pass on a Galaxy A07 (low-end Android) and an iPhone 15 Pro Max.
  P2, P8 and P11 stay behind settings until that pass.
- D4-D7 and D10-D14 were not answered; the recommendations below stand as defaults.

### Original questions and recommendations

Each has a recommendation so work can continue.

| # | Question | Recommendation |
|---|---|---|
| D1 | Default touch model | **Direct tap-to-click**, with the stock touchpad as an opt-in "Modo touchpad (clássico)" that doubles as the kill-switch. |
| D2 | Guest resolution | **640x480 for everyone**, with a `d:\res\use800.flg` switch built into the same bundle so a later toggle needs no second LFS change. Note: the canvas box is the same size, so the game window fills it (1.25x more magnification) — text is **larger but softer** on desktop. |
| D3 | Skin of the new input chrome | **Win9x** for dock and type bar (it acts as the machine's keyboard and shares the band with the Win9x chat); flat shell for toolbar, save chip, menu sheet, install banner. Build keycaps with one skin class so it is a CSS-only flip. CLAUDE.md's scope rule is silent on docks. |
| D4 | Orientation | Hint only ("Gire o aparelho") plus a "Tela cheia" button. iPhone Safari supports neither fullscreen nor orientation lock. |
| D5 | OCR dependency on jsDelivr | Harden failure handling now (P3); self-host the ~5.4 MB tesseract assets as follow-up; pixel signature once someone captures a real save frame. |
| D6 | Idle pause | Duty-cycle probe (~14.6% of a core measured vs ~100% today) on by default; hard pause only after a scripted full-season run. Not while hosting. |
| D7 | Text entry | Ship the hardened compose dialog first; build the live-mirroring type bar behind a flag and decide after the device checklist. |
| D8 | What do keypad `*` and `-` do in Elifoot? | Unknown (static form read found no shortcuts; they are in Delphi code). Keep unlabeled in "Mais teclas" until confirmed. `A` = Automático and `M` = Melhores are verified. |
| D9 | Real-device pass before merging P2, P8, P11? | Yes, P2 first. Otherwise keep each behind a setting. |
| D10 | Wake lock / install / backup nudges | Wake lock on while hosting and default-on in solo with a toggle; one-time dismissible banners. |
| D11 | `user-scalable=no` | Lift only after the in-app camera ships and coarse-pointer inputs are 16 px (the multiplayer study's §6 iOS auto-zoom concern is real). |
| D12 | Landscape + chat | Chat replaces the right rail (~240 px, picture ~-3%) rather than overlaying (the study reversed that) or shrinking the picture 26%. |
| D13 | Options menu on touch | Bottom sheet with sections plus a separate "Dados e avançado" modal; popover stays on desktop. |
| D14 | Seamless desktop mouse + gamepad | Later and opt-in. |

## Roadmap, in the order the critic recommends

The synthesis proposed P1-P15; the critic's corrections are applied here. Each phase is its own
PR; each needs `npm version <v> --no-git-tag-version`, `git checkout src/environments` after any
build, and a CLAUDE.md update.

1. **P0 — update flow saves first** (new, zero-risk). `installUpdate()` awaits
   `saveGameFileSystem()` and defers while a room is live. Every later release triggers this
   prompt, and today it reloads without saving.
2. **P1 — reliable typing core.** One FIFO `GuestKeyQueue` using only `sendKeyEvent` down/up at
   ~10 ms; delete `simulateKeyPress` use; accents via Alt+0nnn (U+00A0-U+00FF + euro), visible
   `?` for the rest, code-point counting via `Array.from`; hardened prompt (autocorrect off,
   16 px, progress and cancel). **Critic additions:** fold U+2018/2019/201C/201D/2013/2014/2026
   to ASCII or their Alt codes and U+00A0 to a space; check/tap NumLock and CapsLock via the BIOS
   flags byte (0x417) before an Alt send; CLAUDE.md must say js-dos's own virtual keyboard still
   calls `simulateKeyPress` until it is retired.
3. **P3 — auto-save reliability and a centre-relative OCR rectangle.** Lazy memoised tesseract
   worker raced against a 20 s timeout with backoff; `tick()` reschedules in `finally`; ROI hash
   gate; skip ticks while hidden. Prerequisite for the resolution change.
4. **P7 — accessibility / contrast / hit-target / copy sweep** on elements that survive the
   redesign.
5. **Fix `game.js` first, then P6 — boot honesty and offline.** `elifootMain`'s async Promise
   executor swallows `Dos()`/`run()` failures (it never calls `reject`), so today a timeout is
   the only error that exists; classify real errors before changing `FAIL_COUNT` or the wipe
   offer. Progress-based deadline, stage text, add `wdosbox.js` to the ngsw jsdos group.
6. **P2 — direct touch**, behind the "classic" switch and flagged until a device pass. A 497-line
   prototype exists (`touch/touch-layer.js`). Capture-phase pointer listeners on `layers.root`
   for `pointerType` touch/pen only (desktop mouse and pointer lock untouched; selected by
   pointer type, never UA). **Critic adjustments:** use the validated 40 ms chunk spacing (or
   re-run the 40-tap oracle test at 24 ms); add visible tap feedback on the host canvas; add
   drag-to-scroll mapped to arrows/PgUp/PgDn; grade on >= 10 screens.
7. **P4 — 640x480 via `dosbox.conf [autoexec]` + `d/SETRES.BAT`** (LFS bundle; needs the owner).
   Manual QA of the unvisited screens (Finanças, Estádio, Calendário, live match, loan and
   auction dialogs), re-run the pointer gain harness.
8. **P5 — save safety nets** (backup round trip, navigation guards, "Salvo às HH:mm" chip).
   **Re-specify the recovery banner against 640x480** (detect the Program Manager blue ~(0,64,128)
   plus icon; green is boot-only).
9. **P10 — control deck replacing the FABs**, **without** the P8 dependency (its "Texto" panel
   opens the P1 dialog). Needs D3 and D8.
10. Then P8 (live type bar), P9 (idle pause), P11 (zoom/pan camera), P12 (stage layout, landscape
    rails, spectator parity — re-run the multiplayer harness), P13 (menu IA, first-run coach),
    P14 (wake lock, fullscreen, audio health, install), P15 (desktop mouse, gamepad).

Also add early: a **debug-only diagnostics flag** (pointer/touch/key/IME events plus frame timing,
exportable from a phone) to feed the device pass, and decide whether specs are real: CI runs no
tests or lint, and `karma.conf.js` is non-headless, so "first specs" never gate a PR unless a
ChromeHeadless job is added.

## Rejected, with reasons

- Absolute pointer mode for tap-to-click (measured wrong, see above).
- `simulateKeyPress` for anything, or two overlapping senders.
- Editing `hdd.img`, renaming the bundle or passing js-dos a blob URL.
- Large Fonts at 800x600 (forms scale only 1.12-1.19x; detection pixels land on a grey title bar).
- Crop/cover of the 800x600 canvas (moot after 640x480, which leaves no margin).
- Rotating the canvas 90 degrees in portrait.
- Overlay or translucent controls on the picture (the multiplayer study built and reversed this).
- Double-tap to zoom (collides with Windows double-click, delivered as `WM_LBUTTONDBLCLK`).
- NFD accent stripping; auto-opening the OS keyboard when a field is detected (iOS requires a
  synchronous gesture; caret detection is 1.5-2.5 s late); reading USER's focus from guest RAM.
- Lowering or fixing dosbox `cycles` to save battery (idle CPU stays ~101%).
- `[scrollY]="false"` permanently on the host `ion-content` (contradicts a documented invariant).
- Removing `user-scalable=no` immediately.
- Right-click as a P2 gesture (no tested screen reacts to it; two-finger tap is reserved for the
  camera).

## Known gaps in this investigation

- No real-device data at all; no consolidated device test plan yet.
- The spectator page was never rendered at phone sizes; the multiplayer harness was not used.
- Emulator speed on phones is unknown: CDP CPU throttling does not slow Workers, so the 4x/6x
  boot-time numbers measure the network and main thread only. This bounds the 45 s detection
  window (P6) and the "duty-cycle is cheap" claim (P9).
- No real in-game save frame was captured, so OCR at 640x480 is unproven.
- Offline start was inferred from ngsw semantics and never run.
- Alt codes were not tried in the 8-letter filename field, the team editor, password dialogs or
  numeric price fields.
- Several settings come from multiple phases (touch mode, idle pause, dock side, type-bar flag,
  resolution flag, view mode, last-saved time) and only P5 mentions clearing them in
  `clearAllData`; there is no flag registry.
