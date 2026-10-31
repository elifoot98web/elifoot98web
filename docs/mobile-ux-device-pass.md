# Mobile UX device pass

What only real phones can confirm. Everything in the mobile UX refactor was built and measured in **headless Chromium
with synthetic input on a desktop CPU**; nothing here has been tried on iOS Safari, on a real finger, on a real IME or on
a phone CPU. The checklist is generated from the per-phase `deviceChecklist` lists (175 items), ordered by how much a failure would matter.

Devices: **Galaxy A07** (low-end Android, Chrome; try Gboard and, if present, Samsung Keyboard) and **iPhone 15 Pro Max**
(430x932 CSS px; Safari in a tab AND the installed home-screen app, which have separate storage). A default-UA iPad and a
Bluetooth keyboard are worth a few minutes if you have them.

## Before you start

- **Turn on the diagnostics log first** (options menu > "Dados e avançado" > "Diagnóstico", or open the app with `?diag=1`, also accepted as `#/game?diag=1`), reproduce the
  problem, then use Compartilhar / Baixar in the panel. The log holds pointer, touch, key, IME, frame, boot, save and
  power events with timestamps and an environment header; it stays on the device unless you share it, and it can contain
  typed text. Attach the export to any failure below.
- **Getting the build onto the phones** (not verified by the agents): opening a PR gives a Firebase preview channel
  (see CLAUDE.md, CI / release), which is HTTPS and therefore the only route that exercises the service worker, wake lock,
  share, clipboard and install. A LAN `ng serve --host 0.0.0.0` is plain HTTP: fine for touch/layout/typing, not for those
  APIs. On Android, `adb reverse tcp:4200 tcp:4200` makes localhost count as a secure context.
- The experimental settings ("Teclado ao vivo (experimental)", "Zoom e movimento", "Economizar bateria quando parado") are
  OFF by default by design and live in "Dados e avançado"; flip them on for their sections. The touch model defaults to **Direto** with **Modo touchpad (clássico)** as the fallback.

## Known unverified

- **P2:** on any device: every number touching a finger, a phone's CPU or iOS is recalled or desktop-synthetic (headless Chromium, CDP touches). Real fingers err by about 25-40 css px (recalled), so tapSlop 10 px, hold 450 ms, aim offset 56 px, double-tap 400 ms / 32 px and palm radius 48 px are untested where they matter.
- **P10:** the only change that touches the chat under the OS keyboard is --deck-taskbar-h going from key+10 to key+12 (the folded dock measures 60 px and equals var(--deck-taskbar-total)). The lift itself was not re-run with a real keyboard (headless has none).
- **P11:** the changed menu copy and toast were checked through the page's getters and toast message in the browser, but the rendered menu text wrapping at 360 px was not screenshot after the change.
- **P5:** in a browser: the bounded persist (the 30 s timeout is covered by fakeAsync specs only, not provoked against a hung IndexedDB), the hosting-only beforeunload prompt, the update prompt's wait for a game save in progress, and 'Reiniciar jogo' leaving a live room (no relay in the sandbox).
- **P5:** on any device: iOS Safari behaviour of navigator.share, navigator.storage.persist(), tab eviction, beforeunload and the left-edge swipe; the Android Back button and an installed PWA's history stack (the Back test was history.back() in headless Chrome); the page-hidden save finishing before a phone freezes the tab.
- **P5:** the late-armed exit watcher was driven in the browser by setting gameDetected = false and calling the page's own startSafetyNets(); a boot that really overruns the 45 s window was not reproduced.

## Checklist

### P2 - Direct touch (tap lands under the finger)  (`fa279bc`)

- [ ] Tap accuracy on tiny targets on BOTH the Galaxy A07 and the iPhone 15 Pro Max, portrait and landscape: 20 taps each on the 6 px radio buttons of the new-game dialog and on the 8 px scrollbar thumb of the country list, then 20 in aim mode (hold ~0.5 s, cursor above the finger, release). Record the miss distance; it sets the thresholds. The ring and the cursor must both be visible.
- [ ] Aim mode and drag thresholds with a real finger: does a deliberate tap ever become a drag (jitter over 10 css px) or aim mode (held a bit long)? Is 56 px the right offset, does the cursor clamp sensibly at the top edge, is 450 ms right? Hold still for 2 s in aim mode after a long session of taps (more than 12 moves): the cursor must NOT fly to the corner (new setFingerDown guard). Try HOLD_MODE 'none' via retune if aim mode annoys.
- [ ] Double tap on a list row selects; two taps 900 ms apart toggle; two quick taps on ADJACENT rows (squad list, country list) must NOT read as a double-tap on the first. If they do, shorten DOUBLE_TAP_MS or the slop. Also tap twice fast with two thumbs: both clicks must land (the lost-pointerup race fix is verified only with synthetic CDP touches).
- [ ] Send spacing on the low-end phone: turn Diagnóstico on, tap and drag for a minute and read the 'pointer move' entries' minGapMs and maxGapMs and any tap that lands far from the finger or travels double. If sends are summed raise SEND_SPACING_MS (24 -> 32 -> 40) and re-check on the harness.
- [ ] Latency, CPU and heat on the Galaxy A07: does the cursor keep up with a dragging finger (about 40 moves/s at 24 ms)? 10-minute session, direct against classic; no jank from the ring.
- [ ] Browser gestures on iOS Safari and the installed PWA: edge-swipe back from both edges of the picture, pull-to-refresh from the top of the game, long-press callout or the magnifier loupe during an aim-mode hold, double-tap zoom, pinch zoom of the page. Look in the diagnostics for 'compat mouse event dropped' and stray pointercancel. Same on Android Chrome (back gesture, pull-to-refresh, long-press menu).
- [ ] Game audio on iOS Safari with the welcome dialog already dismissed: reload the page, tap only inside the game, and confirm the sound starts after the first tap (wakeAudio); also after backgrounding the PWA and returning (the context may be 'interrupted'). On a hosting phone confirm the spectator hears the game after that first tap. This is the one fix that no headless run can prove.
- [ ] The default-UA iPad (Safari and the installed PWA), with and without an external mouse or trackpad: taps click, no WrongDocumentError, a trackpad click still takes pointer lock, 'Modo de toque' is not offered, a hardware keyboard still types into the game after the first tap, Stage Manager / split view resize keeps the mapping right.
- [ ] Android Chrome with 'Request desktop site': direct still works, the entry is not offered and a stored classic is ignored. Also with site data blocked or storage failing: direct touch must still attach (the new try/catch).
- [ ] Stuck button after backgrounding, on both phones: start a drag on a scrollbar thumb and switch apps, lock the screen, pull the notification shade or take a call mid-drag. On return the list must not still be following the finger and the log should show an abort. Also leave the page backgrounded for a minute (iOS eviction).
- [ ] Palm and multi-touch: does the OS report a contact radius (Chrome on Android does; iOS Safari reports 1x1, so there is no palm rejection on an iPhone)? Does resting a thumb on the picture's edge cancel taps too often, since any second finger on the picture cancels the gesture? Check the 'ignored palm' and 'second-finger' entries.
- [ ] A hosting phone with one spectator: watch the host's cursor in the stream during taps and drags and after 13+ taps and a pause (the idle re-home flicks it to the corner and back): is that acceptable? Confirm the tap ring is NOT visible to the spectator, and that encode plus touch does not overheat the phone. The 2-peer multiplayer harness was not run.
- [ ] The js-dos virtual keyboard, the FAB arrows, Input de Texto and the chat still work with the layer on (a tap on them must not be swallowed or double-handled); tapping the game while the OS keyboard is open dismisses it as a mouse press would.
- [ ] Rotation, split screen and fullscreen/standalone: rotate mid-drag (expect a clean release), resize the window, and check the picture-to-guest mapping after each. A tap in the landscape strip beside the picture does nothing and a quick retry inside the picture clicks under the finger. Also an offline start of the installed PWA: the layer must attach with no network.
- [ ] Copy: read the new tutorial line, the FAQ 'Como funcionam os controles de mouse?' entry, the manual's 'Modo de toque' entry and the dialog on both phones, portrait and landscape; confirm the dialog buttons are reachable on a 390 px-tall landscape phone with the real browser chrome.
- [ ] Export the Diagnóstico report after each session above and attach it: it carries the touch and pointer lines (down, tap, drag, aim, cancel reasons, move timings, homes) that this checklist reads.

### P4 - 640x480 guest and the Resolução toggle  (`d0ef503`)

- [ ] Galaxy A07 and iPhone 15 Pro Max: legibility of the game text at 640x480, portrait and landscape, with 'Desativar Suavização' on and off, and again after switching to 800x600 for comparison.
- [ ] Galaxy A07: boot time to the game's green with the new bundle (+9.2 KB, SETRES.BAT now runs 7 more IF EXIST checks, negligible) and the screenshot()/OCR cost on the 640x480 frame.
- [ ] Both phones: the 'Resolução do jogo' round trip: menu entry, radio dialog (landscape: message, both radios and both buttons visible, 44px targets), confirm, 'Trocando a resolução…', reload, the mode really switched and the saved game still loading. On iPhone do it in the installed PWA to confirm the IndexedDB write finishes before the reload.
- [ ] A real long-time user's device: the service worker re-prefetches the 6.7 MB bundle (hash changed), 'Instalar agora' saves first, the old save loads at 640x480. Same for a device that used 'Carregar Patch'. A device that has been on the site since before 2025-04-20 may hold the ce6eb4a 256-colour image: it should stay at 800x600 and still load, and the menu should keep saying 800x600.
- [ ] Both phones: auto-save at 640x480 on the first kickoff of a new game (the dialog is ~0.6 s on a fast machine) and that tesseract assets load over mobile data.
- [ ] Both phones plus a second device: host a room at 640x480 and spectate; picture fit, cursor alignment, sound, and the menu entry disabled with 'Encerre a sala para trocar' while the room is live. Run npm run mp:launch once on a normal machine, because the two-peer harness has never been run against a 640x480 host.
- [ ] Desktop with a 1080p or 1440p monitor: judge how soft the text is at 640x480 against 800x600 and with 'Desativar Suavização' (the 'larger but softer' trade the FAQ now describes).
- [ ] iOS Safari: the 'resize-outline' icon in the options menu (fetched at runtime, cached from the second online visit) and the Win9x radio dialog tap targets.

### P1 - Typing: key queue, accents, text dialog  (`4fe1556`)

- [ ] Galaxy A07 (low-end): send a long text (500 characters, ideally half accented, e.g. 'Fenômeno João André Açores' repeated) through Input de Texto into a coach field or Notepad. Check that no character is lost and the guest keyboard still answers afterwards. If anything drops, raise KEY_PACING_MS above 10. Also time a 100-character name. Pacing was measured only on a desktop in headless Chrome (smallest gap 10.0 ms, nothing lost in 493 characters).
- [ ] Galaxy A07, Gboard: confirm autocorrect and suggestions do not rewrite 'Felipão', the first letter is not auto-capitalised, there is no auto-space after a word, and Enter inserts a line break.
- [ ] iPhone 15 Pro Max: type D'Alessandro and N'Golo with Smart Punctuation on and confirm the apostrophe arrives as a plain ' (and that quotes and dashes fold). Confirm there is no focus zoom on the 16px textarea and that autocorrect and auto-capitalisation are really off.
- [ ] Both phones: accented names (João, Zé Roberto, Açores, Émerson) typed through the dialog into the Jogadores fields come out right in the game. Also try an accented 8-letter new-game file name and a save and reload of that game (a save with an accented filename was not exercised).
- [ ] Both phones: the 'Enviando n/N' toast and its Cancelar are readable and tappable in portrait and landscape, sit clear of the FAB clusters, and cancelling mid-send leaves no stuck modifier. Also check that backgrounding the browser mid-send pauses and then finishes cleanly.
- [ ] Both phones: the js-dos on-screen keyboard still works (it still calls simulateKeyPress internally), the FAB arrows and Enter still work and cannot wedge anything when tapped quickly, and both the toolbar and FAB 'Input de Texto' entries open the dialog.
- [ ] Both phones: the new FAQ entry about the game quitting to Program Manager (Enter before choosing a radio, Esc, Cancelar) reads well on a small screen.
- [ ] Both phones: the placeholder now always shows an accented name; confirm that the multi-line first entry ('Tite / Felipão / Parreira') renders sensibly in the textarea.

### P10 - The control deck (keys under the picture / in the landscape rails)  (`60532ba`)

- [ ] Galaxy A07 and iPhone 15 Pro Max, portrait and landscape: thumb reach and mis-tap rate on the band (Esc sits next to Tab and above Enter; Mais keys are 44 px) and on the sheet.
- [ ] Check which presentation each phone gets in its real browser tab. If the viewport leaves under 225 px of band (a short Chrome tab on a small Android, an iPhone SE or 8 in Safari), the deck is the 'Teclas' launcher in the toolbar, not the taskbar. Confirm that reads as intended.
- [ ] Hold-to-repeat feel: 380 ms delay and 55 ms interval; the arrow stops the instant the finger lifts; diagnostics 'flush' lines on the A07. In the landscape sheet, hold an arrow while letting the thumb drift up and down: the repeat must continue.
- [ ] Scroll 'Mais teclas' with a thumb on a short landscape screen (about 280-340 px tall, e.g. the A07 sideways in a Chrome tab): a drag from the gaps or from Tab, Shift+Tab, Home, End, F-keys, Num *, Num -, O Matic or Sair scrolls; a drag starting on Apagar, Del, PgUp or PgDn types or holds that key and does not scroll. Check it feels right, and that nothing is left unreachable.
- [ ] No OS keyboard pops up and the picture does not move when tapping any keycap or tab (Android Chrome and iOS Safari, installed PWA and browser tab); a tablet with a physical keyboard still types into the game after tapping deck keys.
- [ ] Haptics on Android: an 8 ms buzz on a key landing, none on repeats, off when 'Vibração nas teclas' is off; the entry is absent on iOS.
- [ ] iOS: no text-selection callout or context menu on a long press of a keycap, no double-tap zoom, pressed bevel shows, no rubber-banding or page scroll when dragging on the deck.
- [ ] Safe areas on real devices: home-indicator strip under the taskbar in portrait; notch insets in landscape for the left gutter column and the sheet.
- [ ] 'Mais teclas' sheet on a 667x375-class screen and on the A07's actual landscape size; the launcher/menu/room-pill column in the left gutter does not collide at 360-400 px tall.
- [ ] Num * 'Craque' and Num - 'Registro' do what the labels say in the real game, and on which screens.
- [ ] Chat with the OS keyboard open on a phone host: the composer stays above the keyboard, the taskbar sits under it, and the picture does not resize; also on rotation with the keyboard up.
- [ ] Hosting from the phone with a spectator watching: the stream stays live while the deck is used, the remote cursor stays aligned, the Chat tab flashes and badges on a message.
- [ ] Alt+F4 'Sair' confirm and the recovery dialog on a phone; a mis-tapped Enter or Esc on the first dialog recovers via 'Reiniciar jogo'.
- [ ] TalkBack and VoiceOver: keycaps announce their pt-BR names and activate by double tap, the Mais tab announces a pending modifier, the Chat tab announces unread counts.
- [ ] Rotating the phone with a modifier latched or an arrow held: the latch clears and the repeat stops.
- [ ] 'Mostrar painel de teclas' Automático/Sempre/Nunca applies at once and survives a reload; 'Apagar todos os dados' resets it and the vibration setting.

### P12 - Stage layout, landscape rails, spectator parity  (`29cea86`)

- [ ] A browser that resizes the layout viewport for the OS keyboard (older Android WebView, OEM browser, if any is at hand): focus the chat field or Texto in landscape; the picture must keep its size and place while the keyboard is up (it is clipped by the viewport, not shrunk). In portrait the chat panel is expected to be missing while typing (known limit).
- [ ] The one-column rail's room-code pill on both phones: ELI-/RVWA on two lines in a full capsule, dot top-left, lock top-right on a password room, legible white on dark grey; the spectator's rail is always one column, check it at 844x390 and 932x430 with the notch inset.
- [ ] Thumb reach and mis-taps of the two rails held landscape on the Galaxy A07 (915x412-class) and the iPhone 15 Pro Max (932x430): Teclas, Enter/Esc, the arrow cross, Tab and the F-key block under the other thumb; keys next to the picture's edge; Enter/Esc are one tap each on the first-dialog hazard.
- [ ] iPhone notch/Dynamic Island in landscape, both sides (and the home indicator in the standalone app): rail faces paint to the edge, keys clear the inset, the picture is not under the notch; 852x393 (iPhone 15 Pro) gets ONE column, 932x430 two; the chat's right side under the notch and its measured cost (about 2.8% on the Pro Max).
- [ ] Android navigation bar/gesture area in landscape and an edge-to-edge installed PWA: rails' bottom padding and the picture's bottom edge.
- [ ] Address-bar collapse in a real browser tab: scroll/collapse the bar in landscape; the stage must settle once with no relayout loop or flicker, and js-dos relayouts once (the diagnostics 'layout' category records viewport, box, covered, insets, columns, stage and lossPercent per change).
- [ ] Installed PWA vs browser tab: compare picture size, rails and the safe-area probe values.
- [ ] Rotate with the chat open on a phone, both directions, with and without the OS keyboard up in the chat field: the picture returns to its exact box, the chat stays usable, the host is never resized by the keyboard.
- [ ] Spectator parity on a real pair: the guest's picture size equals the host's at the same device and window (toolbar dropped on a landscape phone); the pill, Sala, Chat, Som and Sair keys in the rail; leave still reloads the page; sound 'Ativar' state in the rail key.
- [ ] TalkBack and VoiceOver on the rails: names, order (DOM order is picture, chat, then rails; the visual order differs), Chat unread announcement, the Teclas key's pressed state.
- [ ] Safari (iOS 14.5-16) rendering of min()/max() inside calc and env() paddings in the rails and the chat panel's inset padding; the 'Tamanho da imagem' dialog through the real menu and a reload (the choice persists; 'Apagar todos os dados' resets it).

### P11 - Zoom and pan camera (experimental)  (`7a0ab2e`)

- [ ] iPhone Safari (browser tab) AND the installed PWA: pinch on the canvas versus page zoom, gesturestart, the edge-swipe Back from the picture's edges, pull-to-refresh from the top of the game, and touch-action: none on the clip (a pinch must never zoom the page).
- [ ] iPhone: a transform on the WebGL canvas in WebKit. Look for tearing, blur or blank frames while pinching and while holding 2x and 3x, a laggy first frame after Ajustar, and memory growth after many zooms. If WebKit mis-draws or mis-hits, use the LAY-3 fallback (see followUps), do not patch around it.
- [ ] iPhone and Galaxy A07: a real spectator watching a zoomed host. The spectator must keep seeing the whole frame and their cursor must stay under their finger on the host's zoomed picture at 1.5x and 2x. Test with the host on each phone.
- [ ] Pan feel with real fingers: the 8 px dead band, thumb roll, uneven fingers, a pan that ends with one finger lifting early (the other must be dead and must not click), and the auto-follow after a tap near an edge (helpful or jarring?). New: tap near an edge and put a second finger down at once; the picture must not slide under it.
- [ ] The tall portrait view: is the empty green under the picture acceptable at 1.5x (294 px at 393x852, about 330 px at 430x932) and 2x (146 px)? Is the vertical slide under the fingers while pinching away from the top, or with the Zoom panel open (153 to 77 at 2.15x), disorienting?
- [ ] Nudge pad and Zoom panel: thumb reach, 44 px keys, hold-to-repeat (380 ms then 90 ms), the Zoom tab text changing to 1,5x / 2x, VoiceOver and TalkBack reading 'Zoom e movimento, 2x', the Ajustar key lit at the fit.
- [ ] Accessibility: with 'Nunca mostrar painel de teclas' and the camera on there are no zoom buttons, only the pinch. Read the menu entry and the toast on a phone: do they say so clearly?
- [ ] Galaxy A07 frame rate and heat while magnified compared with the fit, with and without 'Economizar bateria quando parado', and the sleeping guest waking on a pinch.
- [ ] Text legibility at 1.5x and 2x on both phones, portrait and landscape, with 'Desativar Suavização' on and off; whether 3x is ever useful.
- [ ] Rotation while zoomed on a real phone: portrait 2x -> landscape -> back restores each orientation's own camera, and nothing jumps when the address bar collapses or the app is installed.
- [ ] Landscape phone: the rails' sheet Zoom tab (first key must read 'Ajustar', not 'Ajus...', on a notch phone), the sheet covering most of the picture while open (is a docked strip needed?), the chat docked while zoomed (stage narrows, camera re-clamps), and the live type bar over a zoomed picture with a real keyboard.
- [ ] With the setting off, play a normal session and confirm nothing differs from before (no Zoom tab, no behaviour change); with it on, check 'Apagar todos os dados' removes both camera keys.
- [ ] Hosting phone: the chat tab plus the Zoom tab make six tabs; check 'Táticas' is not cut at 360 px.

### P8 - Live type bar (experimental, off by default)  (`b73fc06`)

- [ ] Setup for every pass: Galaxy A07 in Chrome (tab and installed PWA) with Gboard, then Samsung Keyboard if installed; iPhone 15 Pro Max in a Safari tab and as an installed Home Screen app. Options menu -> turn on 'Diagnóstico' and 'Teclado ao vivo (experimental)', reach the Jogadores dialog via Novo jogo, and export the Diagnóstico report (Copiar/Compartilhar) after EACH numbered scenario, filtered by 'Teclado do aparelho' (ime) and 'Quadros e tela do jogo' (frame). Attach the exported log for each scenario; the ime lines (inputType, data, isComposing, key, keyCode, value) are the evidence.
- [ ] Opening: tap Texto. Does the OS keyboard come up from that tap on the iPhone (Safari tab and PWA) and on the A07? Texto presses on the LIFT in this mode; if iOS does not raise the keyboard, tapping the field must, and the 'bar focus' log line says whether document.activeElement was the field. The keyboard must never open on its own.
- [ ] Plain typing: 'João Silva', and names with apostrophes and quotes (D'Alessandro, "Zé"). The game field must be 1:1 with the bar. On iOS check Smart Punctuation (typographic quotes and dashes fold to ASCII; '...' becomes three dots in the game and deletes as three Backspaces).
- [ ] Suggestion taps (Gboard, Samsung, QuickType): does the game get a trailing space (it must not until more text follows)? Does a suggestion tap fire compositionend? Read the input/compositionupdate/compositionend/sync lines.
- [ ] Swipe (glide) typing and dictation on both phones: do interim results rewrite the word (the 700 ms settle may send an interim version and then Backspaces)? Does the game field end equal to the bar?
- [ ] Long-press 'a' for 'ã' (and ç, é): one input with the accented character, arriving as Alt+0nnn in the game?
- [ ] Autocorrect really off? Type a misspelt word and one the keyboard would capitalise: does anything change on its own (insertReplacementText, insertText with a different value)?
- [ ] Backspace to empty and past it: does Backspace in the EMPTY bar fire a keydown at all on Android (key 'Backspace' or 'Unidentified'/229)? On iOS it should be keydown only. The game must delete exactly one character per press, never two.
- [ ] NEW, the finalizer's change: with a word still underlined (Gboard/Samsung composing), tap the strip's Tab or Enter, then type the next word. Expected: the first word reaches the first field, the bar empties, the next word lands alone in the next field. Does the OS keyboard STAY OPEN through that (the bar blurs and refocuses the field inside the tap)? Read the 'composition ended by the bar' and 'blur'/'focus' lines. Repeat with the strip's Backspace while a word is underlined, and with a tap on a game field while a word is underlined.
- [ ] NEW: tap the game's own field after typing a name: the keyboard must stay open, the bar must empty, the click must land, and the next typing must go to the newly focused field alone. Then tap a non-field area of the game and confirm only the bar's text was lost.
- [ ] NEW: with the OS keyboard dismissed (Android Back) and the deck panel visible above the docked bar, press a deck key (Tab, Backspace): the bar must empty. Then tap the field and confirm the keyboard returns and typing is mirrored.
- [ ] Enter from the OS keyboard's Enter key: keydown Enter (not 229), moves to the next field, clears the bar? Compare with the strip's Enter and Tab and Shift+Tab (the OS keyboard must stay open under a strip tap).
- [ ] Strip Backspace while a word is underlined and when held: it should delete in the bar and the game together; does the keyboard keep suggesting or duplicating text afterwards?
- [ ] '123': does the number pad appear immediately after the blur/focus in the tap, on both phones? Type a price in the 'Vender' dialog.
- [ ] Rotation with the keyboard open (portrait to landscape and back): the one-row bar sits on the keyboard's edge, the field keeps text and focus, #game-container does not move. Does the keyboard close on rotation?
- [ ] Android Back with the keyboard open: the bar stays docked with 'Toque aqui para digitar', tapping the field brings the keyboard back, the strip keys still work. On iOS: the keyboard's own dismiss.
- [ ] Where the bar sits: portrait Safari tab, installed PWA (status bar adds ~59 px) and Chrome tab on the A07. Compare the 'bar layout' log (inset, visual.top, bar.top/bottom, picture.bottom; the bar's position is the new inset's, its height can lag one fold) with the screen: full window or one row where predicted? Does the bar cover the picture's lower edge? Does iOS pan the visual viewport (visual.top > 0) and push the fixed bar off-screen?
- [ ] A paste of ~80 characters (copy from Notes/Keep): progress chip and Cancelar on the A07's pacing; check the game text after a cut. Close the bar mid-paste with the x: the rest must stop and a toast must say so. Paste a multi-line text (newlines are stripped) and a tab-separated one (tabs must type as spaces): 'Lista' is the way for several lines.
- [ ] NEW, the known unfixed gap: on the A07, paste ~80+ characters and tap another game field immediately. Does the click land before the tail of the text is typed (tail in the wrong field)? Note how far behind the guest is (progress chip) when the tap lands.
- [ ] NEW: type a name longer than the game's field (the 8-letter filename field in the save dialog, a 9+ character name) and then Backspace: do the bar and the game diverge (the guest drops overflow, the bar keeps it)? Judge whether a per-field limit is needed.
- [ ] Shortcut hazard: on the main window (Seleccionar tab) open the bar with the badge saying 'nenhum campo detectado' and type 'a' and 'm'. Confirm they fire Automático/Melhores, that the badge and the Texto pulse are the only warning, and judge whether that is acceptable for D7 or the bar should warn more loudly.
- [ ] Field hint on devices: after tapping a game field, how long until 'campo detectado' and the Texto lamp (I-beam path expected under 0.3 s; caret path about 2 s on a desktop, unknown on the A07)? Tab-driven focus (strip Tab) into a field; a selected-text field (no caret); any false positive in a live match; CPU cost of the frame listener during a live match on the A07 compared with the setting off.
- [ ] Esc on a 360 px phone: the one-row bar has only Tab and Enter there. Is the missing Esc a problem in practice (cancelling an Elifoot dialog while the keyboard is up)?
- [ ] iPad (or any tablet) with a Bluetooth keyboard: with the bar focused, hardware letters are mirrored; Esc, Tab, arrows and F1-F12 go to the game and do not leave the field or trigger browser actions; a held arrow repeats but a held Enter does not.
- [ ] Also on the iPhone: the installed PWA vs Safari tab difference in focus() from the lift of the Texto tap, and in the keyboard showing at all. Record, per device and keyboard, which scenarios failed and attach the exported diagnostics logs for each.

### P13 - Menu, first-run coach, boot screen, quick host  (`b6b1ebb`)

- [ ] Sheet reachability with the thumb on the Galaxy A07 and the iPhone 15 Pro Max (430x932): is the 60% opening height right, is the drag handle discoverable, can the bottom rows be reached one-handed. In landscape the sheet opens at the top and covers the picture, so also check zooming and smoothing there.
- [ ] Accidental taps near the Zona de perigo: does the dashed maroon box plus the two questions (backup offered, then a tick-box) stop a slipped thumb, and can a person who really wants to wipe find 'Apagar todos os dados…', including from the boot-failure dialog.
- [ ] First-run comprehension: hand the phone to someone who has never seen the app. Do the three cards (Toque para clicar, Digite pela aba Texto, Salve e faça backup) make sense, and does 'Saiba mais' land on the right accordion on every open, FAQ and Manual?
- [ ] Android Back with the sheet, 'Dados e avançado', the guide, the coach and the ?host=1 room dialog open: the top window should close first, and 'Voltar ao menu?' should appear only on the next Back. Checked only as history.back() in headless Chrome.
- [ ] iOS swipe-to-dismiss of the sheet, and the edge-swipe Back with a window open.
- [ ] Upgrading users keep their old toggle choices: seed 'Desativar Suavização' and 'Desativar Sync Save' on a real device, update, and confirm 'Suavizar a imagem' and 'Salvar ao gravar o jogo' read off and behave. Checked by seeding the keys in headless Chrome only.
- [ ] Sheet, coach and boot screen over a real notch and home indicator.
- [ ] The room dialog with a real soft keyboard: does it cover 'Transmitir agora' on a small phone?
- [ ] Boot screen on a real slow phone and network: do the 15 s and 60 s hints read sensibly, is the download bar determinate on a cold first visit, and how long Windows 3.1 takes.
- [ ] Spectator waiting card on a mobile network against a live room: the 8 s and 15 s hints and the 44 px Cancelar.

### P5 - Save safety nets  (`2b9aede`)

- [ ] iOS tab eviction and storage durability (iPhone 15 Pro Max, Safari tab and installed Home Screen app): play to a real save, leave the tab for hours, return. Does the chip still show the stored 'Salvo às' time and does the game boot from the saved layer? With Diagnóstico on, read the 'página anterior' lines for a visibilitychange hidden and a 'hidden: persisted' (or the reason it did not).
- [ ] navigator.storage.persist(): read the 'storage.persist {already, granted}' diagnostics line on the iPhone (tab and installed app), on the Galaxy A07 in Chrome and as an installed PWA; note whether Firefox prompts on the first save.
- [ ] Page-hidden save on the A07: press Home right after tapping in the game; check 'hidden: persisted' and that the layers.save duration finishes before the OS freezes the tab (~1 s and ~5 MB on a desktop); switch apps twice to see the 3-minute throttle.
- [ ] Android Back with the guard (Chrome tab and installed PWA): Back opens 'Voltar ao menu?', Cancelar, Back asks again with no extra history entries, 'Sair' lands on the landing page. Also open the PWA straight on /#/game and press Back (no in-app history), and the iOS left-edge swipe.
- [ ] Leave while the game is saving: tap Sair at a kickoff while 'A gravar o jogo…' is up on a slow phone; the loader should wait up to 15 s and the diagnostics should show looks with a verdict, not 'look skipped: auto-save is off'.
- [ ] Loader that never answers: on the iPhone after a long stay in the background, tap the chip, 'Salvar e recarregar' and 'Sair'; none should keep 'Salvando…' over the screen past ~30 s (expect a failed save / 'Recarregar sem salvar').
- [ ] beforeunload on Chrome Android: with unsaved input or a live room, does closing the tab or swiping the PWA away show a prompt at all (iOS Safari ignores it)? Deliberate reloads (Salvar e recarregar, Reiniciar jogo, import, resolution change, update) must not prompt.
- [ ] Share-sheet export on iOS Safari and the installed PWA: 'Exportar jogos salvos' -> 'Backup pronto' -> 'Compartilhar…' must open the sheet at once; 'Salvar em Arquivos' produces a .zip; 'Baixar arquivo' in the standalone PWA may do nothing. On the A07: Drive, WhatsApp, Files targets and 'Baixar arquivo' into Downloads.
- [ ] Import from Files and Drive on both phones: can the picker select a .zip and a .e98, several at once, a Drive file not yet downloaded (expect the 'baixe-o para o aparelho' message), the same file twice, and a zip made on a Mac. The confirm list must flag replacements.
- [ ] The chip's legibility on real screens: portrait at 360 dp (A07) and 430 dp (15 Pro Max), the 44 px tap target, contrast of the amber 'Sem salvar há N min' after 10 minutes without a save; while hosting check the dot-only chip at 430 dp, hidden at 360 dp, and the room pill whole in both. Also the amber 'mas não foi possível confirmar…' toast: 5 s, readable, wrapped sensibly.
- [ ] Recovery on a phone: tap Cancelar in the first dialog. Does 'O Elifoot foi fechado / Reiniciar jogo?' appear within ~3-4 s with the hourglass or a finger-aimed cursor on screen, does 'Agora não' stay dismissed, and does 'Reiniciar jogo' come back to the game? Also a boot slower than 45 s: the game should still raise the dialog after the first green screen. Watch CPU and battery of one screenshot a second on the A07 in a long session.
- [ ] Update flow regression: with a new version ready, 'Instalar agora' still saves first (diagnostics 'update: save before reload ok'), waits for a save in progress and raises no 'leave site?' prompt, hosting or not.
- [ ] The 7-day reminder: set firstPersistedAt old on a device with a real save and check it appears once, reappears if the app is closed unanswered, never after an answer, and does not appear on a device with no save.

### P6 - Boot honesty and offline  (`8e612f2`)

- [ ] Galaxy A07 over mobile data: real time to the first loader percentage, to 'Baixando o jogo… 100%', through the silent wasm gap, and to the game's green; whether the 20 s / 60 s / 120 s windows and the 45 s detection window are right; whether the stage labels are readable.
- [ ] Galaxy A07 and iPhone 15 Pro Max: first visit on a slow link with the service worker prefetching (8.7 MB) while the page downloads the same bundle: total bytes and whether boot is slower than before.
- [ ] iPhone 15 Pro Max as an installed PWA: one online launch, airplane mode, cold launch of /#/game; confirm it boots to the game, icons appear after a second online launch, iOS does not evict the worker or caches.
- [ ] Both phones: Back to the landing page mid-download ('Baixando o jogo…'), then Jogar again: the game must appear in the visible game area (the new container fix), and a timeout dialog left open when pressing Back must disappear.
- [ ] Both phones: the failure dialogs (3 stacked buttons at 390 px, 44 px touch targets, maroon wipe button) and the 'Baixar cópia dos meus dados' download in iOS Safari/standalone, where a blob-anchor download may behave differently; also that js-dos's red English toast over the failure dialog is tolerable.
- [ ] Safari/iOS: indexedDB.databases() is used by the backup and the wipe (Safari 14+ has it; confirm on the device).

### P9 - Battery saver (off by default)  (`05873d8`)

- [ ] Galaxy A07 (the most valuable data point), diagnostics ON, game at a still menu, 10 minutes each with 'Economizar bateria quando parado' OFF then ON: battery % drop, device temperature, the log's 'service stopped' books (asleepMs/probingMs/awakeMs), and a Chrome remote-inspect CPU reading of the emulator worker AND the main thread on both. Run the ON arm with auto-save ON and then OFF (OFF must be inert) so the app's own screenshot polling while asleep is measured.
- [ ] A07: play 3-5 full rounds with the setting ON, then OFF: wall time per round, the longest silent stretch (log 'longestAwakeGapMs'), and whether any 'stall: the guest was working while asleep; idle time raised' line appears. Expected worst case on a ~5x slower phone: one ~4.5 min stretched computation 20 s into the end-of-match stretch, then adapted. Watch the FIRST round after turning it on.
- [ ] A07 and iPhone 15 Pro Max: the first tap and the first key after the guest has slept (Texto dialog, live type bar, deck keys): does the tap land within 3 px of the finger, does a typed name arrive whole, any perceptible delay after a wake.
- [ ] A07 and iPhone: a full round simulation with the setting ON, Auto-Save ON and OFF.
- [ ] iOS Safari and the installed PWA: does dosCI.pause() actually quiet the worker (Settings > Battery or Instruments energy impact), and does resume() survive many pause/probe cycles over 10+ minutes.
- [ ] Sound after a wake on both phones: wake by a tap, play a match, hear goals/whistles; after a long idle on iOS check whether the AudioContext needs a tap to resume; confirm no sound is cut when the screen goes still right after one.
- [ ] Real lifecycle on both phones with the setting ON: switch app and come back, lock/unlock the screen, rotate: the guest is awake and the picture live after the return, and it sleeps again after the idle time (js-dos owns the hidden state).
- [ ] Hosting a room with the setting ON on a phone: the guest must never sleep (room pill visible) and the stream must not freeze; also create a room while the guest is asleep.
- [ ] Check the menu description fits on 360 and 430 px phones and the FAQ entry 'O celular esquenta e a bateria acaba rápido' reads right.
- [ ] If the A07 pass is clean and the owner wants it on by default: set EMULATOR_POWER.DEFAULT_ENABLED to true and revise the menu sentence 'Ainda não foi testado em celulares de verdade' in game.page.html in the same commit (the FAQ follows by binding); if stalls appear, raise IDLE_MS or leave it off.

### P14 - Wake lock, fullscreen, sound, install, storage  (`c69d9e0`)

- [ ] Wake lock holds the screen for 10+ minutes of idle play (a match or season simulation, no touches) on the Galaxy A07 and the iPhone 15 Pro Max, in a browser tab and installed. It is re-acquired after switching apps and coming back (diagnostics 'platform' lines: granted, released by the browser, page visible again). Also test the A07 with battery saver on: the menu should say 'O aparelho não deixou agora', and a tap 30 s later or returning to the page should retry.
- [ ] iOS installed-PWA wake lock (16.4-18.x had bugs): does the screen still dim while the log says 'granted'? Also: does a host phone hold the room for 10+ minutes untouched (the spectator picture does not freeze), and does a spectator phone stay in the room?
- [ ] Fullscreen and landscape lock on the A07 in Chrome and as an installed app: does 'Tela cheia' hide the bars and turn the screen; do Back or the swipe exit fullscreen and unlock; are the picture and a hosting phone's spectator-cursor overlay still aligned afterwards. On iPhone confirm there is no 'Tela cheia' entry, and on iPad Safari that it works (webkit-prefixed).
- [ ] 'Gire o aparelho' hint on both phones in portrait: it appears once after the welcome dialog, covers the toolbar only for a moment, goes away when the phone is turned and never returns. Confirm it does not show on iPad.
- [ ] Audio recovery on both phones after a phone call, a notification sound, locking and unlocking, and a Bluetooth headset connect or disconnect. The chip should appear only when the sound is really gone. A tap on it, or on the game, should bring the sound back. Does iOS report 'interrupted' and accept resume() from pointerup/touchend? Does the diagnostics 'audio: state' line show the transitions? Watch for the chip appearing while the game is merely silent, which would mean it needs to be sound-driven.
- [ ] iPhone ringer switch on silent: with 'Som no modo silencioso' off the game is silent, and with it on the game plays (and other apps' audio is interrupted). Host with volume 0 or muted: a spectator on another device must still hear the game, because the stream is tapped before the gain. This is the one thing not measured, since the headless shell has no audio device.
- [ ] Install on Android Chrome: the 'Instalar o app' entry shows the prompt. The one-time banner appears on the second visit after a save, 'Agora não' and 'Instalar' both answer it, and it never returns. Open the site from a link in the Google app or Gmail and confirm the install entry is still offered (the referrer fix). Check the installed icon (maskable) in the launcher after a reinstall, and that an already-installed copy is not offered as a new install after the manifest change (id '/').
- [ ] Install on iPhone Safari: the 'Instalar o app' entry opens the how-to dialog (check it fits in portrait and landscape and the Exportar button works), and the banner says 'Como instalar'. Install to the Home Screen and confirm the Safari saves do NOT appear in the installed app, that Exportar in Safari then Importar in the app moves them, and that the app shows no install entry or banner.
- [ ] Storage line: 'Armazenamento' under 'Dados e Backups' on both phones, in the tab and installed. It should show Protegido or Não protegido and the usage. Read the 'storage.persist' diagnostics line (P5) too, and note whether Chrome grants persistence when installed and what Safari does.
- [ ] Volume slider and 'Silenciar o jogo' on both phones: thumb reach in the popover, the slider is heard live, mute survives a reload, and 'Apagar todos os dados' restores full volume. As host with 'Enviar o som do jogo aos espectadores' off, the volume line should read 'só para você; o som da sala está desligado'.

### P3 - Auto-save and OCR  (`45e6396`)

- [ ] Galaxy A07 (low-end Android): OCR cost and battery. The 3.3 Hz screenshot() plus ROI hash and the worker must not add jank or heat. Desktop measurements: about 1 ms a look, 1 to 32 ms an OCR pass.
- [ ] Galaxy A07: time for the 5.4 MB worker, core and model to arrive on mobile data. Check whether the 20 s deadline and the 5/15/60 s retries suit a real link, and whether the unavailable toast appears spuriously before a late finish.
- [ ] Galaxy A07 and iPhone 15 Pro Max: play to the first kickoff of a NEW game (a loaded game's kickoffs showed no dialog). Confirm the save dialog is detected, the loader appears and dismisses, and the persist happens once after the dialog closes.
- [ ] iPhone 15 Pro Max (Safari): confirm the tesseract worker starts at all (wasm SIMD core, blob worker). If it does not, confirm the toast 'Salvamento automático indisponível…' appears once and the forced 5-minute save runs.
- [ ] Both devices: with the tab backgrounded while playing, confirm ticks stop when not hosting and resume on return, and that a hosting tab keeps ticking. Save-on-hide is NOT in this phase.
- [ ] Both devices: switch auto-save off and on in the options menu after an OCR failure and confirm it recovers without a reload.
- [ ] After P4 (640x480): run a real save at 640x480. The (252,215) strip was only proven on the real dialog frame pasted into a 640x480 frame.

### P0 - Update saves first  (`1d8940a`)

- [ ] Galaxy A07: time saveGameFileSystem() after a long session (desktop is about 1 s for a 5.4 MB zip). If it nears 5 s, raise APP_UPDATE.SAVE_TIMEOUT_MS. Confirm the 'Salvando o jogo antes de atualizar...' loader shows and that progress made since the last in-game save survives the update.
- [ ] iPhone 15 Pro Max (Safari and installed PWA): same check, plus confirm the IndexedDB write completes before the reload and that the 'Fechar a sala?' Win9x dialog is legible and tappable in portrait at phone width (only checked in a 1000x800 headless viewport).
- [ ] Real service-worker update: ship a build, keep an old tab open, accept 'Instalar agora' and confirm it saves, reloads and lands on the new version. Dev mode disables the service worker, so VERSION_READY itself was never exercised, only the handlers it calls. Repeat while hosting with a second device spectating: the confirm must appear and 'Atualizar depois' must keep the stream alive.
- [ ] Background the tab on a phone (timers throttled), return, and confirm the 5 s ceiling and the reload still happen.
- [ ] Two devices: a spectator that accepts an update must not see the host confirm and must reload straight away (the join-page case was checked here; a live guest in a room with a second peer was not).

### P7 - Accessibility, contrast and copy  (`a84beea`)

- [ ] Status pill on the Galaxy A07 and iPhone 15 Pro Max in portrait: a thumb tap about 10px above and below the capsule in the toolbar copies the room link. Check the capsule shape (round ends, not stretched) and that the focus ring hugs it with a Bluetooth keyboard.
- [ ] Status pill floating on the host in mobile landscape: its capsule has not moved from the top-left gutter, and a tap on the invisible band above or below it does not reach the game. Needs a live hosted room; I only measured it with a cloned pill in the real floating wrapper.
- [ ] O Matic on an iPad (portrait and landscape) or any Android tablet: no scrollbar, 'Cheats Salvos' fully visible, 44px close button reachable. Also the landscape phone case at 844x390 (titlebar and close button on screen, content scrolls inside).
- [ ] Everything on the implementer's checklist still applies: TalkBack and VoiceOver on the labels and the chat live region, (pointer: coarse) matching on both phones, iOS text-field zoom at 16px, and the padding-bottom video box on an older Safari.

### DIAG - Diagnostics log  (`f77deb6`)

- [ ] Galaxy A07 (Chrome): menu, Diagnóstico, switch on, play for a couple of minutes including one text input (Input de Texto), then export with BOTH Compartilhar (the Android share sheet should offer a .txt file) and Baixar (file lands in Downloads). Send the file to the Mac and check the header: pointer coarse, deviceMemory present, 'js-dos: user agent tratado como móvel: sim', js-dos autolock, framebuffer 640x480, Instalado como app.
- [ ] iPhone 15 Pro Max (Safari, and again as an installed home-screen app): same pass. Tap Copiar and paste somewhere to confirm the clipboard write is accepted (the report is built before the tap); tap Compartilhar and confirm the iOS share sheet offers the .txt file (Save to Files, AirDrop, Messages); tap Baixar and confirm a download prompt.
- [ ] One-handed portrait on both phones: Atualizar, Copiar, Compartilhar, Baixar, Limpar and Fechar reachable with the thumb at the bottom of the window; the switch and the category select easy to hit; tapping the category select does not zoom the page on iOS.
- [ ] Key pacing on the A07: compare sendMs with expectedMs on the key 'flush' lines (a desktop stretched 20 ms to 22.4 ms). First real number for whether KEY_PACING_MS = 10 holds on a low-end phone.
- [ ] Boot on both phones: read the boot lines (stage, 'emulator ready', 'game screen detected afterMs', 'guest framebuffer') to see how long Windows 3.1 takes and whether the 45 s detection window is enough.
- [ ] iOS eviction test: switch the log on, play, then use other heavy apps or lock the phone until Safari reloads the tab on return, and open Diagnóstico. It should say '(N da página anterior)' and the last lines should include 'page visibilitychange {"state":"hidden"}' (and pagehide/freeze if iOS fires them). Report whether they are there.
- [ ] ?diag=1 on the phones: open the app with ?diag=1 on the address, confirm the menu says 'Ligado nesta visita', reload or let the tab restore, and confirm it is still on. Also confirm the window says 'pedido com ?diag=1 no endereço'.
- [ ] Watch the game for a stutter every ~5 s with the log on versus off on the A07: that is the periodic tail write (raise DIAGNOSTICS.PERSIST_INTERVAL_MS or lower PERSIST_ENTRIES if it hitches).
- [ ] Check that the 11-12 px log lines are readable on both phones and that long-pressing the log pane lets you select text.
- [ ] Rotate each phone to landscape with the window open: it should scroll inside (the buttons are below the fold at 844x390); confirm that is acceptable.

### T0 - Test infrastructure  (`eff09a3`)

- [ ] T0 needs no phone check, because no app code changed.
- [ ] On your Mac outside the agent sandbox, run 'npm run test:ci' and confirm it exits 0 with 'TOTAL: 34 SUCCESS'. This is the one thing no agent could run as written.
- [ ] On your Mac, run 'npm test' and confirm it still opens a visible Chrome and stays in watch mode.
