# Typing into the guest

> Design record for this area, moved out of `CLAUDE.md` (2026-10-30/31). The first section is the VERIFIED summary of the
> invariants (each checked against the code at the time by an independent pass); the second is the verbatim record written phase
> by phase while the area was built. The plan and the as-built history are in [../mobile-ux-study.md](../mobile-ux-study.md); what only
> real phones can confirm is in [../mobile-ux-device-pass.md](../mobile-ux-device-pass.md).

## Invariants (verified summary)

[guest-key-queue.service.ts](../../src/app/core/services/game/guest-key-queue.service.ts) is the **only** thing that sends keys to the guest. The control deck (`DockComponent.press`), the text dialog (`GamePage.sendTextToGame`) and the live type bar submit tasks (`chord`, `altCode`, a text planned by `EmulatorKeyCodeHelper.planText`, or tasks planned elsewhere through `send()`) to one FIFO with one consumer, so two senders can never overlap. `EmulatorControlService.sendKey` / `sendString` / `sendTasks` are thin wrappers over it; the page has no `sendKey` of its own.

Load-bearing invariants — each of these was a bug, or a measured trap:

- **Never call `dosCI.simulateKeyPress`; the queue is the only key sender.** It stamps the release 16 ms in the future, so a second call within 16 ms loses its key and leaves the guest keyboard dead until a reload (5 of 5 repros), which costs everything since the last save (it was easy to hit: an un-awaited text racing another key tap did it). Enforced, not just documented: `no-restricted-syntax` in [eslint.config.mjs](../../eslint.config.mjs) rejects any member access, destructuring or object property named `simulateKeyPress` in app code (the `@deprecated` property *signature* in [jsdos.d.ts](../../src/app/core/typings/jsdos.d.ts) is not matched), so a spec's fake emulator must not give it that method. js-dos's own on-screen keyboard, whose keys bind to it, is deliberately never built (`game.js`).
- **Raw events only, paced, and never a long burst (the 14-event rule).** The queue sends `sendKeyEvent` down then up with `EMULATOR_CONTROL_CONFIG.KEY_PACING_MS` between groups, and never more than `MAX_SYNC_KEY_EVENTS` events without a gap (so a longer chord is refused), because DOSBox's keyboard buffer drops the rest without an error (129 characters in one burst delivered 14). The pacing is a lower bound: a late timer only widens the gap, the safe direction.
- **A task is atomic.** Once its first key is down it is carried through to the release, so neither `cancel()` nor a failure can leave Alt or Shift held in the guest; `cancel()` drops only tasks that have not started. The queue is a root service that outlives the page, so `GamePage.ngOnDestroy` cancels what is left (typing meant for that page's emulator).
- **A submission wakes a sleeping guest first, and so does every task.** Keys sent to a paused guest are not lost but pile up in the worker and land in one burst on resume, which the 14-event rule exists to prevent. `submit` calls `EmulatorPowerService.wake('keys')` before queueing and `run` before each task, so a text that takes seconds never sees the guest fall asleep under it (see *Letting the guest sleep*).
- **Every code point is one visible character in the guest** (an ellipsis folds to three dots, the one exception). `EmulatorKeyCodeHelper.planText` is the pure, specced step: ASCII is a plain or Shift chord; U+00A1–U+00FF are Alt+0nnn on the keypad, four digits zero-padded (selects ANSI over the OEM page; the coach-name and 8-letter filename fields draw them, the latter upper-casing them); typographic quotes, dashes and exotic spaces fold to ASCII; **everything else becomes a visible `?` — never a space, never a drop**, so the host's string and the guest's field stay 1:1 and Backspace stays correct. The guest is a plain US layout with no dead keys and no way to install ABNT2, so accents can only be composed. The euro sign and the rest of Windows-1252's 0x80–0x9F block (Š, ™…) are `?` on purpose: Alt+0128 is accepted but the fields' font has no glyph and draws a solid box. Count with `Array.from` (UTF-16 units would turn one emoji into two `?`); input is NFC-normalised first and CR/CRLF become one Enter.
- **CapsLock is guarded, NumLock is not.** Before a text that types letters (`typesLetters`) the queue reads the BIOS keyboard flags byte (`0040:0017`, `readMemory`) and taps CapsLock off if set: Shift-for-uppercase inverts under it, and a host hardware keyboard forwards its own CapsLock, so the host cannot know. Alt+0nnn composes the same character with NumLock on or off. The guard is best effort: `readMemory` has no deadline and the consumer is single, so the read is raced against `KEYBOARD_STATE_TIMEOUT_MS` and a failure is logged and the text goes out as it is. A sender that submits keystroke by keystroke (the type bar) decides how often to ask via `guardCapsLock`, since each read is a round trip.
- **A refused key says so.** With no emulator (or a malformed task) a submission rejects with `KeyQueueError`, whose Portuguese message is meant for `showErrorAlert`, instead of becoming a tap that does nothing. An emulator that throws mid-send also marks the queue `faulted$` for `KEY_FAULT_COOLDOWN_MS`, or until a submission goes out whole (the deck greys its keys meanwhile); a refusal is the caller's doing and is not a fault.
- **`activity$` fires once per accepted submission, synchronously inside the call that submits and before any key goes out; a refused one is not activity.** `EmulatorControlService.keyActivity$` (a re-export) feeds the unsaved-input mark (*Save safety nets*), and the live type bar subscribes to the queue's `activity$` itself and tells its own sends from everyone else's by a flag around the call: emitting later would make the bar abandon its own text.
- **The text dialog sets its field's attributes on the DOM (`turnOffTextAssists`), not through the input's `attributes` option.** Ionic hands those to Stencil, which assigns an element *property* wherever one exists, and `autocorrect` is a boolean property in WebKit and Chromium: `'off'` is truthy and writes `autocorrect="on"`. `enterkeyhint` is `enter`, not `send`: the field is a textarea where that key inserts a line break, which is how several game fields are filled in one go.
- **Guest hazard to know before sending any Enter.** On Elifoot's first dialog, Enter before a radio is chosen raises "List index out of bounds", and Esc or Cancelar quits; either way the game exits to Program Manager. Anything that sends Enter on its own (a "next field" button) must not do it on that screen. The control deck's **Enter** and **Esc** keycaps, the type bar strip's, and a hardware Enter in the bar's field are one tap on exactly that hazard, which is why Alt+F4 has a confirm and these have the exit recovery (*Save safety nets*; the bar's side is in *The live type bar*). Test harnesses cite this bullet by name.
- **Still unverified on real phones (Galaxy A07, iPhone 15 Pro Max passes pending):** `KEY_PACING_MS` on a low-end Android (the diagnostics `key` flush line reports how far a device stretches it) and iOS/Android keyboard behaviour in the dialog.

## Full record (verbatim)

> Written phase by phase. Where it disagrees with the summary above or with the code, those win: later phases changed some earlier facts
> (for example, which root services keep a `DosCI`, and that two-peer sessions at 640x480 were later run).

[guest-key-queue.service.ts](../../src/app/core/services/game/guest-key-queue.service.ts) is the
**only** thing that sends keys to the guest. A control deck key, the text dialog and anything added later
submit tasks (`chord`, `altCode`, a whole text planned by `EmulatorKeyCodeHelper`, or tasks planned elsewhere through `send()`) to one FIFO
with one consumer, so two senders can never overlap. `EmulatorControlService.sendKey` / `sendString` are the thin
wrappers over it that the control deck (`DockComponent.press`) and the text dialog call; the page has no `sendKey` of its own.

Load-bearing invariants — each of these was a bug, or a measured trap:

- **Never call `dosCI.simulateKeyPress`; the queue is the only key sender.** It stamps the release
  16 ms in the future, so a second call within 16 ms loses its key and leaves the guest keyboard
  dead until a reload (5 of 5 repros) — and a reload costs everything since the last save. It was
  easy to hit: the old `sendString` was not awaited, so a FAB tap mid-text did it. The queue sends
  only `sendKeyEvent` down then up, `EMULATOR_CONTROL_CONFIG.KEY_PACING_MS` (10 ms) between groups,
  and never more than `MAX_SYNC_KEY_EVENTS` (14) events without a gap, because DOSBox's keyboard
  buffer drops the rest without an error (129 characters in one burst delivered 14). **It is enforced, not just
  documented:** js-dos's own on-screen keyboard was the last other caller (its keys bind to `simulateKeyPress`
  internally) and it is no longer built, so `no-restricted-syntax` in [eslint.config.mjs](../../eslint.config.mjs) rejects
  any member access, destructuring or object property named `simulateKeyPress` in app code (checked: `dosCI.simulateKeyPress(1)`,
  `dosCI['simulateKeyPress']`, `const { simulateKeyPress } = x` and `{ simulateKeyPress: … }` each fail). The one declaration
  that has to exist, `@deprecated` in [jsdos.d.ts](../../src/app/core/typings/jsdos.d.ts), is a property *signature*, which the
  selectors do not match. A spec that needs a fake emulator must not give it that method.
- **A task is atomic.** Once its first key is down it is carried through to the release, so
  neither `cancel()` nor a failure can leave Alt or Shift held in the guest; `cancel()` drops only
  tasks that have not started, and `GamePage.ngOnDestroy` calls it.
- **A submission wakes a sleeping guest first, and so does every task.** The battery saver (*Letting the guest sleep*) pauses the
  emulator on a still screen; keys sent to a paused guest are not lost, but they pile up in the worker and land in one burst on
  resume, which is what the 14-event rule above exists to prevent. `submit` calls `EmulatorPowerService.wake('keys')` before it
  queues anything and `run` calls it again before each task, so a text that takes seconds never sees the guest fall asleep under it.
- **Every code point is one visible character in the guest.** `EmulatorKeyCodeHelper.planText` is
  the pure, specced step that turns a string into tasks: ASCII is a plain or Shift chord,
  U+00A1–U+00FF are Alt+0nnn on the keypad (four digits, zero-padded, which selects ANSI over the
  OEM page), typographic quotes, dashes, the ellipsis and exotic spaces fold to ASCII, and
  **everything else becomes a visible `?` — never a space, never a drop**, so the host's string and
  the guest's field stay 1:1 and Backspace stays correct. The guest is a plain US layout with no
  dead keys and no way to install ABNT2, so accents can only be composed. The euro sign and the
  rest of Windows-1252's 0x80–0x9F block (Š, ™…) are `?` on purpose: Alt+0128 is accepted, but the
  fields' font has no glyph there and draws a solid box. Count with `Array.from`; UTF-16 units
  would turn one emoji into two `?`. Elifoot's 8-letter filename field takes the accents too (and
  upper-cases them).
- **CapsLock is guarded, NumLock is not.** Before a text that types letters, the queue reads the
  BIOS keyboard flags byte (`0040:0017`, through `readMemory`) and taps CapsLock off if it is set:
  Shift-for-uppercase inverts under it, and a host with a hardware keyboard forwards its own
  CapsLock to the guest, so the host cannot know. The byte does track both toggles under Windows
  3.1, but Alt+0nnn composes the same character with NumLock on or off, so there is nothing to
  guard there. The guard is best effort — `readMemory` has no deadline of its own and the consumer
  is single, so a read is raced against `KEYBOARD_STATE_TIMEOUT_MS`, and a failed one is logged and
  the text goes out as it is.
- **A refused key says so.** With no emulator a submission rejects with `KeyQueueError` (its
  message is Portuguese, meant for `showErrorAlert`) instead of becoming a tap that does nothing.
- **The text dialog sets its field's attributes on the DOM, not through the input's
  `attributes` option.** Ionic hands those to Stencil, which assigns an element *property* wherever
  one exists, and `autocorrect` is a boolean property in WebKit and Chromium: `'off'` is truthy and
  writes `autocorrect="on"`. `enterkeyhint` is `enter`, not `send`: the field is a textarea where
  that key inserts a line break, which is how several game fields are filled in one go.
- **Guest hazard to know before sending any Enter.** On Elifoot's first dialog, Enter before a
  radio is chosen raises "List index out of bounds", and Esc or Cancelar quits; either way the game
  exits to Program Manager (the FAQ says so). Anything that sends Enter on its own — a "next field"
  button — must not do it on that screen. The control deck's **Enter** and **Esc** keycaps are one
  tap on exactly that hazard (reproduced on the real game: Enter twice from Acerca left Program Manager and the
  recovery dialog came up 3 s later), which is why Alt+F4 has a confirm and these two have P5's recovery. The live
  type bar's strip has the same two keys, and a hardware Enter in its field is one too (see *The live type bar*).
