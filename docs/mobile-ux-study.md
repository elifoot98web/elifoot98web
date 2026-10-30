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
  splash sits on the backdrop. "Green lost" becomes the normal state at 640x480. (Measured in P4:
  4 of 4 points on the splash and the new-game dialog, 1 of the 3 needed in play.)
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
  upgrade path (old layer, then the new bundle) must be re-tested before the bundle is committed
  (done, see P4 as built).
- **D3 — Win9x look** for the dock and the type bar; flat shell for toolbar, save chip, menu
  sheet and install banner.
- **D8 —** `*` opens the player search for the "craque/estrela" attribute; `-` is used to enter
  the serial registration key. Label them accordingly in "Mais teclas".
- **D9 — yes**, real-device pass on a Galaxy A07 (low-end Android) and an iPhone 15 Pro Max.
  P2, P8 and P11 stay behind settings until that pass.
- D4-D7 and D10-D14 were not answered; the recommendations below stand as defaults. D6 was built as recommended (the
  duty-cycle probe, not while hosting) except for "on by default" (see P9 as built). D4 (a hint and a "Tela cheia" button, no
  lock) and D10 (the wake lock on while hosting and by default in solo play with a toggle, one-time dismissible banners) were built
  as recommended (see P14 as built).

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
   **As built:** `elifootMain(prefix, url, onProgress)` now rejects with the real error from
   `Dos()`/`run()` (the executor's `async` swallowed them) or with a `JsdosTimeoutError`; a
   `MutationObserver` on `.emulator-loading-pre-2` restarts a 20 s stall clock on every change of
   js-dos's loading text (60 s once it reads "Downloading bundle 100%", 120 s hard cap per wait),
   and calling it again re-attaches to the boot in flight instead of stacking a second DOSBox.
   `GamePage.bootGame()` mirrors the text in Portuguese, then labels the stage from the polled
   frames (`BootStageHelper`) for up to 45 s, and a timeout offers "Continuar esperando" /
   "Tentar de novo" without touching `FAIL_COUNT`. The bundle URL is untouched (RES-3). The
   `jsdos` ngsw group is prefetch with five named files including `wdosbox.js`; icons are a
   `dataGroups` entry. Four spec files were added (55 cases; the suite is 258). Measured in headless
   Chrome 156 against the dev server unless noted, each scenario in a fresh browser context:
   - **Failure kinds.** *Bundle request never answered:* stall dialog at 20.5 s ("Última etapa:
     Baixando o jogo…"); "Continuar esperando" returned to the loader and the next dialog came
     20.5 s later; `FAIL_COUNT` stayed unset, nothing reloaded. *404 (or request refused):* js-dos
     rejects "Network error, can't download …", which is `network`: the dialog says the files
     could not be downloaded; `FAIL_COUNT` read 1, 2, 3 across two "Tentar de novo" and the
     wipe button never appeared. *Corrupted bundle (200 with garbage):* js-dos rejects "Broken
     bundle, .jsdos/dosbox.conf not found", which is `other`: the third attempt added
     "Limpar todos os dados". With a real 4.5 MB changes layer saved first, "Baixar cópia dos meus
     dados" downloaded `fullDiskChanges_….zip` (4,473,112 bytes, `PK` header, `hdd.img` of
     26,214,400 bytes inside) and left the dialog up; the wipe then emptied the `files` store (it
     would not have: `clearAllData(null)` returned early) and reset the count.
   - **Slow is not a failure.** Bundle throttled to 200 KB/s: about 330 loader updates "Baixando o
     jogo… N%", 34 s of download, a 9 s silent gap while `wdosbox.wasm` came down, game up at
     46.7 s, no dialog. At 40 KB/s the hard cap fired at 120.4 s with the download at 71%;
     "Continuar esperando" resumed at 72.6%, not from zero. That run also showed the flat 20 s
     window firing a second dialog in the 43 s silent wasm gap after "100%", which is why that
     one step has 60 s. With it, a clean rerun showed one dialog only (at 71%), the download
     finishing at 171.5 s, the 43 s silent gap bridged ("Descompactando…" at 214.8 s), and the
     welcome dialog at 218.7 s on the same single DOS instance.
   - **Detection window.** With `screenshot()` stubbed to a black 640x400 frame the loader held
     "Iniciando o DOS…" and the toast "O jogo ainda está iniciando…" came at 45.96 s, with no
     welcome dialog and `FAIL_COUNT` 0; black 800x600 gave "Abrindo o Windows 3.1…" and a flat
     `(0, 64, 128)` gave "Carregando o Elifoot…". A real boot went "Iniciando o DOS…" to
     "Carregando o Elifoot…" to the welcome dialog at 4.9 s.
   - **Offline (production build, plain http server on localhost).** The server is *killed* after
     the worker installs (CDP's offline switch does not reach the worker's own fetches). New
     config, one online visit: cold load boots to the game with js-dos "Ready" and 42 responses
     from the worker; the only failures were 12 uncached icons (504), so the buttons were blank
     circles. With the `icons` data group and two visits: 0 failed requests, icons present.
     **Control, old config:** after one visit `js-dos.js` fails and the dialog says the files
     could not be downloaded; after two visits it still fails at `wdosbox.js` (504), so PLAT-5 was
     right.
   - **Service worker registration** was left alone: it registers 0.26 s (1x CPU) / 0.88 s (6x)
     after a direct `/#/game` load, prefetch complete at 1.3 s / 1.7 s, bundle requested once.
   - **Review fixes (finalizer).** `elifootMain` re-attached to *any* boot still pending or
     failed, but `Dos()` builds the canvas and input inside the element it was given and
     `GamePage` is rebuilt within one document (Back, then Jogar), so the new page got a `dosCI`
     in a detached tree, or the old failure replayed as a new attempt. A boot is now also
     replaced when `#game-container` is not the element it started in. Checked in a bare node
     `vm` with a hand-made DOM and a manual clock (12 cases, no browser could be launched in
     the finalizer's sandbox): against the first version the rebuilt-container cases fail,
     with the fix they pass, and the same harness pins the 20 s / 60 s / 120 s windows. Also:
     `GamePage` dismisses its timeout/failure dialog on destroy and ignores "Continuar
     esperando" afterwards, the `FAIL_COUNT` reset can no longer strand the boot overlay when
     storage is blocked, the no-`databases()` backup path aborts instead of creating js-dos's
     database, and the corrupt-*layer* claim was wrong (an unreadable layer is swallowed, a
     readable non-zip fails in the worker as an `other` failure). The suite is 258 cases.
   Deviations and leftovers: the wipe is *not* offered after `network` failures (a missing
   download is not something a wipe fixes, and DANGER-1 is about exactly that nudge); the
   control run found that the worker words a fetch failure "Unable to download '…', code: 504",
   which first read as `other`, so it is `network` now; js-dos's own red toast ("Can't start
   emulator…", English) still shows for a few seconds over the failure dialog; a timeout dialog
   that was already up when the boot lands stays up until tapped; not measured: any phone, a
   first visit on a slow link with the worker's prefetch competing with the page, iOS.
6. **P2 — direct touch**, behind the "classic" switch and flagged until a device pass. A 497-line
   prototype exists (`touch/touch-layer.js`). Capture-phase pointer listeners on `layers.root`
   for `pointerType` touch/pen only (desktop mouse and pointer lock untouched; selected by
   pointer type, never UA). **Critic adjustments:** use the validated 40 ms chunk spacing (or
   re-run the 40-tap oracle test at 24 ms); add visible tap feedback on the host canvas; add
   drag-to-scroll mapped to arrows/PgUp/PgDn; grade on >= 10 screens.
   **As built:** `TouchInputService` (capture-phase listeners on `layers.root`, by `pointerType`, `touch` and `pen` only),
   `GestureRecognizer` (pure state machine), `GuestPointer` (blind dead-reckoning engine), `TouchModeHelper`,
   `TouchFeedbackHelper`, the "Modo de toque" setting, the new copy, 125 specs across four files, and
   `scripts/touch-harness/` (a driver, the RAM oracle and twelve checks, with its README holding the tables). Measured in
   headless Chrome 143 against the dev server, 640x480, guest cursor read from RAM, **synthetic touches on a desktop CPU
   only**:
   - **Spacing.** Pairs of 2-unit sends were summed by the guest 40 of 40 times at 14 ms, 11 of 40 at 16 ms and 0 of 40 from
     18 ms to 28 ms: the boundary is the frame (~16.7 ms), and the 3 px claim of TOUCH-9 (measured at 40 ms) holds down to 18.
     Over 18 screens (the six dialogs of starting a game, the main window and its five tabs, two menus, five modals) x 8 seeded
     taps x six spacings, every spacing from 16 to 40 stayed within 3 px (worst 3 at 16, 2 from 18; 288 axis readings each);
     16 ms passes only because the workload is long moves, and the pair test shows it summing sends. **24 ms was chosen, not the
     smallest passing value (18):** it is the boundary plus 7 ms, the margin costs nothing a person can feel (the click follows
     the lift by 0.1 ms because the cursor walks during the touch; at 40 ms the press waits 9 ms), and a phone's emulator is
     unmeasured.
   - **The model.** Home (four sends of -200) landed on (0, 0) 60 times of 60. The model was off by exactly 2 px in 14 of 108
     short runs and never otherwise: a 2 px quantum (one mickey at the 2x gain) that comes and goes at every gap and does not
     accumulate (160 far taps and 250 short ones with re-homing off: 0 throughout). The research's "steady +2 bias" is this.
     No warp: 12 menus, tabs and modals opened with the guest's cursor exactly where the model had it.
   - **Gestures on the real game.** A palm, a second finger and a cancelled touch click nothing; a tap clicks once; aim mode puts the cursor on a
     6 px radio from a finger 56 px below it; a double tap on a country row leaves it selected and two taps 900 ms apart toggle it
     on and off (a real `WM_LBUTTONDBLCLK`); dragging the 16 px scrollbar thumb scrolls the list and releases; a tap in the
     trough pages it. The button was released after `pointercancel`, a second finger, blur, pagehide, a `touchend` without
     `pointerup`, `visibilitychange`, `freeze` and a detach.
   - **The iPad matrix** (Macintosh user agent, 820x1180, Chromium emulation): js-dos binds `mousedown`; the layer is attached,
     a tap clicks with no pointer-lock request, a real mouse still reaches js-dos, the setting is not offered, a stored `classic`
     is ignored; with the layer off a tap sends the guest nothing (the control).
   - **The setting.** In portrait and at 844x390 the entry shows in the options menu, the Win9x dialog fits, switching detaches the
     layer at once, stock js-dos then clicks at the old cursor position with no motion and no ring, the choice survives a reload
     and "Apagar todos os dados" removes it.
   Where it differs from the plan above, on evidence: **no list drag-to-scroll gesture** (the critic's addition). In
   Elifoot's country list the arrow and page keys SELECT as they move (the selected-teams counter went 20, 25, 38, 40, 43), so
   mapping a two-finger drag to them would break the selection; the scrollbar thumb drag and a tap in the trough already work, and
   two-finger gestures are reserved for P11. **No right click**, as decided. **The tap ring lives in the host's DOM**, not in
   the guest's frame, so spectators and the OCR never see it. **Classic is not offered where it cannot work** (a default-UA
   iPad, a phone in "desktop site"), and a stored `classic` is ignored there. The re-home returns the cursor to where it was.
   **Not verified:** any phone, any real finger (the 10 px / 450 ms / 56 px / 400 ms / 32 px thresholds are recalled), iOS
   Safari (compat events, `touch-action`, edge swipe, pull-to-refresh, callouts), a real background/foreground switch (CDP's
   `Page.setWebLifecycleState` delivers no events to this headless page), a host with a spectator watching the cursor, and the
   live-match and auction dialogs. **Known risks:** two quick taps on adjacent list rows read as a double-tap on the first;
   the emulator's worker on a phone may sum sends the desktop never did (raise `SEND_SPACING_MS` first). **Found in review and fixed before the
   commit** (each has a spec, and `edge-cases.mjs` re-checks the first three on the real guest): (1) the 80 ms "`touchend`
   without `pointerup`" check cancelled whatever was down when it fired, so a second tap landing within 80 ms of the first
   lifting, which is a normal fast double tap or two thumbs, was dropped with its click (the guest saw `down,up` instead of
   `down,up,down,up`); a new finger now calls the check off. (2) A tap that clicked nothing (it landed in the strip beside
   the picture) still counted as the first tap of a double-tap, so the retry clicked wherever the cursor had been left; the
   layer now takes it back (`forgetTap()`). (3) The 600-send re-home budget, a frame-size change and `invalidate()` could all
   home with the button held, flinging a scrollbar thumb or a window to the corner; the budget now waits for the release, and
   a press that has lost its position is released. (4) The idle re-home did not know a finger was down, so aim mode (a still
   finger, no button) could lose its cursor to the corner after 0.9 s; the layer now tells the engine (`setFingerDown()`).
   (5) The layer stops the events js-dos listens for to resume its `AudioContext` (a document-level one-shot `click` or
   `touchstart`), so on iOS the game would have stayed silent, and a hosting phone streamed silence, until a tap outside the
   game; a lifted finger now calls `resume()` (the headless shell resumes a context once per boot, so the harness grades the
   request, not the state). (6) A rejected Ionic Storage read skipped installing the layer, which on a default-UA iPad is the
   only touch input there is; an unreadable choice is now `direct`, and a failed write still applies the choice for the
   visit. No finding was dismissed. Re-run after these fixes: `gestures.mjs` 10 of 10, `stuck-button.mjs` 8 of 8, `ipad.mjs`
   8 of 8, `setting-ui.mjs portrait` 10 of 10, `edge-cases.mjs` 4 of 4. **Found on the way,
   not fixed:** in about 3 boots of ~35 the guest stayed at the DOS prompt (`C:\>D:\ELIFOOT.BAT`, Windows never started, the frame a
   black 640x400); two followed minutes of play in the same profile (the 5-minute forced periodic save, since OCR cannot load in the
   sandbox, is the first suspect), one came with the site data wiped. It happens before any touch code runs and is not understood.
7. **P4 — 640x480 via `dosbox.conf [autoexec]` + `d/SETRES.BAT`** (LFS bundle; needs the owner).
   Manual QA of the unvisited screens (Finanças, Estádio, Calendário, live match, loan and
   auction dialogs), re-run the pointer gain harness.
   **As built:** the bundle gains `call d:\setres.bat` in `[autoexec]`, `d/SETRES.BAT`,
   `d/res/s640.ini` and `d/res/s800.ini` (`scripts/resolution/build_bundle.py`, documented in its
   README); `PatchService.setDisplayMode` adds or removes `d/res/use800.flg`; the options popover
   has "Resolução do jogo" (radio dialog, then a confirm that says it reloads; disabled in a room).
   The mode shown is read off the framebuffer (`DisplayModeHelper`), no storage key. FAQ and manual
   entries say plainly that on a desktop the picture is magnified 1.25x more (larger, softer).
   Measured, in headless Chrome 143 against js-dos as vendored, bundle URL unchanged throughout:
   - **Upgrade path (the mandatory test; screenshots in `p4-upgrade/`).** Old bundle, new game, first
     kickoff, layer persisted (`P4TEST.E98` plus the 26 MB `hdd.img`, `.jsdos/` as an empty folder
     entry): the new bundle at the same URL, same profile, reloaded to **640x480**, the green probe
     passed (4 of 4), "Jogos gravados" listed the old save and it loaded. A layer patched through
     `PatchService` (identity patch of the bundle's own 281 teams; `ELIFOOT.BAT` 59 B, `PATCH.BAT`
     770 B and `d/eli98/PATCH/` in the layer): 640x480 as well, `PATCH.BAT` still ran (the 281 team
     files show as rewritten in the next persist), the save loaded. `use800.flg` written through the real menu: the next boot
     was 800x600, with the patch files and the save intact; chosen back, the flag was gone and the
     boot was 640x480. A browser restart on the same profile kept 640x480; a brand new profile
     booted 640x480. The persisted `hdd.img` of a session that has not saved since the switch still
     holds the previous mode's `SYSTEM.INI`, which is harmless: `SETRES.BAT` rewrites it at every boot.
     All of this was run again on the final bundle after the review below changed `SETRES.BAT`
     (it is the only entry that differs from the first build): fresh profile 640x480, the old
     long-time layer 640x480 with its save loading, the `PatchService`-patched layer 640x480 with
     `PATCH.BAT` still running and its save loading, the menu round trip 640x480 -> 800x600 (flag in
     the live persist, patch files and save intact) -> 640x480 (flag gone), in the real app.
   - **Review finding, confirmed and fixed: older disk images.** The first build overwrote
     `SYSTEM.INI` on any disk, but the repo has shipped other `hdd.img` files and a layer keeps the
     one it first got. Diffed against the current image: `e6084fe` (VGA) lacks all seven files the
     new `SYSTEM.INI` names (`s3vsnd.drv`, `vdds3vsn.386`, `s3911grb.3gr`, `vsbd.386`,
     `vadlibd.386`, `sndblst2.drv`, `msadlib.drv`), `ce6eb4a` (256 colours, on `main` from PR #15 to
     PR #22, about a day) lacks the four sound ones, `af63c64` and everything since is one image.
     Reproduced on a real `ce6eb4a` layer (booted in a fresh profile and persisted; the save was put
     into `jogos/` from another layer, because that bundle's mouse sensitivity defeats the scripted
     navigation): the first bundle at the same URL left the guest at the DOS prompt with "Cannot find
     a device file that may be needed to run Windows in 386 enhanced mode ... vsbd.386". Fix:
     `SETRES.BAT` first tests the seven files and does nothing if one is missing; the same layer then
     boots Windows 3.1 and Elifoot at 800x600, as it did before the update, and the save loads. Such a
     player cannot be moved to 640x480 (the menu only writes the flag); "Apagar todos os dados"
     does it. `verify` now checks the seven files are on the bundle's own image and named in both
     INIs. A `SYSTEM.INI` per known old image was left out: each would need its own drivers and its
     own test, for a group of players that is probably empty by now.
   - **The bundle.** +9.2 KB (6,759,047 against 6,749,854 bytes; the three new files and the conf
     are stored, not deflated, so the output does not depend on the zlib build). The other 570
     entries are byte-identical, `hdd.img` included; `build` on its own output is a no-op, and on
     the first build it gives the final one; DOSBox's COPY takes `/y` (it ignores it).
   - **Load detection in the real app at 640x480.** `Green check passed`, the game shown 4.2 s after
     the reload (P6 measured the green at 4.1 s at 800x600). Loader text: "Iniciando o DOS…" (frame 640x400), "Carregando o
     Elifoot…" at 2.2 s, loader gone at 4.4 s; "Abrindo o Windows 3.1…" fell between two 500 ms looks,
     as P6 predicted. The probe: 4 of 4 on Registo, Acerca and the new-game dialog, **1 of 3 needed
     in play** (only `x = 0` stays green): the critic was right that green is lost once the game is
     running, and it is harmless because the probe runs only at boot.
   - **OCR rectangle and auto-save at 640x480, real game, real tesseract (through P3's stand-in
     CDN).** The region resolved to (252, 215); the strip held 1892 navy and 352 white pixels, as at
     800x600; `isGameSaving` was `true` for the dialog and the app's own auto-saver persisted
     `QA640.E98`. Dialog length, 10 ms recorder, same machine: **0.61 s at 800x600, 0.62 s at 640x480**
     (P3's 1.7 s was a slower run), so the resolution is not what shortens it.
   - **QA walk at 640x480** (`qa-640/`): Registo, Acerca, new/continue, Selecção de Países, currency,
     Jogadores and the draw, the main window and its five tabs, the six menus, Opções, Estádio,
     Historial, Calendário, Classificação, Melhores marcadores, Ranking de Treinadores, História, Vender,
     the live round, the half-time and injury dialogs, the round's standings, "Venda de jogador por
     leilão", "Actualização de Salário", Program Manager (restored from its icon), Run and EDITEQ with
     its Abrir dialog and a squad. **Nothing is clipped.** The tightest are Ranking de Treinadores
     (about 576x475, top at y = 3, bottom border at y = 478) and Classificação (590x400).
     **Not reached:** a bank-loan prompt, "Últimas transferências", "Últimos vencedores", "Melhores
     marcadores de sempre", "Perfil", the cup draw, and any flag editor.
   - **Multiplayer.** The two-peer harness could not run: it needs Chrome's own debug port and the
     public nostr relays, and the build sandbox blocks both (the relays answer 403 from its proxy).
     What was checked instead: `canvas.width/height` and the `captureStream` track are 640x480, and
     a same-page `RTCPeerConnection` loopback of that stream delivered a `<video>` that began at
     320x240 (the encoder ramp-up the join page's ratio-based fit exists for) with the 4:3 ratio, so
     `fitVideoToContainer` gives the same box at either mode (389x292 in a 390x292 container).
     The cursor overlay normalises against that box, so it is unaffected. A host cannot change mode
     in a room, so a spectator never sees the size change mid-stream.
   - **Phones (emulation only).** 390x844 and 844x390 with touch emulation: the menu entry, its
     subtitle and the radio dialog render. The first dialog text was too long for a landscape
     phone (the second radio fell below the fold); it was cut to two sentences.
   Deviations and leftovers: no `npm version` (the stack already carries 3.2.0); the pointer-gain
   harness is P2's; a player still on a `ce6eb4a`/`e6084fe` disk is left at 800x600 and the menu
   entry does nothing for them without saying so (the mode shown is the frame's, so it keeps
   reading 800x600), which a later check after the reload could name; `layers.save()` swallows its own errors (P0), so a failed write of the flag would
   reload into the old mode without saying so. **Found on the way:** `sendMouseRelativeMotion(NaN, …)`
   poisons the guest's mouse until the page reloads (probably DOSBox's pointer position, a float,
   which NaN sticks to): after one the sprite stayed at (0, 0) and later motion changed nothing. P2's
   pointer engine has to refuse non-finite deltas. A second boot of the same layer shows the Registo
   (nag) screen before Acerca, which is the game's own behaviour and nothing to do with the mode.
8. **P5 — save safety nets** (backup round trip, navigation guards, "Salvo às HH:mm" chip).
   **Re-specify the recovery banner against 640x480** (detect the Program Manager blue ~(0,64,128)
   plus icon; green is boot-only).
   **As built:** `SaveStatusService` (main bundle: last persist, first persist, last backup, input since the last
   persist as a counter, the one-time reminder, `freeze()` for the wipe, `allowExit()` for deliberate reloads),
   `SaveSafetyService` (the game chunk: input listeners, the page-hidden save, `saveNow`, `saveBeforeReload`,
   `beforeunload`), `SavePolicyHelper` (the decision tables), `SaveBackupHelper` (both ends of the backup file),
   `NavigationGuardHelper` + a `canDeactivate` on the game route, `GameExitHelper` + `GameExitWatcherService` (the
   recovery signature), the toolbar chip, and `STORAGE_KEY_HOMES` with the spec that proves the wipe.
   `SaveGameService.saveGame()` now runs one flush at a time and is where every persist is reported. Measured in
   headless Chrome 143 (chrome-headless-shell) against the dev server, 640x480, synthetic input on a desktop CPU:
   - **The recovery state was reproduced for real, not inferred.** Boot, Enter on the splash, Esc in the first
     dialog: Elifoot quits to a bare `(0, 64, 128)` desktop with the Program Manager icon and nothing else, 99.3% of
     the frame desktop colour (305,039 of 307,200 pixels; 11 colours in all). The icon is at x 16-61, y 410-469, 10 px
     above the bottom edge: **the same offsets at 800x600** (`use800.flg`, captured the same way). It stays selected
     (navy label) after a tap on the desktop. The signature is a grid scan (every 8 px; all but 8 samples outside the
     icon's box must be the desktop colour, the 8 being the mouse cursor, which is drawn into the frame) plus white
     and ink in that box. Over the 127 real 640x480 frames of the P4 walk the desktop colour never appears in Elifoot's own
     screens (0 pixels, tolerance 25 included); the fewest stray samples in any non-Program-Manager frame was 3,268 of
     4,728 (the team editor over the desktop, 31% blue); only the two Program Manager captures match. A fresh walk of 20 screens through the
     live app with the watcher on (new game, 6 setup dialogs, the draw, the main window and its 5 tabs, 2 menus, 5
     modals) found 0 desktop samples in any frame and showed no dialog. The Program Manager window restored from its
     icon (44% blue) and a minimised-Elifoot lookalike (a copied second icon) do not match.
   - **The dialog.** Esc to "O Elifoot foi fechado" took 2.9 s (the three looks of the watcher, one a second);
     "Agora não" was not asked again over the next 7 s; "Reiniciar jogo" saved (a 5.4 MB layer in IndexedDB, the chip
     read "Salvo às 22:50" after the reload), exited, reloaded, and the game came back up.
   - **Back.** With the router's default, the first Back asked and the next left the page. With
     `canceledNavigationResolution: 'computed'`: Back, Back with the dialog open, Cancelar, Back again,
     `router.navigate(['/main'])` each gave exactly one "Voltar ao menu?", `history.length` stayed at 10 and the hash at
     `#/game`; a query-only navigation on the same route passed; "Sair" saved, left for `#/main` and the landing card
     showed, with no browser prompt.
   - **`beforeunload`.** A clean page navigated away silently; after one tap on the game (dirty) Chrome opened a
     `beforeunload` dialog (it blocked the harness until it was accepted: `scripts/touch-harness` runs need that handled),
     "Stay" kept the page and its state; `reloadPage()` reloaded with no prompt.
   - **Saving.** A tap on the chip saved ("Salvo às 22:23", a toast, `lastPersistedAt` and `firstPersistedAt` stored,
     the 5.36 MB layer present). Hiding the page (the event dispatched by hand: CDP delivers no lifecycle events here) with
     input pending and the real OCR (it loaded here) returning `false` persisted once (about a second); a second hide inside the gap was
     `throttled` and left `dirty`; with the look answering `null` or `true` it did not persist (`unreadable`,
     `game-saving`), and with auto-save off it did not even look (`auto-save-off`, no OCR pass started).
     "Salvar agora" with the look answering `true` said the game was writing and wrote nothing. "Salvar e recarregar":
     `null` offered "Recarregar sem salvar", `true` said to try again, the real look saved and reloaded.
     `navigator.storage.persist()` was asked once and refused in this headless profile (logged).
   - **The backup.** Two `.e98` files through the picker: the confirm listed both ("serão adicionados"), the input was
     emptied, an empty `change` did nothing (no loader, no dialog); after the reload the game's own "Jogos gravados" list
     showed `DOIS` (the other fake save, 14 bytes of text, is in the layer, `existingSaveNames` lists both, but the
     game did not list it; why was not investigated). Export downloaded `elifoot98_saves_2026-10-28_23-15-16.zip` (flat `UM.E98`,
     `DOIS.E98`); with stand-in `navigator.share`/`canShare` the page showed "Backup pronto" with three buttons, and a real
     tap on "Compartilhar…" reached `navigator.share` with a 3,223-byte `application/zip` `File` while
     `navigator.userActivation.isActive` was true. Re-importing that zip flagged both as "(substitui o atual)" under a
     danger button; picking the same file again after "Cancelar" asked again; a `.e98` plus a `.json` listed the second as ignored.
   - **The chip at phone widths.** It fits beside the menu at 360 and 390 px. While hosting it collides with the room pill
     (119 px wanted, 78 px left at 360 with a dot-only chip), so the chip drops its words under 600 px and steps aside under
     402 px; at 412 and 430 px both fit.
   Where it differs from the plan: the recovery "banner" is a `win9x-alert` (modal), not a docked banner; the
   router's `canceledNavigationResolution` is set to `'computed'` (not in the plan: the default made the guard a one-shot);
   the share sheet is a button after the zip is built (Safari wants the gesture), and only on a coarse pointer, so a
   desktop still downloads at once; "Salvar Máquina Virtual" moved out of the Auto-Save submenu to a top-level
   "Salvar agora" (the chip's twin, and the only chip surface in mobile landscape, which has no toolbar); the settings
   registry is `STORAGE_KEY_HOMES` plus a wipe spec, with no allow-list because no key survives a wipe; the update prompt
   waits for a save the auto-saver has seen and otherwise persists as P0 did. **Not verified:** any phone; Safari
   (`navigator.share`, `storage.persist()`, tab eviction, `beforeunload`, the edge-swipe Back); the Android Back button and
   a PWA's history stack (the sequence above is `history.back()`); a real background/foreground switch; the chip's
   legibility on a real screen; a hosting phone's room pill beside the chip; the share sheet's real targets; importing a zip
   from Files or Drive; a real save from a played round going through export and import (the saves used were small fakes).
   **Found on the way, not fixed:** a hand-made `.E98` may not appear in "Jogos gravados" even though it is on the disk
   (one of the two fakes did not), so a test of the import needs a real save; the chip is not shown in mobile landscape; `clearCustomPatch` still
   leaves the auto-saver running after it rewrites the layer (it only gained `stopSafetyNets`).
   **Changed by the review of this phase** (three reviewers, headless Chrome again on the final code):
   - **The leave never waited for the game's save dialog.** `leaveGameToMenu` stopped the auto-saver before it called
     `saveNow('leave')`, and the look needs the auto-saver's OCR worker, so the look was always `null`, `decide('leave',
     null)` is `persist`, and the 15 s wait was dead code; the spec passed because its rig sets `autoSaver.running`. It now
     flushes first and stops the tickers after. Checked on the live page with the game's dialog faked as "up" for 1.3 s
     after the tap on "Sair": four looks with the auto-saver running, then the leave's persist at 1.72 s with the look
     `false`, and the page landed on `#/main`. With the nets detached (`no-emulator`) the leave still saves (`saveGame()`
     was called), as the old path did.
   - **A failed patch left the page without its nets.** `applyPatch` stopped the nets and, unlike the other three flows,
     never restarted them on failure (and never dismissed its loader, which was already so before P5). A new
     `restoreSaving()` does it for all four, only when nothing was written yet (a `written` flag: after the layer is
     written the running VM must not be persisted over it). Checked: a patch that threw gave the auto-saver, the nets and
     the exit watcher back and left no loader.
   - **No persist waited for ever.** The chip, the reload, the leave and the restart sat behind an undismissable loader on
     a flush with no deadline. `SaveSafetyService.persist` (and the restart's own save) now give up at
     `AUTO_SAVER.PERSIST_TIMEOUT_MS` and report a failed save; `saveGame()` still holds its queue behind a stuck flush on
     purpose (see its docblock). Specced with a never-resolving flush; not provoked in a browser.
   - **A save on an unreadable look says so.** The deviation from "null is never not-saving" for `manual` and `leave` stays
     (the OCR down is when the button is all there is), but the result carries `verified` and the toast warns when it is
     false. Checked: auto-save on gave the green "Jogo salvo no navegador às 00:18.", auto-save off gave the amber one with
     "mas não foi possível confirmar se o Elifoot estava gravando.".
   - **The one-time reminder needs a save to remind about.** `firstPersistedAt` is set by any persist, so a visit that only
     looked around could spend the reminder on a disk with no `.e98`. It now returns early without consuming it. Checked:
     8 days old and no save: no dialog and still due; with a save: the dialog, and answered it is no longer due.
   - **The exit watcher is armed, not merely started.** It used to start only if the boot's 45 s window saw the game, so a
     slow phone that overran it had no recovery dialog for the session. It now always starts, with `armWhen` (the boot's
     green probe) in that case. Checked: the bare desktop alone never arms it (9 s, no look counted); the splash arms it
     and Esc then raised the dialog in 2.9 s. The ordinary path is unchanged (re-run: 2.4 s).
   - Smaller: "Reiniciar jogo" leaves the room it says it ends; the "Salvar e recarregar" confirm says the room ends when
     hosting; the FAQ's team-editor recipe tells the reader to answer "Agora não" when the game is quit on purpose.
   **Dismissed:** the room is not left in "Salvar e recarregar" itself (the reload follows at once, so `leaveRoom()`'s
   asynchronous goodbye would not flush, and the reload was always abrupt for a host).
9. **P10 — control deck replacing the FABs**, **without** the P8 dependency (its "Texto" panel
   opens the P1 dialog). Needs D3 and D8.
   **As built:** `app-dock` (taskbar plus one panel in the band under the picture in portrait; the same panels as a sheet from a
   "Teclas" button in landscape), `DeckKeyDirective` (the keycap), and six pure helpers with specs (`DeckKeyHelper` the key
   table, `DeckLayoutHelper` the presentation, `DeckPanelHelper`, `KeyRepeatScheduler`, `ModifierLatch`, `LayoutShapeHelper`).
   Deleted: the three `ion-fab` clusters, the header's keyboard / text / O Matic buttons, `GAME_INPUT_FN_BTNS_REVERSED`, the
   `--kb-up` chat toggle variant, `isVirtualKeyboardShowing`, the "Teclado Virtual" menu entry, `toggleSoftKeyboard` and, by a
   `layersOptions.keyboardDiv` that is never attached, the js-dos keyboard itself. ESLint now rejects any reference to
   `simulateKeyPress` in app code. `LayoutHelperService` gained `isTouchPrimary$`, `anyCoarse$` and the shape
   (`portrait` / `landscape-compact` / `landscape-regular`); two settings were added ("Mostrar painel de teclas", "Vibração nas
   teclas"). FAQ, manual and the first-run text were rewritten. Details and the invariants are in CLAUDE.md, *The control
   deck*. Measured in headless Chrome 143 (chrome-headless-shell, touch emulation) against the dev server, plus one two-peer
   session in full Chrome 156:
   - **The picture does not move.** `#game-container` and the canvas inside it had the same rectangle with the deck on, with it
     off and with the sheet open at all 13 viewports (360x640, 375x667, 393x852, 412x915, 430x932, 844x390, 932x430, 667x375,
     820x1180, 1180x820, 1024x768, 768x1024, 1280x800). In portrait the band is 314 px at 360x640, 330 at 375x667, 501 at
     393x852, 550 at 412x915, 554 at 430x932 and 509 at 820x1180.
   - **Sizes.** Under a coarse pointer every keycap of the three panels is at least 44x44 (rows are 48 px; "Mais" is 44), none
     overlaps the picture, none leaves the viewport; "Mais teclas" (five rows) fits the 360x640 panel (254 px) with no scroll, and
     the 667x375 sheet (five rows under a title and the tabs) with room to spare. With a mouse the keys are the authentic ~40 px.
   - **Every key on the real game** (the new-game flow driven only through the deck and the touch layer): see CLAUDE.md for the
     list. Highlights: F5, F6 and F8-F12 each give a different formation screen; the arrows move the country and squad lists; `A` selects the
     automatic squad; Tab walks Registo's fields; "Texto" typed "QA10", "Zé" and "João" into Elifoot's fields; a 1.5 s hold on
     Down sent 22 presses at 380 ms then 55-57 ms; Shift then Tab sent Shift+Tab once; a Ctrl lock sent Ctrl+Home and Ctrl+End and
     a blur cleared it; Alt+F4 asked first and then left for the Program Manager, with the recovery dialog up within 3.5 s.
   - **Hold-to-repeat stops** on release, `touchcancel`, window `blur`, the page being hidden, a panel switched under the finger,
     the page leaving and the key queue faulting.
   - **A bug the measurement found and fixed:** the first cut showed a "next key carries Shift" bar when a modifier was tapped.
     The bar moved the keys up by its own height, the browser aimed the click of the tap at whatever was now under the finger
     (the Tab key) and the keycap's accessibility path ("a click with no pointer before it is a press") took it as a press: Shift
     sent Shift+Tab, Ctrl sent Ctrl+Shift+Tab. The latch is now a lit key and a label on the "Mais" tab (plus a live region for
     screen readers), the click guard's clock is shared by every keycap, and a spec dispatches a click on a *different* key after a
     tap. The same pass found a folded deck riding up under the picture (the tabs jumped 440 px on the tap that folded them; it is
     pinned to the bottom now), a first press of a held arrow that never buzzed, an O Matic keycap that stayed enabled with no
     emulator, and the sheet counting the notch's right inset twice (keys 36 px wide at 932x430 with 59 px insets).
   - **Hosting phone, two peers** (the host a 393x852 phone emulation, the spectator a desktop browser, the public nostr relays,
     which the earlier phases' sandbox could not reach): the spectator's video was 640x480 and advancing for 248 s, a deck press
     on the host (Enter) changed the spectator's picture, a spectator chat message made the host's Chat tab show 1 unread, and
     opening it docked the chat above the taskbar with the host's picture rectangle unchanged.
   - **What the review of the first cut found, measured and fixed** (headless Chrome 143, the same harness, now with an overlap
     assertion in `deck.mjs layout` and a `scroll` mode): (1) **The band threshold was wrong.** `DECK.MIN_BAND_HEIGHT` was 150
     but Táticas needs ~220 px of band for its two rows of formation keys to be 44 px: a 360x640 phone in a Chrome tab (~512 tall,
     186 px of band) got 32 px keys, an iPhone SE in a Safari tab (216 px) 42 px. It is 225 now, and those windows get the launcher,
     whose panels scroll at 48 px rows; a spec derives the 44 px row from the constant so it cannot drift. (2) **"Mais teclas"
     collapsed into overlapping rows whenever its panel was shorter than its 256 px** (375x553 in the sheet, 667x340, 667x320,
     852x340, 800x290 in landscape): the scroll panel's children shrank, the 44 px rows overflowed their boxes and the bottom row
     (`Num *`, O Matic, Sair) sat on the F-key rows. `flex-shrink: 0`; the harness fails with the rule undone and passes with it, at
     all 20 viewports. (3) **A hold or a drag inside a scrolling panel was cancelled by the browser.** `touch-action` stops
     intersecting at the nearest scroll container, so the deck's `none` never reached the keys and the panel's `pan-y` did: a held
     arrow in the sheet stopped after 5 presses and one `pointercancel` when the thumb drifted 40 px, and a drag that began on
     Apagar or Del typed a key and then scrolled. Keys that press on landing now carry `touch-action: none` themselves
     (`.deck-key--landing`): the same drift gave 19 presses and no cancel, a drag from Del typed and did not scroll, a drag from
     Home (presses on release) scrolled the panel and typed nothing. (4) The Backspace keycap is the word "Apagar", not an icon
     that only a panel nobody has opened would ever fetch (the offline icon cache fills on first use). (5) "Vibração ao tocar nas
     teclas" was cut to "Vibração ao tocar nas te…" in the options menu on a phone; it reads "Vibração nas teclas" now. (6) The
     folded dock is 60 px, not 58: `--deck-taskbar-h` counts the band's own 2 px seam, so the chat's lift under the OS keyboard
     matches the layout it compensates. (7) The decision-D3 promise was overstated: the Win9x skin is `.deck-key` and `.deck-face`
     in `_win9x.scss` **plus** a few seams and the sheet's title bar in `_deck.scss`, and the docs now say so and how to find them.
     Stale text fixed: `GamePage.sendKey` (gone) in CLAUDE.md, js-dos's virtual keyboard in the touch-layer paragraph, the latch's
     docblock (a panel switch keeps a latch on purpose) and the README's feature list.
   Where it differs from the plan above, on evidence or by decision: **Texto is a taskbar button, not a panel** (it opens the
   P1 dialog; the live bar is P8's, behind a flag). **No separate type of state for hiding it**: "Mostrar painel de teclas" has
   three answers (Automático / Sempre mostrar / Nunca mostrar) so the player can hide the deck on a tablet and force it on a laptop.
   **Tablets follow the shape**: portrait gets the band, landscape the launcher (a landscape tablet has no band; compared on
   screenshots at 820x1180, 768x1024, 1180x820, 1024x768 and 1280x800). **Landscape phones get a launcher, not rails** (that is
   P12): a column in the left gutter holds the room pill, a round options button and "Teclas"; the sheet covers the left part of the
   picture while it is open. **D12 (chat replaces the right rail in landscape) is not done**: landscape keeps today's right-edge chat
   handle and docked panel, and the short-landscape placement of that handle (top of the right edge) was kept because the spectator
   page shares it. **`isMobile` stays, for modal content only**; the page's layout reads the shape and `(pointer: coarse)`. The
   O Matic lives in the options menu and in "Mais" (two places), "Input de Texto" in the menu and the Texto tab (two), and
   leaving the game only in the menu. **Found on the way, not fixed:** (1) Elifoot answers "Nome do ficheiro inválido" to a game
   name with an accented letter ("ZÉ"), although P1's dialog types it faithfully: the 8-letter name field takes only plain
   letters, so P1's note that it "accepts the accents" is true of typing and false of saving; a hint in the Texto dialog or a
   fold for that one field is a P8 question. (2) Esc does nothing on the Registo dialog (only its Cancelar closes it). (3) The keypad
   `*` had no visible effect on the squad-selection screen; where the "craque" search is reached was not found. (4) Esc and Enter
   are one tap each on the hazard CLAUDE.md describes (Enter on the first dialog before a choice quits the game), reproduced
   by accident while driving it; P5's recovery brought the game back every time. **Not verified:** any phone or finger, haptics,
   iOS Safari, the real safe areas, the OS keyboard over the chat, TalkBack/VoiceOver, a low-end CPU, and what `*` and `-` do in
   the game beyond the owner's word. The checklist for the device pass is in the PR.
10. **P8 — live type bar**, behind a flag (decision D7: the compose dialog stays the default and the owner decides after the
    device pass). **As built:** `app-type-bar` (a real one-line field above the OS keyboard, opened by the deck's Texto button
    only when "Teclado ao vivo (experimental)" is on, `STORAGE_KEY.LIVE_KEYBOARD`, off by default), the pure `TypeMirror` (the diff
    of the field's value against what the guest holds, over code points), `TypeKeyHelper`, `TypeBarSession` (the field's events
    wired to the mirror and the key queue), `TypeBarLayoutHelper`, and for the shortcut hazard a field hint: `CaretWatcher`,
    `IBeamHelper`, `FieldHintHelper` and `FieldHintService`. `GuestKeyQueueService.send()` takes planned tasks as one submission;
    `KeyboardInsetService.inset$`; `TouchInputService.clicks$` and `TouchSurface.keepFocus`. 152 new specs (nine new spec files and five cases in the touch layer's; the suite is
    1077), including scripted IME sequences against a real `<input>` and real 640x480 frames of the guest. The contract and the
    rules are in CLAUDE.md, *The live type bar*. Measured in headless Chrome 143 (chrome-headless-shell, touch emulation,
    393x852 unless noted) against the dev server and the real game, with **synthetic IME events** (CDP `Input.imeSetComposition`,
    `insertText`, `dispatchKeyEvent`) and a keyboard **simulated** by shrinking `visualViewport.height` and telling the real
    `KeyboardInsetService`:
    - **It types into the real game.** In the Jogadores dialog (the coach names) a committed "João" came out as `J o Alt+0227 o`
      and the field read "João"; a composition `F`, `Fe`, `Feli`, `Felipao`, `Felipe` sent NOTHING until the commit and then
      `F e l i p e` once; "Silva" then a space then a keydown Backspace sent only `S i l v a` (the space is held back; taking it back
      sends nothing), and " Jr" sent the space with it ("Silva Jr" in field 3). A strip Enter moved to the next field and cleared the
      bar with the focus still in it. Backspace in a field with text sent ONE guest Backspace (keydown and input would have been two);
      in the empty bar it went to the guest (no `input` event exists for it), and a hardware Enter keydown sent Enter and typed nothing.
      F5, Shift+Tab, Esc and Down from the hardware path reached the game as themselves and did not reload the page or leave the field.
    - **A paste of 80 characters** is one send; "Enviando 14/80" and Cancelar appeared above the bar, Cancelar cut it after 19 keys,
      nothing more was typed in the next 2.5 s, the bar was emptied and the toast said "Envio cancelado: 19 de 80 teclas enviadas".
      A 30 character paste went out whole.
    - **The picture does not move.** Over twelve viewport and keyboard cases (393x852 with no keyboard, 250 and 336 px; 360x740 with
      310; 430x932 with 336; 375x667; 820x1180; 844x390, 667x375, 932x430 and 1180x820 in landscape) `#game-container` and the canvas
      had the same rect with the bar open, with the keyboard up, and closed; the bar's bottom was `innerHeight - inset` to the pixel;
      every key was 44x44 or more, none overlapped another or left the bar, and the field was at least 120 px wide (the 360 px one-row
      layout has 180). The full window is 190 px; the A07-like 360x740 with a 310 px keyboard and the iPhone in a Safari tab (430x932,
      336) are one row and the full window respectively, and the same iPhone installed (59 px more status bar) folds.
    - **The hazard is real.** On the main window (no field), with the badge saying "nenhum campo detectado", a typed "a" selected the
      automatic squad. By decision nothing is gated: the badge and the Texto button's cue are all there is.
    - **The hint, on the real dialog.** Caret: frames 528-600 ms apart, consecutive frames differ by one bar 1 px wide and 14 tall at
      640x480 (as at 800x600: the font fixes it, so no threshold depends on the frame size), and the hint was "campo detectado"
      2.0 s after a cold start. I-beam: the guest draws an XOR cursor, so it is blue on the focused yellow field and black on a white
      one, 17 rows with two 7 px serifs; the look took 0.2 ms, found stem 15 / serif both over a tapped field and was "no" over the
      dialog's face. A tap on the game's own field left the focus in the bar (`keepFocus`).
    - **Switching it off** unmounted the bar and stopped the hint, stored `false`, and Texto was the dialog again; the stored `true`
      survived a reload (the bar was mounted and the hint running before the first tap); destroying the view with the bar open left
      no console error and gave the focus back to the emulator; opening the chat closed the bar and the reverse (simulated room).
    Where it differs from the plan above, on evidence or by decision: **the opener is the deck's Texto button, not a new "Digitar"
    button**, and it presses on the lift in this mode. **Composition is mirrored when it ends** (plus a 700 ms settle for an IME that
    never ends one, and a flush for a strip key, a blur and closing): mirroring the middle was not shown to be safe. **The trailing
    space is held back until something follows it**, rather than filtered: it needs no guess about which spaces the keyboard added.
    **The bar clears itself after a key that moves the guest**, never in the middle of a composition. **The two frames of the caret
    check are taken at frame events** (the prototype's 290 ms apart lands both in one half of the blink half the time). **The I-beam
    needs the serif**: a stem-only test calls the arrow over a white list a field. **Landscape and a short phone fold into ONE row**
    (the keys that fit by width), where the plan said "one row or the dialog": the dialog covers the same pixels and puts its buttons
    under the keyboard. **A "Lista" key** on the strip hands over to the compose dialog. **The strip has nine keys in two rows of five**
    (the arrows and Shift+Tab are the full window's); under 400 px the one row has Tab and Enter, from 400 Esc, from 560 Backspace and
    "123". **Not done:** panning `#game-container` above the keyboard in landscape (a transform against the overlay sync, left for
    P11/P12); a fold for Elifoot's 8-letter filename field (it rejects an accented name when it SAVES, see P10's found-on-the-way);
    any real keyboard. **Not verified:** everything in CLAUDE.md's list under *The live type bar*; the checklist for the device pass
    is in the PR.
    **Changed by the review of this phase** (four reviewers, then headless Chrome 143 again on the final code with the harness's new
    `typebar.mjs moves`; `ime`, `hint` and the 108 checks of `layout` re-run and unchanged):
    - **The bar did not let go when the guest left its field.** `keepFocus` only said "I have it", the one subscriber of `clicks$` was the
      field hint, and the bar's own keys were the only thing that cleared it, so after "Felipe" a tap on Jogador 2 left "Felipe" in the bar
      and the next "Silva" read "FelipeSilva" over a field holding "Silva"; Backspaces past what was typed there deleted text the bar never
      wrote. A strip key pressed while a word was still underlined was worse: the clear waited for a composition that nothing ended (a
      keyboard that keeps a word underlined until a space does not end it for a tap on a keycap), and the first cut's spec locked that in.
      Now `TypeBarSession.abandon` runs for a key that moves the guest, a finger that lands on the game (at `keepFocus`, before the click,
      with a flush so a word being composed goes to the field it was for) and a key sent from elsewhere (`GuestKeyQueueService.activity$`,
      which fires inside the submission, so the bar's own sends are told apart by a flag; no flush there, the guest has already moved). It ends a
      composition by blurring and focusing the field inside the gesture, ignoring what the browser commits on the way, and never writes the
      value of a field the IME is composing in (the strip's Backspace ends the composition first too). Measured with CDP `imeSetComposition`:
      "Felipe", a tap on Jogador 2 and "Silva" gave Felipe / Silva with the bar reading Silva; a deck Tab then "Costa" gave Costa alone in
      Jogador 3; "Leu" composed and the strip's Tab gave L e u + Tab, an empty bar, the focus still in it, and "Ze" alone in Jogador 5; "Ab"
      composed and the strip's Backspace gave A, b, ONE Backspace and "A". **Whether a real keyboard stays open through that blur and focus
      is the one new thing on the device checklist.**
    - **A pasted Tab (or U+2028/2029, or a backspace character) pressed the key.** `<input type=text>` strips only CR and LF, and the
      planner turned the rest into Tab and Enter behind a mirror that believed it was one field. They are spaces now (a trailing one held
      back): "Zé", Tab, "Silva" sent Z, the accent, Space and S i l v a, and Jogador 1 read "FelipeZé Silva".
    - **Closing the bar in the middle of a paste left the queue typing with no Cancelar.** Closing now cancels the rest and says so (an 80
      character paste closed after 15 keys typed nothing more).
    - **`KeyboardInsetService` told `inset$` before it wrote `--kb-inset`**, so the type bar's `bar layout` log line measured the previous
      inset's rect: the numbers the device pass reads to decide whether iOS pushed the bar off-screen would have been one step behind.
      Reversed (a spec pins the order); measured at 336 px after 250 px the line reads bottom 516 on an 852 px page, which is the new inset's rect (by construction the old order would have read 602, the previous one's; the old code was not run).
    - **The CapsLock guard re-armed every 15 s of continuous typing**, a read in the middle of a word on a slow phone, against the
      documented "after silence". The clock is now the last send of letters (a pure rule in the session, with a fake clock in its specs).
    - **Smaller:** the FAQ said Esc sits beside the field, and the one-row layout has no Esc under 400 px (the field must stay 120 px
      wide); it now says the keys shown are the ones that fit. Mutation-checked: seven deliberate breaks of the new rules (the deferred
      clear on a strip key, the blur sync not suppressed, the caps clock, the inset order, the control characters, the flush on a touch,
      the Backspace writing over a composition) each fail at least one spec.
    **Dismissed or left, with reasons:** a click can still land before keys that are still queued (the pointer engine and the key
      queue are separate serial queues): it takes a long paste on a slow phone, a paste shows its progress, and the fix is an ordering gate
      inside `GuestPointer`, which is the P2 engine's hot path and not this phase's to change; it is in CLAUDE.md as known, and on the
      checklist. The bar's `maxlength` of 300 against Elifoot's shorter fields is documented as an assumption (nothing knows a field's
      limit) and put on the checklist. Esc under 400 px is a layout decision with a cost either way and stays.
11. **P9 — idle pause**, behind a setting that is **off by default** (decision D6: the duty-cycle probe, not while hosting; the recommendation
    of "on by default" is the one thing not followed, on evidence). **As built:** `EmulatorPowerService` (`start(dosCI, options)`, `stop()`,
    `wake(reason)`, `hold(reason)`), the pure `IdlePowerMachine` (the rule: no clock, no timer, no emulator), `EmulatorPowerHelper` (the setting
    and the blockers), `GuestAccessHelper` (the door for code that is not the service), `EMULATOR_POWER` in `constants.ts`,
    `STORAGE_KEY.IDLE_PAUSE`, the menu's "Economizar bateria quando parado" and a FAQ entry, a `power` category in the diagnostics log
    (the state indicator the roadmap asked for), `GuestPointerOptions.beforeSend`, `TouchInputService.busy`,
    `GameExitWatcherService.gameSeen`, `SaveSafetyService.gameSavingVerdict()`, `saveGameFileSystem()` holding the guest through the
    global `holdGuestAwake`, and `scripts/touch-harness/idle-pause.mjs`. 122 new specs (the suite is 1199, from 1077), among them the state machine
    driven by a script of (time, event) calls, the service over the real `document` listeners and a recording emulator under `fakeAsync`,
    and the guarantee that every path wakes first (the key queue, the pointer engine, the touch layer's surface, the O Matic, the door).
    The contract is in CLAUDE.md, *Letting the guest sleep*. Measured in headless Chrome 143 (chrome-headless-shell) on Apple silicon
    against the dev server and the real game at 640x480, auto-save on with the real OCR, synthetic input:
    - **CPU on a still screen** (the busiest renderer process over 20 s): off 101.7-102.0%, the probe 14.6-14.9% (the roadmap's lab page:
      14.6%), a hard pause 2.9-3.1% (the lab page's 1% plus this app's own looks, the auto-saver's screenshot every 300 ms and the exit
      watcher's every second). The same on the shipped 20 s idle time: it falls asleep within 24.5 s and reads 14.8-14.9%.
    - **The roadmap's rule slows the game down, and that is the answer to the critic's warning.** Elifoot spends whole seconds with the picture
      untouched while it works, and a guest put to sleep in the middle of that finishes at the probe's duty cycle, about a ninth of its
      speed. Played through the real app (a person's rhythm: Enter on every new screen, the injury and penalty pickers answered, the auction
      skipped; gaps measured between js-dos `onFrame` events), with the saver flipped every round inside one game: **idle time 1.5 s,
      learning off** (4 rounds ON, 4 OFF): a round took 236 s on average against 133 s, the longest
      gap between frames was 61 s against 10 s, 13 gaps over 5 s against 4, and the emulator's process ran at 59% against 102%, with 51
      sleeps; **idle time 2 s, learning off** (an earlier run: 3 rounds ON, then 3 OFF of the same game): 177-209 s against 117-161 s,
      longest gap 52 s, 63-69% CPU. The silent stretches the game makes on this desktop, OFF: 2.8 to 4.9 s here and there, a 6 to 7.4 s one
      two seconds after the key that starts a round, and a 9.3 to 10.3 s one 38 s after the last key (the end of the match). A guest asleep
      at the start of the last one takes about a minute to finish it.
    - **Hence 20 s.** The idle time is twice the longest gap seen. Played the same way, 16 rounds in a pseudo-random order (8 ON, 8 OFF),
      and three alternations of 4 + 4 before it (one starting with the setting off): **0 sleeps** in play, the longest gap 10.1 to 10.3 s ON
      and 9.9 to 10.3 s OFF, the same two kinds of gap over 5 s in both, 102.2% of a core in both. Wall time per round varies about 2x with
      its content (an injury, a shootout or an auction), so alternating single rounds misleads: the three short runs had the ON rounds 17 to
      25% longer, with 6 to 36% more frames in them, and the balanced run had them 9% shorter (112 s against 123 s). A saver that does not sleep
      costs a 250 ms timer and a few listeners. That it does sleep a still screen on the shipped number is the CPU line above: asleep
      within 24.5 s, 14.8%.
    - **A frame from a guest that was asleep is a stall, and the machine learns from it:** the idle time grows to twice the quiet stretch that
      ended, up to 120 s, so the first stall on a slow device costs one stretched computation and not one per round. With the roadmap's 2 s
      and the learning on (4 rounds ON, 4 OFF): exactly one stall, in the first ON round (the 6 s stretch two seconds after the key that starts
      a round became 11.8 s, 6 s asleep, 3 probes), and the three ON rounds after it never slept and had the OFF rounds' gaps (10.1, 10.2 and
      9.8 s against 10.3, 9.3, 9.8 and 9.7 s); 114 s a round ON against 122 s OFF. A page that is reloaded starts again from the constant.
    - **Input to a sleeping guest** (`idle-pause.mjs wake`; the saver given 1.5 s to put the guest to sleep before every send): 24 taps
      landed within 1 px, exactly as the 24 awake ones of the control did (0 / 1 / 2 px: 12 / 12 / 0 in both), the engine's own idea of the
      cursor off by 0 on every one, each tap costing exactly one resume; a longer run of 40 taps with the same seeds gave the same errors to
      the pixel awake and asleep; 30 first taps after the model forgot the cursor (home, then walk) left it 2 px off in 1 case asleep and 2
      awake (that is the guest's 2 px quantum, P2); six arrow keys changed the screen exactly as awake; ten digits through the key queue were
      ten presses and ten releases, one resume, 1 ms before the first key event, never more than one event without a gap and 10 ms between
      groups. The cursor first moved a median 14 ms (max 20) after a finger landed on a sleeping guest and 14 ms (max 22) on an awake one
      (in 1 of 20 asleep trials the poller saw no movement; see below).
    - **The game's save dialog.** With the idle time cut to 150 ms, on the first kickoff of a new game the service asked about the dialog the
      moment it was up (`not sleeping: save dialog up`), the auto-saver saw it appear and go (1.0 s) and persisted after it, and the save is on
      the disk; in one of the two runs the guest had gone to sleep before the flush and the flush woke it (`awake: persist`).
    - **A hidden page** (the property overridden and `visibilitychange` dispatched, because CDP delivers no lifecycle event): js-dos paused the
      emulator (2% CPU), the service ran no probe, a key sent meanwhile did not resume it, and when the page was shown the guest was awake
      (100.8%), with a fresh idle time, and asleep again after it (12.9%).
    - **Auto-save off** (the look cannot tell): in 48 s the guest was never put to sleep (0 sleeps, 100.9% CPU) and it asked 7 times, at 1.0,
      2.3, 4.0, 8.0, 15 and 15 s apart; with auto-save back on it slept within 4 s of the next look.
    - **Sound:** no pause landed within 300 ms of a loud chunk in any run (0 of 51 sleeps in the 1.5 s run). The game does play sound in
      stretches without frames (about a second of crowd noise inside a 1.5 to 5 s gap, once 288 ms of loud chunks inside a 27 s one), and it
      ends long before 20 s. Whether a sound can be cut on a phone, and whether it comes back after a wake, is on the device checklist.
    Where it differs from the plan above, on evidence or by decision: **the idle time is 20 s, not 2 s** (above); **the default is off**
    (the same evidence, and D9: the feature is for a phone and everything above is a desktop); **sleeping is a handshake** (the machine asks
    whether the game's save dialog is up and sleeps only on a definite no; a static dialog is what a slow save looks like to a frame counter),
    which the plan expressed as "AutoSaver is not mid-save" and which makes the feature inert with auto-save off, said in the menu;
    **a persist holds the guest awake** through one global registered by the service (the update prompt lives in the main bundle and cannot
    import it); **the learning** and the **doubling of an unreadable look** are additions; hosting is excluded outright, as the plan said.
    **Found on the way, not fixed:** twice, on the first tap of a script run, the cursor had not moved when it was read (300 ms after the
    finger lifted, in the first run of `wake`; and the poller of a latency check saw no movement in one of 20 trials); the next tap was
    exact each time, and neither came back in 12 first taps after a fresh sleep, 30 homing taps and about 150 more taps. A game that has
    just finished a round is silent for seconds, so a first send that waits behind it is the likelier cause than the wake, but it is not shown; the retuned numbers of a scratch script
    survived in the service singleton and turned a "20 s" season into a 1.5 s one (the harness README's trap 11; every mode now starts from
    and returns to `defaults()`). **Not verified:** any phone (the Galaxy A07 above all: its silent stretches, the probe's cost on a slow
    core, battery and heat), iOS Safari's worker, a real hidden tab, a screen lock, a long sound, hosting with the saver on (excluded by
    rule, not run), the O Matic against a sleeping guest in the browser (specced with a fake). **Left for a follow-up:** the auto-saver (every 300 ms) and the
    exit watcher (every second) keep taking screenshots of a framebuffer that cannot change while the guest sleeps, which is about two of the hard
    pause's three points here and a cost that grows on a slow core where the probe's fixed duty cycle does not; a cheap `asleep` getter for them to
    consult is the fix, and the A07 reading of the worker plus main thread, asleep, auto-save on against off, says whether it is worth doing.
    The checklist for the device pass is in the PR.
12. **P14 — mobile platform polish: screen lock, fullscreen, sound, install, storage** (decisions D4 and D10). **As built:** `WakeLockService` ("Manter a tela
    ligada", on by default, a room overrides it, the spectator page holds the screen too), `FullscreenService` ("Tela cheia" and the landscape lock that goes with it),
    `AudioHealthService` + the "Ativar som" chip + the volume slider, "Silenciar o jogo" and "Som no modo silencioso", `InstallService` (main bundle) + the iOS how-to
    dialog + the "Instalar o app" entry, `NudgeStateService` (the install banner and the "Gire o aparelho" hint, once each, at most one per page load),
    `StorageHealthService` (the "Armazenamento" line), the manifest and `index.html` clean-up with two maskable icons made by `scripts/pwa-icons/make-maskable.mjs`, six pure
    helpers, six new `STORAGE_KEY`s, a `platform` diagnostics category, three FAQ entries, 12 new spec files (192 new cases, the suite is 1,391 from 1,199; 13 deliberate breaks
    of the new rules each failed at least one case when the phase was built, before review removed the unused nudge-ordering helper) and `scripts/platform-harness/`. The contract is in CLAUDE.md, *Mobile platform polish*.
    Measured in headless Chrome 143 (chrome-headless-shell, touch emulation, 393x852 unless noted) against the dev server, **with the APIs the shell lacks or refuses
    faked** (the harness README lists them and the traps):
    - **Wake lock.** With a fake `navigator.wakeLock`: asked once when the game came up; the menu switch (a real tap) let it go and stored an explicit `false`, and
      switching on asked again; a hidden page was not asked, the page returning was; a lock taken back while visible was asked for once more, a battery-saver refusal
      was not retried (no new request in 3 s), a tap right after it did not ask, the page returning did and was granted. A real host (`startHosting`, no peer needed)
      held the screen with the switch OFF and let go when the room closed; `leaveGameToMenu` released before the reload; the spectator page held it from the moment
      a room existed, let go when it was gone (also on the `HOST_LEFT` path) and when the page was left. The real API was refused in the shell ("Wake Lock permission request
      denied"), and the page said so in the menu.
    - **Fullscreen**, with the real API (the shell grants it): a real tap on the entry made `document.documentElement` fullscreen, locked the orientation to landscape (the
      screen's type changed to `landscape-primary`), and the exit unlocked it. After a viewport change to 852x393 the container, the canvas (524x393 at x = 164) and the
      cursor overlay of a live room agreed to the pixel; leaving fullscreen brought the portrait rectangle back exactly. **Found on the way, fixed:** the first cut of
      `InstallHelper.isStandalone` also asked `(display-mode: fullscreen)`, which matches the Fullscreen API too, so pressing "Tela cheia" in a tab switched the install mode
      to `installed` and took the entry away until the player left.
    - **Sound.** With the context's state forced (`interrupted`, a resume that never answers, as WebKit does without a gesture): the page asked for a resume when it came back,
      no chip for the 1.2 s grace, then the chip; a tap on the chip resumed inside the tap and removed it; a tap anywhere on the game did the same through the page's gesture
      listener; a hidden page showed no chip and asked for nothing. The chip is 54x44 and the speaker alone under 600 px; with a live room at 360 and 402 px the pill was 159 px
      wide and not clipped; at 844x390 it is a 44 px round button in the gutter, left of the picture. **Volume:** a tap in the middle of the slider set 50% and js-dos's gain
      was written 0.5, "Silenciar" wrote 0 and left the slider where it was, the slider unmuted, a reload came back muted with the slider at 30 and the gain 0, and the wipe removed
      `emulators.ui.volume`. **Not measured:** the level of the spectators' stream while the host is muted. The shell has no audio device, the context suspends itself a few seconds
      after it runs and its clock does not advance (`currentTime` 0.0058), so nothing is pulled through the graph; what was observed is that `capture()` connects exactly one node,
      the stream destination, to the script processor itself, which is the node js-dos puts BEFORE its gain.
    - **Install.** With a fake `beforeinstallprompt`: the first visit (a phone upright) showed the rotate hint and no install banner; the menu entry called the prompt once and
      the spent prompt took the entry away; after a session that saved something, the second visit showed the stacked banner ("Agora não" / "Instalar"), its button called the
      prompt from the tap, and a third visit showed nothing at all; "Agora não" answered it too. On an iPhone user agent (with the Fullscreen API hidden and `audioSession`
      faked): no "Tela cheia", the entry reads "Adicionar à Tela de Início", the dialog is a `win9x-alert` with the storage warning and a button to the export, the banner's
      button reads "Como instalar" and opens it, and the dialog fits a 932x430 phone (buttons inside the box). An installed app (`navigator.standalone`) is offered nothing.
    - **Manifest.** Chrome reads it with no errors and no installability errors; `id`, `lang`, the colours, `scope`, `start_url` as intended and no `orientation` or
      `display_override`; the maskable icon's lettering lies inside the 40% circle (0.387 of the width at its farthest; the old icon cut under a circular mask), seen
      under a circle, a squircle and a square. `Page.getAppId` answers nothing in the shell, so the app id Chrome resolves for an installed copy could not be compared.
    - **Rotate hint.** Shown once on a portrait phone, dismissed by turning the phone (and counted as shown), not shown on the next visit, not on a landscape phone or on a tablet.
    Where it differs from the plan, on evidence or by decision: **the chip is shell and flat** (as asked), in the toolbar's end slot and not the title slot; **the
    wake-lock default is a constant, not a literal**; **the spectator page holds the screen with no setting** (it has no menu; the roadmap listed the file); **"Tela
    cheia" takes the landscape lock as part of its own action, without a separate setting** (the entry's words say so; a lock the manifest or the app took unasked is what D4
    rejected); **`contentHint` is not set**: measured, it trades fps for resolution under a weak link (`detail` 640x480 at 5-6 fps against `motion` 320x240 at 12 fps at
    120 kbps), a call about every spectator's picture that no two-device session has informed; **the icon list was not pruned** (the Windows tile sizes are Edge's, and the plan
    asked only for the maskable icon and the fields); the audio chip does not wait for the game to make sound (a context that Chrome suspends by itself in a device-less environment
    would make the chip flicker there, but not on a device with an output, which is on the checklist). **Found on the way, not fixed:** the "Sala … no ar" toast of
    `MultiplayerUiService.showRoomCreated` squeezes its text into a column one letter wide at 360 px (three buttons beside the sentence: the same problem the backup reminder
    and this phase's banner solved with a dialog and `layout: 'stacked'`); the landing page has no install offer; the harness's `Page.addScriptToEvaluateOnNewDocument` scripts
    outlive the process that registered them and had made later runs "installed apps" until `boot()` learned to forget them. **Not verified:** any phone, iOS Safari in any form,
    a real lock, a call, a Bluetooth change, an installed app, a real launcher, a low-end CPU. The checklist for the device pass is in the PR.
    **Changed in review:** `InstallHelper.isStandalone` no longer reads the `android-app://` referrer (it marks a trusted web activity, which this app is not, and Chrome
    on Android also sets it on an ordinary tab opened from the Google app, Gmail or a messenger, for the life of the document: the install offer was hidden from exactly
    the people arriving by a link); `NudgeHelper.next`/`ORDER`/`NudgeKind` were removed (nothing ran them: the order is the call order in `GamePage.maybeNudge`, and a
    spec on a list nothing read guarded nothing); the host's "Volume do jogo" subtitle stops saying that spectators keep hearing the game while "Enviar o som do jogo aos
    espectadores" is off. None of the three changes touched what the browser pass measured.
13. Then P11 (zoom/pan camera), P12 (stage layout, landscape
    rails, spectator parity — re-run the multiplayer harness), P13 (menu IA, first-run coach),
    P15 (desktop mouse, gamepad).

Also add early: a **debug-only diagnostics flag** (pointer/touch/key/IME events plus frame timing,
exportable from a phone) to feed the device pass, and decide whether specs are real. **T0 made
them runnable** (`npm run test:ci`, a `ChromeHeadlessCI` launcher, and the first spec for
`RoomCodeHelper`), but CI still runs no tests or lint, so specs gate a PR only once a
ChromeHeadless job is added to the workflows (the owner's call).

**DIAG (the diagnostics flag) — as built.** `DiagnosticsService` plus a Win9x "Diagnóstico" window
reachable from the options menu; `?diag=1` turns it on for a tab's session. Off, a `log()` is one
boolean check; on, a 5000-entry ring buffer of `{t, w, cat, msg, data?}`. Hooked: the key queue
(enqueue, start, flush with timings, cancel, fail), the boot stages, the OCR worker lifecycle and each
saving verdict, every persist with its duration, and the update flow. Pointer, touch and IME are not
hooked: P2, P8, P9 and P11 log into it (P2 and P8 now do). CLAUDE.md has the design and its invariants; what was measured,
headless Chrome 143 with touch emulation at 390x844, 844x390 and 1280x800, against the dev server:
- **Zero cost off.** After a fresh load of `/#/game` no `error`, `unhandledrejection`, `pagehide`,
  `pageshow`, `orientationchange` or `freeze` listener exists on the page; switching on adds all of them
  (and one `visualViewport` resize), switching off removes every one. Counted through zone.js's task
  lists: DevTools shows one native listener per type under zone.js, so it cannot see these.
- **The window events do not see Angular's errors.** An error thrown in the Angular zone, and three
  of four unhandled rejections (everything but a native `async` function's), never reached a window
  listener. `DiagnosticsErrorHandler` (provided in `AppModule`) logs them; the window listeners still
  catch an error from outside the zone and a native rejection.
- **`?diag=1` is stripped from the address** by the router's first `replaceState` (the `<base href="/">`
  resolves `#/game` against the base), so a reload would have come back with the log off. It is kept
  in `sessionStorage`: a real reload kept it, `?diag=0` kept it off across a reload, and turning the
  log on in the window clears the override and persists the choice. A `?diag=1` visit stores no choice
  but does write the log's tail, which stays until "Limpar", switching off or "Apagar todos os dados"
  (the first docblock said a link "leaves no trace"; review caught that it was false, and the text, not
  the behaviour, was changed, because the tail is the evidence of an eviction of that same tab).
- **A reload lost the tail when only IndexedDB held it:** the previous page ended at its last interval
  write, `pagehide` never landed. With the extra synchronous `localStorage` copy the next page's
  "página anterior" ended `…ocr:recognize, page:pagehide, page:visibilitychange`. Chrome's own
  `Page.setWebLifecycleState` frozen/active produced `visibilitychange hidden`, `freeze`, `resume`.
- **A bug the measurement found:** the first version logged every js-dos loading line while unpacking
  (the file name in "Extracting 91% (EGA80WOA.FON)" changes each time): hundreds of entries for one
  boot from the cache. It is now one line per phase and ten percent (15 for a boot).
- **What the log showed on a desktop, as a baseline for the phone:** a chord took 22.4 ms against 20
  expected from the 10 ms pacing, a `Zé` text 133 ms against 120; the OCR worker was ready 68-72 ms
  after its start (stand-in CDN), a recognition pass took 9-51 ms; the game screen was detected 3.5-4.0
  s after the emulator was ready at 640x480.
- **The window:** every button is 44px under `(pointer: coarse)` (and, being `.win9x-button--touch`,
  on a mouse), the close button 48x48, the category select and the switch 44px, the checkbox 24px;
  at 390x844 the window fills the screen with no page scroll and the buttons sit in the bottom 120px.
  Copy wrote the whole report to the clipboard (8.3 KB at that point: header, previous page, this
  page), download produced the same text as a file, share was exercised against a stand-in
  `navigator.share` and received one `.txt` file and a title; "Limpar" asks first (a `win9x-alert`),
  "Apagar todos os dados" leaves neither the stored flag nor either copy of the tail.
Deviations: the category `page` was added to the plan's list; the report carries a `w` (wall-clock)
field on every entry because `performance.now()` does not advance while a page is suspended; the
`ErrorHandler`, the tab-session switch, the second copy of the tail and a bottom "Fechar" button were
not in the spec and exist for the reasons above. **Not verified:** any phone, a real share sheet or
`navigator.clipboard` on iOS, whether an iOS eviction leaves a `visibilitychange` line, the window with
a real soft keyboard, and the 5 s write cost on a low-end CPU (the write is a `JSON.stringify` of up to
1000 entries, about 100 KB, on the main thread).

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
  window (P6) and the claims of P9: the probe costs about 15% of a core on a desktop (a fixed
  250 ms in every 2.25 s, so about the same share on a slower core, which has less to run it with),
  and the 20 s idle time rests on silent stretches of up to 10 s that a phone may stretch several times.
- ~~OCR at 640x480 is proven only on a pasted frame~~ Closed by P4: measured on real saves in the
  running game, see item 7.
- Offline start was inferred from ngsw semantics and never run.
- Alt codes were not tried in the 8-letter filename field, the team editor, password dialogs or
  numeric price fields.
- ~~Several settings come from multiple phases (touch mode, idle pause, dock side, type-bar flag,
  resolution flag, view mode, last-saved time) and only P5 mentions clearing them in
  `clearAllData`; there is no flag registry.~~ Closed by P5: `STORAGE_KEY_HOMES` says where each key lives
  (a key added without a home does not compile), `clearAllData` derives its `localStorage` removals from it, and
  `storage-keys.spec.ts` fails if the wipe leaves any key standing. Every key the mobile work added
  (touch mode, diagnostics and its log, last/first persist, last backup, the nudge) was already wiped, because Ionic
  Storage is emptied wholesale; the real gap was the second copy of the diagnostics log in `localStorage`, which was
  hard-coded and is now derived. The resolution flag is a file in the layer and goes with the IndexedDB wipe.
