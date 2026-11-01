# The live type bar (experimental)

> Design record for this area, moved out of `CLAUDE.md` (2026-10-30/31). The first section is the VERIFIED summary of the
> invariants (each checked against the code at the time by an independent pass); the second is the verbatim record written phase
> by phase while the area was built. The plan and the as-built history are in [../mobile-ux-study.md](../mobile-ux-study.md); what only
> real phones can confirm is in [../mobile-ux-device-pass.md](../mobile-ux-device-pass.md).

## Invariants (verified summary)

A real, visible one-line field above the OS keyboard (`TypeBarComponent`) whose text appears in the guest as it is typed, so a phone player sees what they write instead of typing blind into the compose dialog. **Off by default**, behind `STORAGE_KEY.LIVE_KEYBOARD` (menu "Dados e avançado" > "Recursos experimentais" > "Teclado ao vivo (experimental)"): off, the deck's Texto button opens the compose dialog exactly as before and neither the bar nor the field hint is mounted or running; on, Texto opens the bar and the dialog stays the way to paste a list ("Lista" on the bar: a list is several lines and the bar is one). Decision D7: dialog by default, bar behind a flag, the owner decides after the device pass.
Files: the window is `TypeBarComponent` ([type-bar/](../../src/app/core/components/type-bar/type-bar.component.ts)) but the rules live in pure helpers in `src/app/core/helpers/`: [`TypeMirror`](../../src/app/core/helpers/type-mirror.helper.ts) (what the guest holds, and the diff), [`TypeKeyHelper`](../../src/app/core/helpers/type-key.helper.ts) (which keydowns are the game's), [`TypeBarSession`](../../src/app/core/helpers/type-bar-session.helper.ts) (the field's events wired to the mirror and the queue), [`TypeBarLayoutHelper`](../../src/app/core/helpers/type-bar-layout.helper.ts); for the hint `CaretWatcher` ([caret-watch.helper.ts](../../src/app/core/helpers/caret-watch.helper.ts)), [`IBeamHelper`](../../src/app/core/helpers/ibeam.helper.ts), [`FieldHintHelper`](../../src/app/core/helpers/field-hint.helper.ts) and `FieldHintService`; `TYPE_BAR` and `FIELD_HINT` in [constants.ts](../../src/app/core/models/constants.ts); the layout and its seams in [_type-bar.scss](../../src/theme/_type-bar.scss).

- **Everything that types goes through `GuestKeyQueueService.send()`**, one atomic submission of already planned tasks (the Backspaces and the planned text of one step): the queue stays the only key sender and there is no second planner.
- **The bar is a SIBLING of `#game-container` and never changes the picture's box.** `position: fixed` to the bottom, lifted by `--kb-inset` (`KeyboardInsetService`, started and stopped with the bar), it takes no room: it COVERS the band under the picture and, with a tall keyboard, the picture's lower edge. Resizing the page for the keyboard would make js-dos re-lay-out its canvas and break the overlay sync and the stage (see *The stage*). It never moves the camera either, and its fold decision reads the VISIBLE bottom of the picture, `min(picture, clip)`. Mounted only where the deck is (`layout.kind !== 'none'`).
- **It is never opened by itself, and `open()` renders the view and focuses the field in the same synchronous call as the tap** (iOS counts only a focus made in the gesture). Texto presses on the LIFT in this mode (`deckKeyOn="up"`), a lift being likelier than a landing to be a gesture iOS counts (unverified). The field hint never opens the keyboard.
- **One DOM, a class for the fold: the field is never re-created while the keyboard is up** or it loses the focus and closes the keyboard. Full window (title with badge, field with "123" and "x", two rows of five keys on a phone, one of ten from `WIDE_STRIP_MIN_WIDTH`) unless the keyboard leaves less than `FULL_HEIGHT_*` between the picture and itself; then one row: the field and the keys that fit (Tab, Enter and the way out always, Esc from 400 px, "123" and Backspace from 560, the OS keyboard having a Backspace and a number page of its own; the field must stay 120 px wide, so a 360 px phone with its keyboard up has no Esc and the FAQ says the keys shown are the ones that fit). The px tiers are `@media` queries in `_type-bar.scss`, whose 520 must match `WIDE_STRIP_MIN_WIDTH`. **Landscape is always one row, on purpose**: the OS keyboard covers 55-60% of the screen, a taller bar only covers more, and the compose dialog would cover the same pixels and put its buttons under the keyboard; panning the picture above the keyboard was left out (a transform on `#game-container` against the overlay sync).
- **The strip's keys are `appDeckKey` keycaps** (no focus taken, so the keyboard stays up under a tap) and send through the same session as the field, so a key always follows the text before it. Look is Win9x (D3), one skin (`.deck-face`, `.deck-key`, `.win9x-input`); 16 px in the field (iOS zooms the page on less), keys of 44 px or more under a coarse pointer. The field's `autocapitalize/autocorrect/autocomplete=off`, `spellcheck=false` and `enterkeyhint` are static template attributes, because `autocorrect` is a boolean property in WebKit/Chromium where "off" is truthy. **"123" sets `inputmode="numeric"` and blurs and refocuses the field inside the tap**, or the keyboard does not notice.
- **Text comes from the field's VALUE, never from a key.** Every `input` and `compositionend` runs `TypeMirror.sync(value)`: NFC, in code points, "N Backspaces from the first difference, then the rest", one `send()`. A letter, an autocorrect, a swipe, a dictation, a suggestion tap and a paste are the same operation, and a doubled event finds nothing left to send (Chrome and Safari order `compositionend` and the last `input` differently). It assumes the guest's caret is at the END and that its field takes everything the bar holds; `maxlength` is 300 and Elifoot's fields are shorter (the 8-letter filename field), nothing knows a field's limit, and text the guest drops makes later Backspaces delete too much (known; a per-field limit is a follow-up).
- **The bar empties itself, and the mirror with it, whenever the guest leaves its field (`TypeBarSession.abandon`)**: after a key that moves it (Enter, Tab, arrows, F-keys), a tap on the game, and a key sent from elsewhere (the deck, seen through `GuestKeyQueueService.activity$`, which fires inside the submission, so the bar's own sends are told apart by a flag). Otherwise the bar reads "FelipeSilva" over a field holding "Silva" and Backspaces delete text the bar never wrote. Empty is the safe direction (the next text appends, a Backspace is the guest's own; a touch that clicks nothing costs only the bar's text). The tap flushes first (the click is still to come); keys from elsewhere do not (the guest has already moved and text sent now would land in the new field).
- **A tap on the game keeps the OS keyboard.** The touch layer moves the focus to `.emulator-root` on every touch (a hardware keyboard needs it), which would close the keyboard on each tap on the game's own field; `TouchSurface.keepFocus` is asked first, at every finger, and the bar answers whether it holds the focus (and abandons). The tap still clicks.
- **A composition is mirrored when it ends, not while it runs.** An IME may rewrite a word it holds (suggestion, dictation's interim result, conversion), and each rewrite is Backspaces plus a retype in a slow guest, with a stale burst landing on whatever the guest has focused by then; mirroring mid-composition was NOT shown to be safe. `input` events inside one only arm a settle timer (`COMPOSITION_SETTLE_MS`, so an IME that never ends one does not leave the bar mute); a strip key, a blur and closing mirror the text as it stands.
- **Leaving a field ends a composition at once.** A keyboard that keeps a word underlined until a space does not end it for a strip key or a tap on the game, and waiting for it left the old field's word in the bar for good. `abandon`, only while a composition is active, blurs and refocuses the field inside the gesture (the browser commits on blur) and ignores what the browser commits or reports on the way (`abandoning`: it belongs to the old field). **The bar never writes the value of a field the IME is composing in** (how text is resurrected on some keyboards), so the strip's Backspace ends the composition first. A cut or failed send (`desync`: the guest then holds an unknown part) clears the bar too, but waits for the composition instead of ending it, because it asks nothing of the keyboard.
- **A pasted control character types as a space, a trailing space is held back until something follows it, and every code point is one guest character except the ellipsis** (`TypeMirror.settled`, `guestWidth`). `<input type=text>` strips only CR/LF, so a pasted Tab or U+2028/2029 would make the planner press Tab/Enter behind a mirror that believes it is one field; the held space absorbs the keyboard's auto-space (Gboard, QuickType) without guessing which spaces were its own (price: no space at the very end of a field, which no field of this game wants); "…" is three dots in the guest, so the mirror asks the planner how many Backspaces a code point takes.
- **Named keys are authoritative from `keydown`** (`TypeKeyHelper`: Enter, Tab, Shift+Tab, Esc, arrows, Home, End, Del, PgUp, PgDn, F1-F12) and their default is cancelled (Tab would leave the field, F5 would reload the page); `keyCode 229`, `key: "Unidentified"` and `isComposing` are the IME's and fall through to the input events, and Ctrl/Alt/Meta chords are the browser's. **Backspace is the game's only in an EMPTY field** (the strip's too): iOS fires no `input` for it, only the keydown, while in a field with text the `input` carries it and a keydown too would delete twice. A held Enter, Esc or Tab does not repeat; an arrow does unless the queue is backed up (`REPEAT_MAX_PENDING`). The strip's Enter/Esc and a hardware Enter are the hazard keys of *Typing into the guest*.
- **The CapsLock guard is asked once**, when the bar first types letters and again after `CAPS_GUARD_REARM_MS` without typing any, not per keystroke or on a fixed timer: each read is a round trip to the emulator, a first version re-armed during continuous typing (a read mid-word), and nothing on a phone can toggle the guest's CapsLock. The clock is the last send of letters, guarded or not.
- **Mutually exclusive with the chat and the compose dialog** (the page closes whichever is not being opened). Closing mirrors what the field holds, blurs it and hands the focus back to `ChatPanelHelper.focusEmulator()`; **closing in the middle of a paste cancels the rest of it and says so (a toast)**, because the paste's Cancelar is on the bar and a bar that closed while the queue went on typing would leave no way to stop it.
- **The shortcut hazard.** Letters are game commands on a screen without a text field (A is Seleccionar > Automático, M is Melhores), and the bar sends what is typed, so typing with no field focused FIRES them (measured on the real game). The bar says what it thinks (badge in words, "campo detectado" / "nenhum campo detectado", and a lamp; Texto pulses and keeps a lamp), and **nothing ever gates a key or opens the keyboard on it**: "nenhum campo" means *not seen* (a field whose text is selected, most fields a form walks into, blinks no caret), and iOS opens a keyboard only from a tap while both signals arrive after it.
- **`FieldHintService` combines two hints and runs only while the setting is on.** *A caret blinking* (`CaretWatcher`, from js-dos's `onFrame`, which fires only when the framebuffer changed): a blink cadence (`FIELD_HINT.BLINK_*`) suspects it and two frames taken AT consecutive frame events (never a fixed delay apart, which lands both in one half of the blink half the time) differing by one thin bar confirm it; ~2 s latency, misses selected text, cannot see which field. js-dos cannot remove a frame listener, so one is registered per emulator and kept inert (a null check per frame) while stopped. *An I-beam under the tap* (`IBeamHelper`, one screenshot `IBEAM_LOOK_DELAY_MS` after a click from `TouchInputService.clicks$`, valid `IBEAM_TTL_MS`): Windows' I-beam is an XOR cursor, so it is found by SHAPE, never colour, and the serif is what rejects the arrow over a white list. Pixel-sensitive like the other scrapers (see *Screen-scraping*); checked at 640x480 only.
- **Diagnostics:** category `ime` (every field event with `inputType`, `data`, `isComposing`, `keyCode`; every step sent; a `bar layout` snapshot on open and on every keyboard change) only while the bar is open, `frame` for the hint; **typed text appears in this log by design** (the panel's warning says so; see *Diagnostics log*). `KeyboardInsetService` writes `--kb-inset`/`--kb-open` BEFORE it tells `inset$` (a spec pins the order), or the snapshot the device pass reads to judge where iOS put the bar would be one step behind.
- **Known and left:** a tap on the game is not ordered behind keys still queued (the pointer engine and the key queue are separate serial queues; the fix is an ordering gate in `GuestPointer`, the P2 engine's hot path), so after a long paste on a slow phone the click can land before the tail is typed and the tail goes to the field just tapped; a paste shows its progress.
- **Not verified on any real keyboard or phone** (Galaxy A07 and iPhone 15 Pro Max passes pending, [docs/mobile-ux-device-pass.md](../../docs/mobile-ux-device-pass.md) P8): everything above ran against Chromium's CDP IME events, a keyboard simulated by shrinking `visualViewport`, and unit specs. Unobserved: what Gboard, Samsung Keyboard and iOS actually send (`keyCode 229`, `compositionend` on a suggestion tap, the auto-space, Backspace in an empty field on Android), whether `abandon`'s blur and refocus keeps the OS keyboard open (if not, the bar stays docked and a tap on the field brings it back), `focus()` on a lift counting as a gesture on iOS, and `visualViewport` offsets when iOS pans to reveal a field (the bar is fixed against the layout viewport).

## Full record (verbatim)

> Written phase by phase. Where it disagrees with the summary above or with the code, those win: later phases changed some earlier facts
> (for example, which root services keep a `DosCI`, and that two-peer sessions at 640x480 were later run).

A real, visible, one-line field above the OS keyboard whose text appears in the guest as it is typed: the player
sees what they write instead of typing blind into a dialog (phase P8). **It is behind a setting and off by default**:
`STORAGE_KEY.LIVE_KEYBOARD`, "Dados e avançado" > "Recursos experimentais" > "Teclado ao vivo (experimental)", whose description says that it has not been
tried on real phones; wiped by "Apagar todos os dados" like every key. Off, the deck's Texto button opens the P1 compose dialog
exactly as before and nothing of this is mounted or running. On, Texto opens the bar, and the dialog is still the way to
paste a list ("Lista" on the bar, "Digitar texto" in the menu): a list of names is several lines and the bar is one. Decision
D7: the dialog is the default, the bar is built behind a flag, and the owner decides after the device pass. **The mirroring
has been run only against synthetic IME events in desktop Chrome** (what exactly is under *Not verified* below).

Files: `TypeBarComponent` ([type-bar/](../../src/app/core/components/type-bar/type-bar.component.ts); the window), the pure
[`TypeMirror`](../../src/app/core/helpers/type-mirror.helper.ts) (what the guest holds, and the diff), [`TypeKeyHelper`](../../src/app/core/helpers/type-key.helper.ts)
(which keydowns are the game's), [`TypeBarSession`](../../src/app/core/helpers/type-bar-session.helper.ts) (the field's events wired to the
mirror and the queue), [`TypeBarLayoutHelper`](../../src/app/core/helpers/type-bar-layout.helper.ts), and for the hint
[`CaretWatchHelper`/`CaretWatcher`](../../src/app/core/helpers/caret-watch.helper.ts), [`IBeamHelper`](../../src/app/core/helpers/ibeam.helper.ts),
[`FieldHintHelper`](../../src/app/core/helpers/field-hint.helper.ts) and `FieldHintService`; `TYPE_BAR` and `FIELD_HINT` in
[constants.ts](../../src/app/core/models/constants.ts); the layout and its seams in [_type-bar.scss](../../src/theme/_type-bar.scss).
Everything that types goes through `GuestKeyQueueService.send()` (one atomic submission of already planned tasks: the
Backspaces and the planned text of one step); the queue stays the only key sender.

**The contract with the page, which is the deck's: the bar is a SIBLING of `#game-container` and the picture's box does not
depend on it.** It is `position: fixed` to the bottom of the screen, lifted by `--kb-inset` (`KeyboardInsetService`, started
and stopped with the bar; it gained `inset$` for the one consumer that decides from the number), and takes no room in the page:
it COVERS the band under the picture and, with a tall keyboard, the picture's lower edge. Measured at twelve viewports with a
simulated keyboard (phones, tablets, both orientations), `#game-container` and the canvas had the same rect with the bar open,
folded, and closed, and the bar's bottom was the keyboard's top. It is **never opened by itself**: `open()` renders the view and
focuses the field in the same synchronous call as the tap (iOS counts only a focus made in the gesture), and Texto presses on the
LIFT in this mode (`deckKeyOn="up"`, a lift being likelier than a landing to be a gesture iOS counts; unverified). It cannot be
opened with the setting off, and it is mounted only where the deck is.

- **Layout: the full window, or one row.** Title (the badge), the field with "123" and "x", and a strip of keys: two rows of five
  on a phone (Tab, Shift+Tab, Enter, Esc, Apagar / the four arrows and "Lista"), one row of ten from 520 px. It needs
  `FULL_HEIGHT_*` of room between the picture's bottom and the keyboard's top (190 px measured at 393 px wide, 196 asked for);
  with less it **folds into one row** (the field and the keys that fit: Tab, Enter and the way out always, Esc from 400 px,
  "123" and Backspace from 560, the OS keyboard having a Backspace and a number page of its own; the field must stay 120 px wide, so a
  360 px phone with its keyboard up has **no Esc** on the bar, and the FAQ says the keys that fit are the ones shown). **In landscape it is always the
  one row, which is the documented choice**: the OS keyboard covers 55-60% of the screen, so the picture's lower half is gone
  whatever is done and a taller bar would only cover more of what is left; the compose dialog (the other option) would cover
  the same pixels and put its buttons under the keyboard (BASE-8). Rotating the keyboard open therefore costs the middle of the
  picture to a 56 px strip; panning the picture above the keyboard was considered and left out (a transform on `#game-container`
  against the overlay sync is another phase's risk). **One DOM, a class for the fold**: the field is never re-created while the
  keyboard is up or it would lose the focus and close the keyboard.
- **A tap on the game keeps the keyboard, and empties the bar.** The touch layer moves the focus to `.emulator-root` on every touch (a
  hardware keyboard needs it), which would close the OS keyboard on each tap the player makes on the game's own field;
  `TouchSurface.keepFocus` is asked first, at every finger that lands on the game, and the bar answers "I have it". The tap still clicks.
  It is also the moment the bar learns the guest is about to leave its field, so it **mirrors what it holds and lets go of it**
  (`TypeBarSession.abandon`): typed on, the bar would read "FelipeSilva" over a game field holding "Silva", and Backspaces past what
  was typed in it would delete text the bar never wrote. A key sent from anywhere but the bar (the deck's keycaps, through
  `GuestKeyQueueService.activity$`, which fires inside the submission, so the bar's own sends are told apart by a flag around them)
  does the same, without mirroring first: the guest has already moved and text sent now would land in the new field. Emptying is the
  safe direction: an empty bar means "I hold nothing of this field", so the next text appends and a Backspace is the guest's own. A
  touch that clicks nothing (a scrollbar drag, a palm) costs only the text on the bar. Checked: a tap on Jogador 2 after "Felipe"
  left the bar empty with the focus still in it, and "Silva" typed next went to Jogador 2 alone; so did a deck Tab.
- **Mutually exclusive with the chat** (the page closes whichever is not being opened), and closing blurs the field, mirrors what
  it holds, and hands the focus back to `ChatPanelHelper.focusEmulator()`. **Closing in the middle of a paste cancels the rest of it**
  and says so (a toast): the paste's Cancelar is on the bar, so a bar that closed and let the queue go on typing would leave the
  player no way to stop it. Checked: an 80-character paste closed after 15 keys typed nothing more and the toast came. The strip's keys
  are `appDeckKey` keycaps: they take no focus, so the keyboard stays up under a tap.
- **Look: Win9x (decision D3), one skin.** `.deck-face` and `.deck-key` (the deck's, `_win9x.scss`), `.win9x-input` +
  `.win9x-element-bevel` for the field, and the title bar, lamp and progress chip in `_type-bar.scss`
  (`grep -n 'win9x-' src/theme/_type-bar.scss` lists the flip points). 16 px in the field (iOS zooms the page on less), 44 px or more
  on every key under a coarse pointer (checked at the twelve viewports, no two keys overlap, none leaves the bar).

**Mirroring rules.** Each is there because a real keyboard would otherwise misbehave, and all were written from what such
keyboards are known to do, not from having held one.

- **Text comes from the field's VALUE, never from a key.** Every `input` and `compositionend` runs `TypeMirror.sync(value)`: the
  value (NFC, in code points via `Array.from`) is compared with what the guest holds, and the step is "N Backspaces from the first
  difference, then the rest", one `send()`. A plain letter, an autocorrect, a swipe, a dictation, a suggestion tap and a paste are
  the same operation, and an event that comes twice finds nothing left to send, so the order of `compositionend` against the last
  `input` (Chrome and Safari differ) does not matter. It assumes the guest's caret is at the END, so the bar **clears itself, and
  the mirror with it, whenever the guest leaves the field**: after any key that moves it (Enter, Tab, the arrows, F-keys...), a tap on the game
  and a key from the deck (above): from there the text no longer describes the field the guest is on. It also assumes **the guest's field takes
  everything the bar holds**: `maxlength` is 300 and Elifoot's fields are shorter (the 8-letter filename field), so text the guest drops
  makes the bar longer than the field, and the Backspaces that follow delete too much in the guest. Nothing knows a field's limit; this is
  on the device checklist and a per-field limit is a follow-up. A paste is one step, with the queue's progress ("Enviando n/N", from
  24 keys) and a Cancelar that calls `cancelKeys()`; a send that is cut or fails clears the bar too (`desync`), because the guest then
  holds an unknown part.
- **A composition is mirrored when it ends, not while it runs.** An IME holding a word may rewrite it (a suggestion, a dictation's
  interim result, a conversion), and each rewrite is Backspaces and a retype in a guest that spends 20 ms a character, with a stale
  burst landing on whatever the guest has focused by then. Mirroring the middle of it was NOT shown to be safe, so `input` events
  inside a composition only arm a settle timer (`COMPOSITION_SETTLE_MS`, 700): an IME that never ends one must not leave the bar mute,
  and after the quiet the text as it stands is mirrored, with a later rewrite a plain diff on top. A key from the strip, a blur and
  closing mirror the text as it stands too.
- **Leaving a field ends a composition at once.** A keyboard that keeps a word underlined until a space does not end it for a key
  tapped on the strip or a tap on the game, and waiting for it left the old field's word in the bar for good (found in review: the first
  cut deferred the clear until the composition ended, and a spec locked that in). So `abandon` ends the composition itself, inside the
  gesture: the field is blurred (the browser commits a composition when its field loses the focus) and focused again, and whatever
  the browser commits or reports on the way is ignored, because it belongs to the old field. It does this only when a composition is
  active, and **the bar never writes the value of a field the IME is composing in** (how text is resurrected on some keyboards): the
  strip's Backspace ends the composition the same way before it edits the value. A send that is cut or fails (`desync`) clears the bar
  without ending anything, because it asks nothing of the keyboard: that clear waits for the composition to end, and the mirror keeps
  describing the field exactly as it is until then. Checked with CDP `imeSetComposition`: "Leu" being composed, then the strip's Tab,
  sent L e u and Tab, left the bar empty with the focus in it, and "Ze" typed next went to the next field alone; the strip's Backspace
  on a composing "Ab" sent A, b and ONE Backspace and left "A". **Not verified: that the blur and focus keeps the OS keyboard open.**
  If a keyboard closes there, the bar stays docked with its keys and a tap on the field brings it back; it only happens while a word
  is underlined.
- **A pasted control character is a space.** An `<input type=text>` strips only CR and LF from a paste, so a Tab (a spreadsheet cell, a
  tab-separated note), a backspace character or U+2028/2029 reach the value, and the planner would press the key each one names: Tab
  and Enter move the guest to another field behind the mirror's back, which still believes it is one field. `TypeMirror.settled` types
  them as the space they look like (a trailing one is held back like any). Checked: "Zé", a Tab and "Silva" pasted sent Z, the accent,
  Space and S i l v a, no Tab, and the guest field read "FelipeZé Silva".
- **A trailing space is held back until something follows it** (`TypeMirror.settled`), which is the answer to the keyboard's
  auto-space (Gboard after a suggestion tap, iOS after a QuickType word): "Felipão " sends "Felipão", the space goes out when "Silva"
  follows it (as " Silva"), a space taken back sends nothing, and iOS taking a space away before a full stop costs nothing. It does
  not try to know which spaces were the keyboard's; the price is that a space the player does want at the very end of a field is not
  in the game (no field of this game wants one).
- **Every code point is one guest character, except the ellipsis**: the mirror asks the planner how wide each is (the "…" iOS Smart
  Punctuation makes of "..." is three dots there, and deleting it is three Backspaces), accents are Alt codes, quotes and dashes
  fold, and the rest is "?". NFC first, so "a" plus a combining tilde is one "ã".
- **Named keys are authoritative from `keydown`** (`TypeKeyHelper`): Enter, Tab, Shift+Tab, Esc, the arrows, Home, End, Del, PgUp, PgDn
  and F1-F12 go to the guest and their default is cancelled (Tab would leave the field, F5 would reload the page: checked). `keyCode
  229`, `key: "Unidentified"` and `isComposing` are the IME's and fall through to the input events; Ctrl, Alt and Meta chords are the
  browser's. **Backspace is the game's only in an EMPTY field** (iOS fires no `input` for it, only the keydown; in a field with text the
  input event carries it and a keydown too would delete twice). A held Enter, Esc or Tab does not repeat; an arrow does, unless the
  queue is backed up.
- **The CapsLock guard is asked once**, when the bar first types letters and again after `CAPS_GUARD_REARM_MS` without typing any, not per
  keystroke and not on a timer (each read is a round trip to the emulator; nothing on a phone can toggle the guest's CapsLock). The clock
  is the last send of letters, guarded or not: a first version re-armed every 15 s of continuous typing, a read in the middle of a word.
- **"123"** sets `inputmode="numeric"` and blurs and refocuses in the tap so the keyboard notices. The field is `type=text`,
  `autocapitalize/autocorrect/autocomplete=off`, `spellcheck=false`, `enterkeyhint=enter`, `maxlength` 300; they are static template
  attributes (Angular writes those with `setAttribute`), because `autocorrect` is a boolean property in WebKit and Chromium where "off"
  is truthy (see the compose dialog).

**The shortcut hazard, and what is done about it.** Letters are game commands on a screen without a text field (A is Seleccionar >
Automático, M is Melhores), and the bar sends what it is typed, so typing with no field focused FIRES THEM. Measured on the real
game: on the main window, with the badge reading "nenhum campo detectado", a typed "a" selected the automatic squad. So the bar says
what it thinks, in words and a lamp, and the deck's Texto button pulses and keeps a lamp when a field seems focused; **neither ever
gates a key or opens the keyboard** (iOS opens one only from a tap, and both signals arrive after it). `FieldHintService` combines
two hints, both off unless the setting is on:

- *A caret blinking* (`CaretWatcher`, from js-dos's `onFrame`, which fires only when the framebuffer changed): measured at 640x480,
  frames 528-600 ms apart with a field focused and none on a still screen, and consecutive frames differ by exactly one bar 1 px wide
  and 14 tall (the font fixes it, so none of the thresholds depends on the frame size; 17 tall in the sale-price field was seen at
  800x600). Three frames of that cadence suspect a caret, and the pair taken AT the next two frame events (the prototype took them
  290 ms apart, which lands both in one half of the blink half the time) confirms and locates it. **Latency measured: 2.0 s** from a
  cold start with a caret already blinking. It misses a field whose text is selected (no caret blinks; Tab and Enter select), and
  it cannot see which field. js-dos has no way to remove a frame listener, so one is registered per emulator and kept, inert (a null
  check) while the hint is stopped; the service holds no timer and does no work per frame otherwise.
- *An I-beam under the tap* (`IBeamHelper`, one screenshot 150 ms after a click the touch layer sent, `TouchInputService.clicks$`): the
  guest draws its cursor into the frame, and Windows' I-beam is an XOR cursor, 17 rows (a stem 15 tall between two serifs 7 wide) in the
  inverse of what is under it: blue on the focused yellow field, black on a white one. It is found by shape against any background; **the
  serif is what rejects the arrow**, whose black left edge is a 15-row stem with white on both sides over a white list. Valid for 4 s
  after the tap. Costs 0.2 ms. Checked at 640x480 only (the sprite is the cursor's own and should be the same at 800x600, which
  was not run). The splash text also shows an I-beam (TOUCH-10), so it is a hint.

**Diagnostics** (category `ime`, only while the bar is open; `frame` for the hint): every `beforeinput`, `input`, `compositionstart`,
`compositionupdate`, `compositionend`, `keydown`, `keyup`, `focus`, `blur` and `paste` of the field with `inputType`, `data`,
`isComposing`, `key`, `code`, `keyCode`, `repeat` and the value; every step sent (`sync`: why, Backspaces, the text, the tasks, what the
guest holds) and every key, clear, deferred clear, composition ended by the bar, cut-short send and settle; and on open and on every keyboard
change a `bar layout` snapshot (shape, fold, inset, `innerWidth x innerHeight`, `visualViewport` size, offset and scale, the bar's and the
picture's rects). The bar's position in it is the new inset's, because `KeyboardInsetService` writes `--kb-inset` and `--kb-open` BEFORE it
tells `inset$` (the other order logged the previous inset's rect, which is what a device pass would have read to judge where iOS put the
bar), but its height is read before the fold it may have just decided on is rendered: the `bar folds` line says that.
**Typed text appears in this log by design** (the panel's warning says so); it is what the device pass needs. Off, each call is one
boolean check.

**Not verified: any real keyboard.** Everything above was run against Chromium's CDP (`Input.imeSetComposition`, `insertText`,
`dispatchKeyEvent`) on the real game at 393x852 with touch emulation, a keyboard simulated by shrinking `visualViewport.height`, and
unit specs. Recalled and unobserved, and on the device checklist: what Gboard and Samsung Keyboard actually send (`keyCode 229`
everywhere? does a suggestion tap fire `compositionend`? is the auto-space what is assumed?), Backspace in an empty field on Android
(does it fire a keydown at all, and as `Backspace`?), iOS Smart Punctuation, swipe typing and dictation (interim results, the settle timer),
autocorrect not fully off, `focus()` on a lift counting as a gesture on iOS, the keyboard staying open under a keycap and under a canvas
tap, Android Back, rotation with the keyboard open, `visualViewport` offsets when iOS pans to reveal a field (the bar is fixed against
the layout viewport and would be off-screen if it does), whether the blur and focus that ends a composition (a strip key, a Backspace,
a tap on the game) leaves the OS keyboard open, whether the browser then commits and reports what is assumed, and the timing of all of
it on a low-end phone. **Known and left, because the fix is in the P2 pointer engine:** a tap on the game is not ordered behind the keys
still queued, so after a long paste on a slow phone the click can land before the tail of the text has been typed and the tail goes to
the field just tapped (a paste shows its progress, and the window is the cursor's walk to the tap, at least ~200 ms of 10 ms keys).
