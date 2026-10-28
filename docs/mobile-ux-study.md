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
- ~~OCR at 640x480 is proven only on a pasted frame~~ Closed by P4: measured on real saves in the
  running game, see item 7.
- Offline start was inferred from ngsw semantics and never run.
- Alt codes were not tried in the 8-letter filename field, the team editor, password dialogs or
  numeric price fields.
- Several settings come from multiple phases (touch mode, idle pause, dock side, type-bar flag,
  resolution flag, view mode, last-saved time) and only P5 mentions clearing them in
  `clearAllData`; there is no flag registry.
