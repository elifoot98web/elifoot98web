# The control deck (the keys of a phone)

> Design record for this area, moved out of `CLAUDE.md` (2026-10-30/31). The first section is the VERIFIED summary of the
> invariants (each checked against the code at the time by an independent pass); the second is the verbatim record written phase
> by phase while the area was built. The plan and the as-built history are in [../mobile-ux-study.md](../mobile-ux-study.md); what only
> real phones can confirm is in [../mobile-ux-device-pass.md](../mobile-ux-device-pass.md).

## Invariants (verified summary)

One docked panel of keycaps is the phone's keyboard for a game made for one with keys. It replaced the three `ion-fab` clusters, the header's keyboard / text / O Matic buttons and js-dos's own on-screen keyboard (never attached now, see the bridge section). It is `app-dock` ([dock.component.ts](../../src/app/core/components/dock/dock.component.ts)) with [deck-key.directive.ts](../../src/app/core/components/dock/deck-key.directive.ts) for the keycaps; the pure helpers [deck-keys](../../src/app/core/helpers/deck-keys.helper.ts) (the one key table), [deck-layout](../../src/app/core/helpers/deck-layout.helper.ts), [deck-panel](../../src/app/core/helpers/deck-panel.helper.ts), [key-repeat](../../src/app/core/helpers/key-repeat.helper.ts), [modifier-latch](../../src/app/core/helpers/modifier-latch.helper.ts) and [layout-shape](../../src/app/core/helpers/layout-shape.helper.ts) (all specced); `DECK` in [constants.ts](../../src/app/core/models/constants.ts); the layout in [_deck.scss](../../src/theme/_deck.scss) and the skin in the "Control deck" block of [_win9x.scss](../../src/theme/_win9x.scss) (`.deck-key`, `.deck-face`). Design record: [docs/mobile-ux-study.md](../../docs/mobile-ux-study.md) (P10).

- **The layout contract, which no new control may break: the deck is a SIBLING of `#game-container`, never a child, never over the picture, and the picture's box does not depend on its contents.** Portrait: the picture is pinned to its 4:3 height (75vw, `flex: 0 0`) and the deck is a flex item after it. Landscape: the stage plan sizes the picture and counts a rail's WIDTH, never what is in it (*The stage*). The launcher's sheet is `position: absolute` and takes no space. *Why:* js-dos re-lays-out its canvas whenever that element changes size, and the cursor overlay and every remote cursor are measured against it. The type bar and the boot screen obey the same rule; `scripts/touch-harness/deck.mjs layout` grades it.
- **`DeckLayoutHelper.presentation` is a pure function of the viewport, the primary pointer and the player's setting, and it must not read the OS keyboard** (`LayoutShapeHelper.settle` ignores a keyboard-sized drop of `innerHeight` while a field is focused, or the deck would flip between band and launcher on every focus). It returns one of four things:
  - `none`: no deck. Automático follows the PRIMARY pointer, so a desktop and a touch laptop get none; the floating chat toggle is untouched there.
  - `band`: portrait only, and only where the band under the picture is at least `DECK.MIN_BAND_HEIGHT` (Táticas needs it for 44 px formation keys; a spec derives it from the constant; a phone in a browser tab, with its bars, falls to the launcher). A **taskbar** pinned to the bottom with `margin-top: auto` (without it a folded deck rode up under the picture and the tabs jumped 440 px) and **one panel at a time** above it: Táticas, Setas, Mais teclas, Zoom (only while "Zoom e movimento" is on) or the page's chat. A second tap on the open tab folds it; the picture never grows into the band. Texto is a taskbar button (the compose dialog, or the live type bar when "Teclado ao vivo" is on); Chat appears only while hosting.
  - `rails`: a landscape phone (`landscape-compact`, at most `LANDSCAPE_COMPACT_MAX_HEIGHT` px tall, no toolbar): keys in the two gutters beside the picture, sized by `StageHelper` so they never cost it. The LEFT rail exists even with the deck off (it holds the menu, room code and chat button the missing toolbar had), and the "Teclas" sheet opens beside it for what a rail cannot hold. The deck's keys are pinned to the bottom, so they never move when the room, sound chip or chat comes and goes.
  - `launcher`: every other shape without a band (landscape tablet or laptop, a portrait window with no room): the same panels as a sheet over the page from a "Teclas" toolbar button; it covers part of the picture while open. A portrait tablet gets the band, a landscape one the launcher.
- **While the picture is magnified the band holds only its taskbar (or the Zoom panel), so the camera's tall view keeps the free band** (*The camera*): in the band, `DeckPanelHelper.withZoom` folds the open panel of keys and brings it back at the fit if nobody chose another meanwhile. The Zoom panel is the one that does not take the band (`flex: 0 0 auto`, as tall as its keys), so the picture can be watched while it is used.
- **A keycap presses on `pointerdown` and never takes the focus**: `preventDefault()` on pointerdown and mousedown plus `tabindex="-1"` keep it in `.emulator-root` (where js-dos reads the physical keyboard) and the OS keyboard shut. The pressed look is the `deck-key--down` class, not `:active` (iOS Safari applies `:active` only when something listens for touches).
- **It releases exactly once, however the press ends** (`pointerup`, `pointercancel`, `lostpointercapture`, window blur, page hidden, key disabled or destroyed under the finger): a held arrow hangs its stop on `deckRelease`, and a lost release is a key that types by itself.
- **Keys inside a panel that can scroll press on release (`deckKeyOn="up"`); keys that repeat keep the landing and carry `.deck-key--landing` (`touch-action: none` on the key itself).** A scroll gesture starts as a touch on a key, and the browser stops intersecting `touch-action` at the nearest scroll container, so the deck's `none` never reaches a key in "Mais teclas" or the sheet and the panel's `pan-y` does: a thumb drifting on a held arrow became a scroll, `pointercancel` stopped the hold, and a drag from Apagar typed and then scrolled. The panel still scrolls from its gaps and from every key that presses on release.
- **A `click` is trusted only when no keycap's pointer released in the last `CLICK_AFTER_POINTER_MS`, and that clock is shared by every keycap (a static).** TalkBack, VoiceOver, switches and keyboards activate with a click and no pointer, so a lone click is a press and a release; but the browser makes a tap's click after the lift and aims it at whatever is under the finger then.
- **Nothing the deck shows may change the keys' geometry between a press and its release.** A "next key carries Shift" bar moved every key up 44 px and the tap's click landed on Tab (Shift sent Shift+Tab); a latched modifier is therefore a lit key, a label on the "Mais" tab and a screen-reader-only live region, never a bar.
- **Keys are disabled until an emulator exists, while the page is leaving and while the key queue is faulted** (`GuestKeyQueueService.faulted$`, for `KEY_FAULT_COOLDOWN_MS` or until a submission goes out whole), so a held arrow does not raise the same error every tick; `GamePage.onKeyFailure` still rate-limits the alert. Every key goes through `EmulatorControlService.sendKey`, a thin wrapper over `GuestKeyQueueService`, which is the only sender to the guest (*Typing into the guest*).
- **The key table is one place** (`DeckKeyHelper`; formation captions from `GAME_INPUT_FN_BTNS`). **Alt+F4 ("Sair") is the only guarded key**: a `win9x-alert` confirm, because it leaves for the Program Manager. D8: Num `*` is "Craque" (player search) and Num `-` is "Registro" (serial key), labelled from the owner's word; what they do on every screen of the game is unchecked.
- **A scroll panel's children must not shrink** (`flex-shrink: 0` in `_deck.scss`): with the default they squeezed into a panel shorter than the keys, the 44 px rows overflowed their boxes and Num `*`, O Matic and Sair were painted over the F keys, so a tap aimed at F7 hit one of them. Under `(pointer: coarse)` every keycap must stay at least 44x44.
- **Hold-to-repeat** (`KeyRepeatScheduler`; arrows, Backspace, Del, PgUp, PgDn): a tick that finds the queue holding `REPEAT_MAX_PENDING` tasks is skipped, not queued, so a slow device never types on after the finger lifts; `REPEAT_MAX_HOLD_MS` ends a hold nobody released; `stop()` is the only thing to call and clears every timer; the timers run outside Angular's zone. A hold also ends on blur, a hidden page, a panel switched under the finger, the page leaving and the queue faulting.
- **Sticky modifiers** (`ModifierLatch`): a tap latches Shift, Ctrl or Alt for the next key (which lets it go), a second tap within `LATCH_DOUBLE_TAP_MS` locks it, a tap on a lock lets it go. **Nothing is ever held down in the guest**: the latch is put round the next key's chord, which the queue presses and releases whole, so a forgotten latch is only a lit button, never a stuck Shift. Blur, a hidden page, a layout change, the sheet closing and destroy clear it; a panel switch does NOT (the "Mais" tab names a waiting modifier from any panel).
- **The chat stays the page's.** The page mounts `#chat-panel` above the deck and keeps its open state, unread count and focus; the deck mirrors them and asks for changes through `(chatToggle)`, so a chat opened from the options menu shows in the taskbar too. A panel of keys closes the chat; the chat opens over whatever panel was up (`DeckPanelHelper`). Under the OS keyboard the chat lifts by `--kb-inset` less `--deck-taskbar-total` (`.has-deck-band`), because the taskbar sits in the flow below it; that variable must keep matching the folded dock's real height.
- **Settings** (options menu, Entrada section; both `STORAGE_KEY`s, wiped by "Apagar todos os dados", read before the boot so the deck does not come and go behind the boot screen): `DECK_MODE` ("Mostrar painel de teclas": Automático, Sempre mostrar, Nunca mostrar) and `DISABLE_KEY_VIBRATION` ("Vibração nas teclas", stored as the OFF flag so every existing install means on, offered only where `navigator.vibrate` exists; a repeat does not buzz).
- **Safe areas:** the taskbar's face continues under the home indicator, a rail paints to the screen's edge with the notch's inset in its width and padding, and the launcher's sheet adds the left inset to its width (a sheet that opens from a rail needs none).
- **Win9x is a CSS-only flip to flat, but not a two-rule one** (decision D3): `_deck.scss` also names `--win9x-` tokens (the band's face and seam, the taskbar's seam, the sheet's title bar and border, the unread flash); `grep -n 'win9x-' src/theme/_deck.scss` lists every one a flip must touch. `DockComponent` logs presses, modifiers, repeats and panel changes into the diagnostics categories `key` and `page`.
- **Not verified on a real phone:** thumb reach and mis-taps, haptics, iOS Safari (callout, double-tap zoom, `:active`), real safe-area insets, the OS keyboard over the chat, TalkBack and VoiceOver on the keycaps; the Galaxy A07 and iPhone 15 Pro Max passes are pending.

## Full record (verbatim)

> Written phase by phase. Where it disagrees with the summary above or with the code, those win: later phases changed some earlier facts
> (for example, which root services keep a `DosCI`, and that two-peer sessions at 640x480 were later run).

One docked panel of keycaps replaced three `ion-fab` clusters, the header's keyboard / text / O Matic buttons, the options
menu's "Teclado Virtual" and js-dos's own keyboard: four copies of the same dozen actions that collided with each other, the
header and the chat. It is `app-dock` ([dock.component.ts](../../src/app/core/components/dock/dock.component.ts)), with
[deck-key.directive.ts](../../src/app/core/components/dock/deck-key.directive.ts) for the keycaps, the pure helpers
[deck-keys](../../src/app/core/helpers/deck-keys.helper.ts), [deck-layout](../../src/app/core/helpers/deck-layout.helper.ts),
[deck-panel](../../src/app/core/helpers/deck-panel.helper.ts), [key-repeat](../../src/app/core/helpers/key-repeat.helper.ts),
[modifier-latch](../../src/app/core/helpers/modifier-latch.helper.ts) and [layout-shape](../../src/app/core/helpers/layout-shape.helper.ts)
(all specced), `DECK` in [constants.ts](../../src/app/core/models/constants.ts), the layout in [_deck.scss](../../src/theme/_deck.scss) and
the skin in the "Control deck" block of [_win9x.scss](../../src/theme/_win9x.scss): `.deck-key` (every keycap and taskbar button) and
`.deck-face` (the grey the panels stand on) with their states. Decision D3's Win9x look is a **CSS-only flip** to flat, but not a
two-rule one: `_deck.scss` also names Win9x tokens in a handful of declarations (the band's face and its seam, the taskbar's seam, the
sheet's title bar and border, the unread flash), and `grep -n 'win9x-' src/theme/_deck.scss` lists every one a flip must touch. The
design record is [docs/mobile-ux-study.md](../../docs/mobile-ux-study.md) (P10).

**The layout contract, which no new control may break: the deck is a SIBLING of `#game-container`, never a child, never over
the picture, and the picture's box does not depend on its contents** (in landscape the picture's box is the stage plan's, which counts a rail's WIDTH and
nothing that is in it; see *The stage*). js-dos re-lays-out its canvas whenever that element changes size,
and the cursor overlay and every remote cursor are measured against it. In portrait the picture is already pinned to its 4:3
height (75vw, `flex: 0 0`) and the band under it is free, so the deck is a flex item after it. `DeckLayoutHelper.presentation`
is a pure function of the viewport, the primary pointer and the player's setting, and it returns one of four things:

- `none`: no deck. A desktop with a mouse and a keyboard is not cluttered by default, and a touch laptop (touch is only its
  `any-pointer`) is the same. The floating chat toggle is untouched there.
- `band`: portrait only, and only where the band under the picture is at least `DECK.MIN_BAND_HEIGHT` (225 px: Táticas needs about
  220 for its two rows of formation keys to be 44 px, and `deck-layout.helper.spec.ts` derives that from the constant. A 360x640
  phone has 314, but the same phone in a Chrome tab with its URL and navigation bars is ~512 tall and has ~186, and an iPhone SE
  in a Safari tab has 216: both got 32-42 px formation keys under the first threshold of 150 and now get the launcher). A **taskbar** that
  stays at the bottom (it is pushed there with `margin-top: auto`; without it a folded deck rode up under the picture and the
  tabs jumped 440 px on the tap that folded them) and **one panel at a time** above it: Táticas, Setas, Mais teclas, or the
  page's chat. Texto is a taskbar button that opens the P1 compose dialog (or, with the experimental "Teclado ao vivo" setting on, the live type bar: see *The live type bar*), and Chat appears only while hosting. A second tap on
  the open tab folds the panel; the picture does not grow into the band.
- `rails`: a landscape phone (`landscape-compact`, a viewport at most 500 px tall: no toolbar, the picture takes the whole height). The keys live in
  the two gutters the height-fitted picture leaves, one rail each, sized by `StageHelper` so that they never cost the picture; see *The stage*. A landscape
  phone has the LEFT rail whether or not the deck is shown (`DeckPresentation.rails`): the toolbar is gone and the menu, the room code and the chat button
  live there, projected into the dock by the page. The sheet below opens from the rail's edge for what a rail has no room for ("Mais teclas", and Táticas
  in a one-column rail).
- `launcher`: every other shape without a band: a landscape tablet or laptop (the picture takes the height and the gutters are too thin for keys) and a
  portrait window with no room under the picture. The same panels open as a **sheet** over the page from a "Teclas" button in the toolbar. The sheet is
  `position: absolute` and takes no space, so it never resizes the container; it does cover the left part of the picture while it is open.

**Tablets** follow the shape: a portrait iPad (768x1024, 820x1180) gets the band, which fits all three panels with room to spare
(the keys are capped at 290 px of height there, and rest at the bottom where the thumbs are); a landscape one has no band and
gets the launcher. Both were compared on screenshots; a sheet in portrait would have thrown away a 450-510 px band for nothing.

**The picture's box was measured with and without the deck, and with the sheet open, at 13 viewports** (360x640, 375x667,
393x852, 412x915, 430x932, 844x390, 932x430, 667x375, 820x1180, 1180x820, 1024x768, 768x1024, 1280x800; touch emulation;
chrome-headless-shell 143): `#game-container` and the canvas inside it had the same rectangle every time. In portrait every
keycap of every panel is at least 44x44 css px under `(pointer: coarse)`, none is over the picture and none is outside the
viewport, and "Mais teclas" (five rows) fits the 254 px panel of a 360x640 phone without scrolling. **The short windows are
measured too** (375x553, 360x512, 320x460 in portrait: the launcher; 667x340, 667x320, 852x340, 800x290 in landscape: the
sheet, whose "Mais teclas" scrolls): no two keycaps overlap in any panel and every key is inside the viewport or reachable by
scrolling. A scroll panel's children must not shrink (`flex-shrink: 0` in `_deck.scss`): with the default they squeezed into a panel
shorter than the keys, the 44 px rows overflowed their boxes and `Num *`, O Matic and Sair were painted over the F keys, so a tap
aimed at F7 would have landed on one of them (measured as overlapping boxes, not tapped). `deck.mjs layout` asserts the overlap,
and fails with that rule undone.

**What the keycap promises** ([DeckKeyDirective](../../src/app/core/components/dock/deck-key.directive.ts)):

- **It presses on `pointerdown`**, not `click`, with `preventDefault()` on the pointerdown and the mousedown and
  `tabindex="-1"`, so the focus stays in `.emulator-root` (checked: after five taps on keys and tabs the active element was
  still `.emulator-root`) and the OS keyboard never opens. The pressed look is the `deck-key--down` class, not `:active`.
- **It releases exactly once, however the press ends**: `pointerup`, `pointercancel`, `lostpointercapture`, the window losing
  focus, the page being hidden, the key being disabled or destroyed under the finger. A held arrow hangs its stop on that.
- **A key inside a panel that can scroll presses on release** (`deckKeyOn="up"`), because the scroll gesture starts as a touch
  on a key. Keys that repeat cannot do this and keep the landing, so they take no part in panning instead: `.deck-key--landing`
  is `touch-action: none` on the key itself. *Why:* the browser stops intersecting `touch-action` at the nearest scroll container,
  so the deck's `none` never reaches a key inside "Mais teclas" or the sheet and the panel's `pan-y` did: 40 px of vertical
  drift (a thumb holding an arrow in the sheet) became a scroll, the browser sent `pointercancel` and the hold stopped, and a drag
  that began on Apagar typed a Backspace and then scrolled (reproduced in headless Chrome 143 with touch emulation: `pointercancel`
  at 40 px without the class, never with it). The panel still scrolls from its gaps and from every key that presses on release.
- **A `click` is only trusted when no keycap's pointer released in the last `CLICK_AFTER_POINTER_MS` (700 ms).** TalkBack,
  VoiceOver, a switch and a keyboard activate a button with a click and no pointer at all, so a click with nothing before it is a
  press and a release. But the browser makes the click of a tap *after the lift and aims it at whatever is under the finger then*.
  **The first version showed a bar when a modifier was tapped, which moved every key up 44 px; the click landed on Tab and Shift
  sent Shift+Tab** (reproduced on the real game: a stray plain Tab 500 ms after every modifier tap). Two fixes, both needed: the
  guard's clock is shared by every keycap (a static), and **nothing the deck shows may change the keys' geometry between a
  press and its release**. That is why a latched modifier is a lit key and a label on the "Mais" tab, with a
  screen-reader-only live region, and not a bar.
- **The keys are disabled until an emulator exists, while the page is leaving, and while the key queue is faulted**
  (`GuestKeyQueueService.faulted$`: the emulator itself threw while a task went out; for `KEY_FAULT_COOLDOWN_MS` or until a
  submission goes out whole). A held arrow therefore does not raise the same error on every tick; `GamePage.onKeyFailure`
  still rate-limits the alert.

**The key table is one place** ([DeckKeyHelper](../../src/app/core/helpers/deck-keys.helper.ts)): F1-F12 with the formation caption of
each from `GAME_INPUT_FN_BTNS` (the only table; the reversed copy for the old portrait FAB column died with the FABs), `A`
Automático, `M` Melhores, the cross, Enter, Esc, Tab, Shift+Tab, Backspace, Space, Del, PgUp/PgDn, Home/End, and the keypad `*`
and `-`. **Decision D8: `*` is the player search for the "craque" attribute and `-` is where the serial registration key is
typed, and they are labelled "Craque" and "Registro"**; the key codes are right (332, 333) but no visible effect was seen on the
screen they were pressed on (the squad selection), so what they do in the game is on the device checklist. Every key was pressed
on the real game: the codes reach the guest (F1-F12 are 290-301; F5, F6 and F8-F12 each give a different formation screen, F1-F4 and F7 repeat the
previous frame, which was not investigated), Enter closes Acerca, Tab moves the focus between Registo's fields, the arrows move the
squad and country lists, `A` selects the automatic squad, Backspace deletes, and "Texto" typed "Zé" and "João". **Alt+F4 ("Sair") is
the only guarded key**: a `win9x-alert` says it leaves for the Program Manager and that the app offers the restart, Cancelar sends
nothing, "Fechar o jogo" sends Alt+F4 and the recovery dialog was up within 3.5 s.

**Hold-to-repeat** ([KeyRepeatScheduler](../../src/app/core/helpers/key-repeat.helper.ts); the arrows, Backspace, Del, PgUp, PgDn): the
press as the finger lands, `REPEAT_DELAY_MS` 380, then every `REPEAT_INTERVAL_MS` 55. **A tick that finds the queue holding
`REPEAT_MAX_PENDING` (2) tasks is skipped, not queued**, so a slow device never keeps typing after the finger lifts; `maxHoldMs`
(30 s) ends a hold nobody released; `stop()` is the only thing that has to be called and it clears every timer. The timers run
outside Angular's zone. Measured on the country list: a 1.5 s hold sent 22 presses, the first repeat 380 ms after the landing and
the rest 55-57 ms apart, each one landed (24 countries after 2 + 22), and the repeat stopped on a release, `touchcancel`, a
window `blur`, the page being hidden, a panel switched under the finger, the page leaving and the queue faulting (9 presses at
800 ms and 9 at 1.5 s, in every case).

**Sticky modifiers** ([ModifierLatch](../../src/app/core/helpers/modifier-latch.helper.ts)): a tap latches Shift, Ctrl or Alt for the next
key (and the next key lets it go); a second tap within `LATCH_DOUBLE_TAP_MS` locks it; a tap on a lock lets it go. **Nothing is
ever held down in the guest**: the latch is put round the next key's chord, which the queue presses and releases whole, so a
latch the page forgets can only be a lit button, never a stuck Shift in the game. It is cleared by a window blur, the page being
hidden, the layout changing and the deck being destroyed. Checked on the real game: Shift then Tab sent Shift+Tab once; a Ctrl lock
sent Ctrl+Home and Ctrl+End and stayed lit, the "Mais" tab named it from another panel, and a `blur` cleared it (Ctrl+Esc opened
Windows 3.1's Task List, which is also the proof that a chord reaches the guest).

**The chat stays the page's.** The page mounts `#chat-panel` above the deck and keeps its open/closed state, unread count and
focus; the deck mirrors them and asks for changes through `(chatToggle)`, so a chat opened from the options menu shows in the
taskbar too. Opening a panel of keys closes the chat and the chat opens over whatever panel was up (`DeckPanelHelper`). Under the
OS keyboard the chat lifts by `--kb-inset` less the taskbar (`.has-deck-band` in `_deck.scss`), because the taskbar sits in the
flow below it. Checked in a real two-peer session (the host a 393x852 phone emulation, the spectator a desktop browser, public
nostr relays): the spectator's video was live and 640x480 for 248 s, its chat message arrived (the Chat tab showed 1 unread),
opening it docked the chat above the taskbar, and the host's picture rectangle did not move. The OS keyboard over the chat is
**not** verified (headless has none).

**Settings** (both `STORAGE_KEY`s, both wiped by "Apagar todos os dados"): `DECK_MODE`, "Mostrar painel de teclas" in the options
menu (Automático, Sempre mostrar, Nunca mostrar; it applies at once, and its subtitle says what Automático comes to on this
device, including the touch laptop whose mouse is the primary pointer), and `DISABLE_KEY_VIBRATION`, "Vibração nas teclas"
(stored as the OFF flag so that every existing install means on; offered only where `navigator.vibrate` exists, so not on iOS; a
buzz is 8 ms on the landing of a key, and a repeat does not buzz). Both are read before the boot, so the deck does not come and go
behind the boot screen.

**Safe areas:** the taskbar's face continues under the home indicator (bottom padding is `env(safe-area-inset-bottom)` on top
of its own 4 px), a rail's face paints to the screen's edge with the notch's inset in its width and its padding, and the launcher's sheet adds the left inset to its
width so a notch does not eat the keys (a sheet that opens from a rail needs none). Emulated at 430x932 (59 px top,
34 px bottom) and 932x430 (59 px left and right, 21 px bottom); real insets are on the device checklist.

**Diagnostics:** `key` / `deck press` (key id, latched modifiers, queue depth, tap or repeat or confirmed), `deck modifier`,
`deck modifiers cleared` (with the reason), `deck repeat stopped` (reason, repeats, skipped) and `deck guarded key asked`; `page` /
`deck panel`, `deck layout`, `deck sheet` (also from a rail's key), `deck chat`, `deck text`, `deck setting chosen` and `stage view chosen`; the stage's own plans are category `layout`.

**Not verified:** any phone or finger (mis-taps, thumb reach, the 380/55 ms feel), haptics, iOS Safari (callout on a long press of a
keycap, double-tap zoom, `:active`), real safe-area insets, the OS keyboard over the chat, a low-end CPU, TalkBack and VoiceOver on
the keycaps, and scrolling "Mais teclas" with a thumb on a short landscape screen (the synthetic drag is graded, a real one is not).
All of them are on the device checklist of the PR.
