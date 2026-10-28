# Mobile UX study

Investigation record for the mobile/touch UX refactor. Written 2026-10-27 from seven
parallel investigations (baseline capture, resolution, touch, text entry, layout, shell audit,
platform), a synthesis and a completeness critique. **Only the roadmap items marked "As built"
below are implemented.**
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
- The OCR rectangle was 800x600-anchored; it is now centre-relative (`left = W/2-68`,
  `top = H/2-25`, 132x20), bit-identical at 800x600 and `(252,215)` at 640x480 (P3).

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
   **As built:** `AppComponent.installUpdate()` awaits `saveGameFileSystem()` raced against 5 s
   (`TimeoutHelper.withTimeout`, reused by P3/P6) and reloads whatever happens. "Instalar agora"
   asks first when `MultiplayerService.isHosting`; "Atualizar depois" leaves `PENDING_UPDATE`
   set. Deliberately left to P5: the `isGameSaving` guard (a flush that lands during the game's
   own write can persist a truncated `.e98`), the `Recarregar` menu item and navigation guards.
2. **P1 — reliable typing core.** One FIFO `GuestKeyQueue` using only `sendKeyEvent` down/up at
   ~10 ms; delete `simulateKeyPress` use; accents via Alt+0nnn (U+00A0-U+00FF + euro), visible
   `?` for the rest, code-point counting via `Array.from`; hardened prompt (autocorrect off,
   16 px, progress and cancel). **Critic additions:** fold U+2018/2019/201C/201D/2013/2014/2026
   to ASCII or their Alt codes and U+00A0 to a space; check/tap NumLock and CapsLock via the BIOS
   flags byte (0x417) before an Alt send; CLAUDE.md must say js-dos's own virtual keyboard still
   calls `simulateKeyPress` until it is retired.
   **As built:** `GuestKeyQueueService` is the only key sender (one FIFO consumer, tasks `chord` or
   `altCode`; a text is planned by the pure `EmulatorKeyCodeHelper.planText`), `KEY_PACING_MS` 10
   and at most 14 events per burst. Measured on the real bundle in headless desktop Chrome: a
   493-character text with accents, folded punctuation and an emoji typed into Windows Notepad
   through the dialog with no character lost (12.9 s, smallest gap between event groups 10.0 ms,
   largest burst 2); 500 characters with ten FAB taps submitted mid-send queued behind it in order
   and the guest stayed alive. Where it differs from the plan above, on evidence:
   - **The euro sign and the rest of Windows-1252's 0x80-0x9F block are `?`,** not Alt+0128. The
     alt codes are accepted, but the edit fields' font has no glyph there and draws a solid box.
   - **The quotes, dashes, ellipsis and exotic spaces fold to ASCII** instead of using their Alt
     codes (which would hit the same missing glyphs for most of them).
   - **Only CapsLock is guarded.** The flags byte does track NumLock and CapsLock under Windows
     3.1, but Alt+0nnn composes the same character with NumLock on or off, so a NumLock tap would
     be dead weight. CapsLock inverts Shift-letters, so a text that types letters checks it first.
   - **Progress is a toast, not a second dialog** (a dialog hides the very field being typed into),
     shown from 24 tasks up, and its Cancelar calls `cancel()`. `enterkeyhint` is `enter` rather
     than `send`: in a textarea that key inserts a line break, which is how several game fields are
     filled in one go, so a "send" label would sit on a key that does not send.
   - **The 8-letter filename field accepts the accents** (it upper-cases them), so there is no
     ASCII fold anywhere.
   - **Not verified:** the pacing on a low-end phone; any iOS or Android keyboard behaviour
     (autocorrect, the smart-punctuation folds); whether Elifoot can save and reload a game whose
     file name holds an accented letter.
   - **Found on the way, documented in the FAQ:** on the game's first dialog Enter before a radio
     is chosen, Esc and its own Cancelar all quit Elifoot to Windows (all three reproduced).
3. **P3 — auto-save reliability and a centre-relative OCR rectangle.** Lazy memoised tesseract
   worker raced against a 20 s timeout with backoff; `tick()` reschedules in `finally`; ROI hash
   gate; skip ticks while hidden. Prerequisite for the resolution change.
   **As built:** `OcrWorkerHost` (one memoised start, 20 s deadline through `TimeoutHelper`, retries
   after 5/15/60 s, then gives up), `OcrRegionHelper` (centre-relative strip + FNV-1a hash),
   `RegionVerdictCache`, `BackoffHelper`, and a rewritten `AutoSaverService` (300 ms sampling,
   `finally` reschedule, per-step 10 s heartbeat, owed persist, forced periodic save plus one toast
   when OCR is unavailable, hidden pages skipped unless hosting, loop outside the zone). Measured on
   the real bundle in headless Chrome, 800x600:
   - **A real save was captured** (first kickoff of a new game; `p3-real-save-800x600-*` and the
     earlier `baseline-800x600-*`, in the research folder's `captures/`, outside the repo). The dialog was up for 1.70 s and its strip hash was
     identical to the baseline run's, OCR read `À gravar o jogo...` in 26 ms 171 ms after it
     appeared, and the persist started 0.7 s after it closed (one `saveGameFileSystem`, 1.18 s,
     one loader). Over the whole first round (235 s): exactly one persist, ten OCR passes.
   - **The dialog is not shown on every kickoff.** A loaded game's two kickoffs and the end of its
     round showed none (checked frame by frame with a 30 ms recorder), so a test that needs a save
     has to start a new game.
   - **No false positives** over the half-time window and the end-of-round screens, or on frames of
     "A iniciar o jogo…" and "A carregar o jogo…", which sit where the dialog does.
   - **640x480 is proven only synthetically:** the real dialog pasted centred into a 640x480 frame
     reads as saving through the real service, the old absolute strip (332, 275) sees 0 navy pixels
     of it and the centre-relative one (252, 215) sees 1892 (the figure RES-6 measured). The game
     itself was not run at 640x480.
   - **Failure paths, with a stand-in CDN (the sandbox blocks jsDelivr):** a core that answers 503
     fails at once, retries at 5 s, 20 s and 80 s after the start (four requests) and gives up; one
     toast; the forced periodic save fell due 300.0 s after the first failure; the loop kept
     sampling at 3.3 Hz throughout. A CDN that never answers failed at exactly 20.006 s. A worker
     that finished after its deadline was adopted (`OCR is back`) and ended the forced save.
     Switching auto-save off and on after giving up restarted OCR, with no second toast.
   - **Ticks do not drive change detection** any more: 1 `onMicrotaskEmpty` in 10 s against ~33
     ticks. Hidden pages are skipped (0 samples in 3 s) unless hosting (10); `document.hidden` was
     overridden for that, not a real background tab.
   Where it differs from the plan: the toast lives in `AutoSaverService` (not `EmulatorControlService`)
   because only it knows the periodic fallback is on; "terminate the partial worker" is only
   possible for a start that eventually resolves, since tesseract.js exposes the `Worker` after
   initialisation, so the retries are bounded instead; the heartbeat is per step, not around the
   whole tick, which legitimately lasts as long as a save; a failed persist is owed and retried;
   `GamePage.ngOnDestroy` now stops the auto-saver; `isGameSaving` answers `true`/`false`/`null`
   and the wait for the dialog to close treats `null` (OCR could not read) like a throwing look,
   as "still saving" (found in review: the old loop and the first cut folded it into `false`,
   which would have persisted mid-write); a tick left over from a stopped run no longer touches the failure count
   of the run that replaced it. `game.page.html` had no 800x600 comment to fix
   (its note at ~243 says only "4:3"); the one in `global.scss` is corrected.
4. **P7 — accessibility / contrast / hit-target / copy sweep** on elements that survive the
   redesign.
   **As built:** aria-labels on the About, FAQ/Manual and O Matic close buttons and the options
   trigger; `#game-container` is `role="application"` with a label; the chat transcript is
   `role="log"` (`polite`, `atomic=false`, `relevant=additions`). `--win9x-ink-muted` (#4a4a4a)
   replaces `--win9x-shadow` as text colour, `#a11` is `#800000`, the landing footer subtitles are
   `color="light"`. One `@media (pointer: coarse)` block at the end of `_win9x.scss` (44px
   `.win9x-button`, `.win9x-expander`, alert buttons and titlebar close; 40px roster rows; 16px
   text fields through `--win9x-input-font-size`), a shared `ion-button.win9x-titlebar-close`
   replacing three copies of an `ion-toolbar ion-button` override, and a 44px `::after` on
   `.mp-status-pill` (a transparent border, not an `::after`; still flat, still in `global.scss`).
   Copy: "Múltiplas tentativas (3)", a
   neutral "O jogo não carregou" header, "Como funcionam", "às pressas", the About year from
   `new Date()`, and `PatchService`'s thrown messages in Portuguese (`save-game.service.ts` throws
   nothing a person sees). The manual's video is a click-to-load youtube-nocookie facade in a 16:9
   box without `aspect-ratio`. Two specs (`patch.service.spec.ts`, `win9x-palette.spec.ts`).
   Measured in headless Chrome with synthetic touch emulation (`pointer: coarse` confirmed with
   `matchMedia`), a build of the previous commit against the working tree, at 390x844, 844x390
   and 1280x800:
   - **Contrast** (WCAG ratio): hint/timestamp text on the window face 2.17 → 4.87; on white 3.95 →
     8.86; on the shaded roster row 3.28 → 7.37; error text on the face 4.13 → 6.02; the landing
     footer 3.02 → 9.75 (`light` is `#d5d5d5` in this theme, not Ionic's `#f4f5f8`).
     **The investigation's "about 7:1 on #c0c0c0" for #4a4a4a was wrong; it is 4.87.** That clears
     AA but not AAA, and a darker grey would stop reading as secondary next to the black ink.
   - **Hit targets at 390x844, coarse:** `.recent-room` 16 → 44px, titlebar close 34.9x32 → 44x44,
     alert buttons 36 → 44, the chat's roster expander 18 → 44, the O Matic's buttons 36 → 44,
     roster rows 29.5 → 40 (the chat's compact strip stays 22.5), chat and room inputs 13 → 16px.
   - **The status pill's hit area, corrected after review.** The first version laid a 44px `::after`
     over the pill and the notes here said a 2-D grid showed a 44px rectangle. It did not hold in
     the real header: the pill sits in an `ion-title`, whose shadow `.toolbar-title` is
     `overflow: hidden` and one line box (~31px) tall, which clips the pseudo-element for hit
     testing. An `elementFromPoint` column scan down the real spectator header found the pill only
     from y = 12 to 43 (32px: 7px above the capsule, none below). The fix is 10px of transparent
     border top and bottom with `background-clip: padding-box`: the scan now reads 5 to 49 (45px),
     the toolbar title box is 44px inside the 56px toolbar, and the capsule is a true 24px pill
     (it sits ~3px higher, on the toolbar's centre line with the icon buttons, where before it hung
     off the line box's baseline). The floating instance measured identical to the pixel under a
     mouse and a touch pointer (capsule top 9.91px, height 24.19px), with the hit area growing
     from 26 to 45px.
   - **Desktop (1280x800, fine pointer) is geometry-identical** before and after: every
     bounding box in the dialogs, the panel and the alerts, and the O Matic's 416/416 scroll
     (no overflow), is unchanged; only colours and ARIA differ.
   - **The original 44px-floor overflow did return on touch tablets, and is fixed.** Review found
     it: with touch emulation at 820x1180 and 1024x768 the O Matic is still the 480px desktop box
     (768px+ wide) but its buttons are 44px, and the scroll area measured 440 against 416 (a
     scrollbar and "Cheats Salvos" clipped). `@media (min-width: 768px) and (pointer: coarse)`
     sets `.omatic-modal { --height: 520px }`: 456/456 at both sizes, and 1280x800 with a mouse is
     still 416/416 with 36px buttons. The 844x390 phone and the 390x844 phone are unchanged.
   - **Found on the way, fixed:** at 844x390 the O Matic modal's titlebar was already at y = -41
     before this change (a 480px box centred on a 390px viewport), so its close button could not be
     reached. `.omatic-modal` now has `--max-height: 90vh`; the titlebar is at y = 24 and the 44px
     close button is fully on screen. The content scrolls inside (486 vs 287px); it overflowed
     before too (462 vs 416, with the title clipped).
   - **Cost to know about:** the saved-cheats alert (three stacked 44px buttons) leaves 61px of
     list at 844x390, one row and a bit, against 85px with the 36px buttons. It scrolls.
   - **Accessibility tree** (`Accessibility.queryAXTree`): before, the three close buttons and the
     options trigger were unnamed and neither `#game-container` nor the transcript had a role;
     after they read "Fechar" ×3, "Menu de opções", `application` "Elifoot 98 (emulador)…", and
     `log` "Mensagens do chat" with `live: polite, atomic: false, relevant: additions`.
   - **Manual at 390px:** the old iframe was 480x315 at x = 48 (right edge 528 on a 390px screen);
     the facade box is 294x165 (16:9) and the iframe that replaces it keeps that size.
   Not done here: label renames such as "Auto-Save" (P13), the FAB and header buttons and the chat
   toggle (P10 deletes them), `maximum-scale`/`user-scalable` (VIEW-1; the 16px inputs are its
   precondition). **Known:** the 'O Matic video id is dead (YouTube's oEmbed answers 404, against
   200 for a control video), so the player says "Video unavailable" until the owner supplies a new
   id.
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
exportable from a phone) to feed the device pass, and decide whether specs are real. **T0 made
them runnable** (`npm run test:ci`, a `ChromeHeadlessCI` launcher, and the first spec for
`RoomCodeHelper`), but CI still runs no tests or lint, so specs gate a PR only once a
ChromeHeadless job is added to the workflows (the owner's call).

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
- A real save frame exists now (800x600, P3); OCR at 640x480 is proven only on that frame moved
  to the centre of a 640x480 one, not in the running game.
- Offline start was inferred from ngsw semantics and never run.
- Alt codes were not tried in the 8-letter filename field, the team editor, password dialogs or
  numeric price fields.
- Several settings come from multiple phases (touch mode, idle pause, dock side, type-bar flag,
  resolution flag, view mode, last-saved time) and only P5 mentions clearing them in
  `clearAllData`; there is no flag registry.
