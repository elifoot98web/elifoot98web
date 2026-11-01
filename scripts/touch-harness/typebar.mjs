#!/usr/bin/env node
/**
 * The live type bar against the real page and the real game, in a headless Chrome with touch emulation.
 *
 *   node scripts/touch-harness/typebar.mjs walk     from the splash to the Jogadores dialog (the coach names), with the setting on: where `ime` and `hint` run
 *   node scripts/touch-harness/typebar.mjs layout   the bar over twelve phones and tablets with a simulated OS keyboard: layout, keys, and the picture's box
 *   node scripts/touch-harness/typebar.mjs ime      synthetic IME events (CDP imeSetComposition / insertText / dispatchKeyEvent) into the bar, and what the guest got
 *   node scripts/touch-harness/typebar.mjs hint     the field hint: a tap on a game field keeps the bar's focus and is seen as an I-beam, the caret's latency, the Texto cue
 *   node scripts/touch-harness/typebar.mjs moves    the guest leaves the field the bar describes: a tap on the game, a key from the deck, a strip key or Backspace in the middle of a
 *                                                   composition, a pasted Tab, and closing the bar in the middle of a paste
 *
 * It needs the page booted by boot.mjs (a dev build: it reads window.ng). `ime`, `hint` and `moves` need the Jogadores dialog, which `walk` reaches
 * from the splash in about 35 s (it ENDS on the dialog: do not run `walk` twice on one boot).
 *
 * **The OS keyboard is simulated**, because headless Chrome has none: `visualViewport.height` is made `innerHeight - px` and a `resize` is
 * dispatched on it, so the real `KeyboardInsetService` measures, publishes `--kb-inset` and the bar lifts itself. What a real keyboard does
 * (composition, keyCode 229, auto-space, the focus rules of iOS) is NOT reproduced by any of this: the IME events are CDP's, and the point of
 * the checks is that the bar and the game agree on them, not that a phone does. A synthetic key press tells the game what the *bar* sent: the
 * recorder wraps `dosCI.sendKeyEvent` and reads the codes after the key queue.
 */
import { connect, sleep } from './lib.mjs'
import { KEY, session } from './nav.mjs'

const mode = process.argv[2] ?? 'layout'
const check = (ok, what, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? `  ${detail}` : ''}`); if (!ok) process.exitCode = 1; return ok }

if (mode === 'walk') {
  const s = await session()
  await s.c.emulate(393, 852, 2, true)
  await s.tapC(215, -90, 2200)
  await s.tapC(-205, -117, 700); await s.type('TBTST', 500); await s.key(KEY.enter, 3800)
  await s.tapC(-235, -31, 800); await s.tapC(200, -169, 2800)
  await s.key(KEY.enter, 3500); await sleep(14000)
  await s.c.evBody(`await __g.toggleLiveKeyboard({ detail: { checked: true } }); ng.applyChanges(document.querySelector('app-game'))`)
  console.log('on the Jogadores dialog, live keyboard on; frame', JSON.stringify(await s.shot('typebar-jogadores')))
  process.exit(0)
}

const c = await connect()
await c.evBody(`window.__g = ng.getComponent(document.querySelector('app-game')); window.dosCI = window.__g.dosCI`)
const settle = async () => { await c.evBody(`ng.applyChanges(document.querySelector('app-game'))`); await sleep(300) }
const rectOf = async selector => JSON.parse(await c.ev(`JSON.stringify((() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height } })())`))
const tapSel = async (selector, wait = 500) => { const r = await rectOf(selector); if (!r) throw new Error(`no element ${selector}`); await c.tap(r.l + r.w / 2, r.t + r.h / 2, 60); await sleep(wait); return r }
const pictureRects = async () => JSON.stringify([await rectOf('#game-container'), await rectOf('.emulator-canvas')].map(r => [r.l, r.t, r.w, r.h].map(v => Math.round(v * 10) / 10)))
const barInfo = () => c.ev(`JSON.stringify((() => { const bar = document.querySelector('.type-bar'); const f = document.querySelector('.type-bar-field'); return bar ? { compact: bar.classList.contains('type-bar--compact'), focused: document.activeElement === f, value: f.value, badge: (document.querySelector('.type-bar-badge') || {}).textContent } : null })())`).then(JSON.parse)
/** The OS keyboard, simulated: visualViewport reports a smaller height and the real KeyboardInsetService is told. */
const setKeyboard = async px => {
  await c.evBody(`
    if (!window.__vvPatched) { window.__vvPatched = true; window.__kb = 0; Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => window.innerHeight - window.__kb }) }
    window.__kb = ${px}; window.visualViewport.dispatchEvent(new Event('resize'))`)
  await sleep(250)
}
/** Every key the emulator was sent, after the key queue: [ms, code, down]. */
const hook = () => c.evBody(`window.__keys = window.__keys || []; if (!window.__keyHook) { window.__keyHook = true; const o = dosCI.sendKeyEvent.bind(dosCI); dosCI.sendKeyEvent = (k, d) => { window.__keys.push([Math.round(performance.now()), k, d ? 1 : 0]); return o(k, d) } } window.__keys.length = 0`)
const downs = async () => JSON.parse(await c.ev(`JSON.stringify(window.__keys.filter(e => e[2] && e[1] !== 340 && e[1] !== 342).map(e => e[1]))`))
const clearKeys = () => c.evBody(`window.__keys.length = 0`)
const key = (type, p) => c.send('Input.dispatchKeyEvent', { type, ...p })
const press = async (name, code, extra = {}) => { await key('rawKeyDown', { key: name, code: name, windowsVirtualKeyCode: code, ...extra }); await key('keyUp', { key: name, code: name, windowsVirtualKeyCode: code, ...extra }) }

if (mode === 'layout') {
  // [width, height, keyboard px, folded into one row?, what it is]
  const CASES = [
    [393, 852, 0, false, 'portrait, no keyboard'], [393, 852, 250, false, 'portrait, a short keyboard'], [393, 852, 336, true, 'portrait, an iOS-sized keyboard in a tab'],
    [360, 740, 310, true, 'Galaxy A07-like, Gboard'], [430, 932, 336, false, 'iPhone 15 Pro Max in a Safari tab'], [375, 667, 300, true, 'small iPhone'],
    [820, 1180, 300, false, 'tablet portrait'], [844, 390, 0, true, 'landscape phone, no keyboard'], [844, 390, 200, true, 'landscape phone, keyboard'],
    [667, 375, 190, true, 'small landscape phone'], [932, 430, 210, true, 'iPhone 15 Pro Max landscape'], [1180, 820, 300, true, 'tablet landscape'],
  ]
  await c.evBody(`await __g.toggleLiveKeyboard({ detail: { checked: true } })`)
  for (const [w, h, kb, folded, note] of CASES) {
    const label = `${w}x${h} kb ${kb} (${note})`
    await c.emulate(w, h, 2, true); await sleep(500); await setKeyboard(0)
    await c.evBody(`__g.isPopoverOpen = false; __g.deckSheetOpen = false`); await settle()
    const before = await pictureRects()
    await c.evBody(`__g.onTextRequest()`); await sleep(500); await setKeyboard(kb)
    const info = await barInfo(); const bar = await rectOf('.type-bar'); const picture = await rectOf('#game-container')
    const keys = JSON.parse(await c.ev(`JSON.stringify([...document.querySelectorAll('.type-bar button')].filter(b => b.getClientRects().length).map(b => { const r = b.getBoundingClientRect(); return { n: b.getAttribute('aria-label'), w: r.width, h: r.height, l: r.left, r: r.right, t: r.top, b: r.bottom } }))`))
    const field = await rectOf('.type-bar-field')
    check(info.compact === folded, `${label}: ${folded ? 'one row' : 'full window'}`, `room ${Math.round(h - kb - picture.b)}`)
    check(Math.abs(bar.b - (h - kb)) < 1.5, `${label}: the bar's bottom is the keyboard's top`, `${bar.b} vs ${h - kb}`)
    check(bar.l >= 0 && bar.r <= w + 0.5, `${label}: inside the viewport`)
    check(keys.every(k => k.w >= 43.5 && k.h >= 43.5), `${label}: every visible key is 44x44 or more`)
    check(keys.every(k => k.l >= bar.l - 0.5 && k.r <= bar.r + 0.5 && k.t >= bar.t - 0.5 && k.b <= bar.b + 0.5), `${label}: no key leaves the bar`)
    const overlaps = []
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) { const a = keys[i], b = keys[j]; if (Math.min(a.r, b.r) - Math.max(a.l, b.l) > 1 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 1) overlaps.push(`${a.n}/${b.n}`) }
    check(overlaps.length === 0, `${label}: no two keys overlap`, JSON.stringify(overlaps))
    check(field.w >= 120, `${label}: the field is wide enough to write in`, `${Math.round(field.w)} px`)
    check((await pictureRects()) === before, `${label}: #game-container and the canvas have the same rect with the bar open`)
    await c.evBody(`__g.typeBar.close()`); await sleep(200)
    check((await pictureRects()) === before, `${label}: and once it is closed`)
  }
  await setKeyboard(0)
} else if (mode === 'ime') {
  await c.emulate(393, 852, 2, true); await sleep(500)
  await hook()
  await c.evBody(`__g.onTextRequest()`); await sleep(500); await setKeyboard(250)
  check((await barInfo())?.focused, 'the bar is open and focused')
  await clearKeys()
  await c.send('Input.insertText', { text: 'João' }); await sleep(900)
  check(JSON.stringify(await downs()) === JSON.stringify([74, 79, 320, 322, 322, 327, 79]), 'João went out as J o Alt+0227 o', JSON.stringify(await downs()))
  await clearKeys(); await tapSel('.type-bar-strip button[aria-label="Enter"]', 700)
  check(JSON.stringify(await downs()) === '[257]' && (await barInfo()).value === '' && (await barInfo()).focused, 'the strip Enter sent Enter, emptied the bar and left the focus in it')
  await clearKeys()
  for (const t of ['F', 'Fe', 'Feli', 'Felipao']) { await c.send('Input.imeSetComposition', { text: t, selectionStart: t.length, selectionEnd: t.length }); await sleep(60) }
  check((await downs()).length === 0, 'nothing is sent while the word is still being composed')
  await c.send('Input.imeSetComposition', { text: 'Felipe', selectionStart: 6, selectionEnd: 6 }); await sleep(60)
  await c.send('Input.insertText', { text: 'Felipe' }); await sleep(1400)
  check(JSON.stringify(await downs()) === JSON.stringify([70, 69, 76, 73, 80, 69]), 'the committed word went out once, as F e l i p e', JSON.stringify(await downs()))
  await tapSel('.type-bar-strip button[aria-label="Tab"]', 700); await clearKeys()
  await c.send('Input.insertText', { text: 'Silva' }); await sleep(500)
  await c.send('Input.insertText', { text: ' ' }); await sleep(500)
  check((await downs()).length === 5, 'a trailing space is held back: only S i l v a went out')
  await press('Backspace', 8); await sleep(300)
  check((await downs()).length === 5, 'taking the held space back sends nothing')
  await c.send('Input.insertText', { text: ' Jr' }); await sleep(900)
  const k = await downs()
  check(k.length === 8 && k[5] === 32, 'the space goes out when text follows it', JSON.stringify(k))
  await clearKeys(); await press('Backspace', 8); await sleep(400)
  check(JSON.stringify(await downs()) === '[259]', 'Backspace in a field with text is ONE guest Backspace (keydown and input would have been two)')
  await clearKeys(); await press('Enter', 13); await sleep(500)
  check(JSON.stringify(await downs()) === '[257]' && (await barInfo()).value === '', 'a hardware Enter keydown sends Enter, is not typed into the bar and clears it')
  await clearKeys(); await press('Backspace', 8); await sleep(400)
  check(JSON.stringify(await downs()) === '[259]', 'Backspace in the EMPTY bar goes to the guest (no input event exists for it)')
  await clearKeys()
  await c.evBody(`window.__marker = 'alive'`)
  await press('F5', 116); await press('Tab', 9, { modifiers: 8 }); await press('Escape', 27); await sleep(300)
  check(await c.ev('window.__marker') === 'alive' && JSON.stringify(await downs()) === JSON.stringify([294, 258, 256]) && (await barInfo()).focused, 'F5 did not reload; Shift+Tab (Shift itself is not listed) and Esc reached the game; the focus stayed', JSON.stringify(await downs()))
  // a paste: progress and Cancelar
  await clearKeys()
  await c.send('Input.insertText', { text: 'abcdefghij'.repeat(8) }); await sleep(300)
  check(!!(await rectOf('.type-bar-progress')), 'an 80 character paste shows the progress chip')
  await tapSel('.type-bar-progress button', 700)
  const sent = (await downs()).length
  check(sent > 0 && sent < 80, 'Cancelar cut the send part-way', String(sent))
  check((await barInfo()).value === '', 'and the bar was emptied')
  await sleep(2500)
  check((await downs()).length === sent, 'nothing more was typed after the cut')
  await c.evBody(`__g.typeBar.close()`)
} else if (mode === 'hint') {
  const s = await session()
  await c.emulate(393, 852, 2, true); await sleep(500)
  await c.evBody(`await __g.diagnostics.enable({ persist: false })`)
  await c.evBody(`__g.onTextRequest()`); await sleep(500); await setKeyboard(250)
  check((await barInfo())?.focused, 'the bar is open and focused')
  await s.tapG(254, 183, 700)
  check((await barInfo()).focused, 'a tap on the game keeps the focus in the bar: the OS keyboard stays open')
  const signals = JSON.parse(await c.ev(`JSON.stringify(__g.fieldHintService.signals)`))
  check(signals.ibeam?.seen === true, 'the I-beam under the tap was seen')
  await s.tapG(180, 330, 700)
  check(JSON.parse(await c.ev(`JSON.stringify(__g.fieldHintService.signals)`)).ibeam?.seen === false, 'a tap on the dialog face is read as no field')
  await c.evBody(`__g.typeBar.close()`); await sleep(300)
  await s.tapG(254, 207, 900)
  check(await c.ev(`!!document.querySelector('app-dock .deck-tab--field')`), 'the Texto button carries the cue while a field is seen')
  await c.evBody(`__g.fieldHintService.stop(); await new Promise(r => setTimeout(r, 300))`)
  const ms = await c.evBody(`const t0 = performance.now(); __g.fieldHintService.start(__g.dosCI); while (__g.fieldHint !== 'field' && performance.now() - t0 < 6000) await new Promise(r => setTimeout(r, 25)); return Math.round(performance.now() - t0)`)
  check(ms > 1000 && ms < 3000, 'the caret alone takes 1 to 3 s to be seen, from a cold start', `${ms} ms`)
} else if (mode === 'moves') {
  // Jogador 1's field is focused when this starts. Every step below leaves the guest one field further on, so it is read on the screen
  // (`shot`) as well as in the keys: the bar must hold only what belongs to the field the guest is in.
  const s = await session()
  await c.emulate(393, 852, 2, true); await sleep(500)
  await hook()
  await c.evBody(`__g.onTextRequest()`); await sleep(500); await setKeyboard(250)
  check((await barInfo())?.focused, 'the bar is open and focused')
  await clearKeys()
  await c.send('Input.insertText', { text: 'Felipe' }); await sleep(900)
  check(JSON.stringify(await downs()) === JSON.stringify([70, 69, 76, 73, 80, 69]) && (await barInfo()).value === 'Felipe', 'Felipe is in the bar and went to Jogador 1', JSON.stringify(await downs()))

  // 1. A tap on the game's own field: the click moves the guest to Jogador 2, and the bar lets go of "Felipe".
  await s.tapG(254, 183, 900)
  let info = await barInfo()
  check(info.focused, 'a tap on the game keeps the focus in the bar: the OS keyboard stays open')
  check(info.value === '', 'a tap on the game empties the bar: its text belonged to the field the guest just left', JSON.stringify(info.value))
  await clearKeys()
  await c.send('Input.insertText', { text: 'Silva' }); await sleep(700)
  check(JSON.stringify(await downs()) === JSON.stringify([83, 73, 76, 86, 65]) && (await barInfo()).value === 'Silva', 'then Silva alone is typed, and the bar shows only Silva', JSON.stringify(await downs()))
  console.log('   screen after the tap and Silva:', JSON.stringify(await s.shot('moves-1')))

  // 2. A key the deck sends (the same queue and the same call as its keycaps): the guest moves to Jogador 3.
  await s.key(KEY.tab, 500)
  check((await barInfo()).value === '', 'a key from the deck empties the bar')
  await clearKeys()
  await c.send('Input.insertText', { text: 'Costa' }); await sleep(700)
  check(JSON.stringify(await downs()) === JSON.stringify([67, 79, 83, 84, 65]) && (await barInfo()).value === 'Costa', 'and Costa alone is typed after it', JSON.stringify(await downs()))
  console.log('   screen after the deck Tab and Costa:', JSON.stringify(await s.shot('moves-2')))

  // 3. A word still being composed when a strip key is tapped: the old field's word must not stay in the bar.
  await tapSel('.type-bar-strip button[aria-label="Tab"]', 700)
  await clearKeys()
  for (const t of ['L', 'Le', 'Leu']) { await c.send('Input.imeSetComposition', { text: t, selectionStart: t.length, selectionEnd: t.length }); await sleep(60) }
  check((await downs()).length === 0 && (await barInfo()).value === 'Leu', 'Leu is still being composed: nothing sent, the word is in the bar')
  await tapSel('.type-bar-strip button[aria-label="Tab"]', 900)
  info = await barInfo()
  check(JSON.stringify(await downs()) === JSON.stringify([76, 69, 85, 258]), 'the strip Tab first sent what was being composed (L e u) and then Tab', JSON.stringify(await downs()))
  check(info.value === '' && info.focused, 'and ended the composition: the bar is empty and the keyboard\'s field still has the focus', JSON.stringify(info))
  await clearKeys()
  await c.send('Input.insertText', { text: 'Ze' }); await sleep(700)
  check(JSON.stringify(await downs()) === JSON.stringify([90, 69]) && (await barInfo()).value === 'Ze', 'the next word is a new word: Ze alone went to Jogador 5', JSON.stringify(await downs()))
  console.log('   screen after the composed Leu, Tab and Ze:', JSON.stringify(await s.shot('moves-3')))

  // 4. The strip Backspace in the middle of a composition.
  await tapSel('.type-bar-strip button[aria-label="Tab"]', 700); await clearKeys()
  for (const t of ['A', 'Ab']) { await c.send('Input.imeSetComposition', { text: t, selectionStart: t.length, selectionEnd: t.length }); await sleep(60) }
  await tapSel('.type-bar-strip button[aria-label="Backspace, apagar"]', 900)
  info = await barInfo()
  check(JSON.stringify(await downs()) === JSON.stringify([65, 66, 259]) && info.value === 'A', 'the strip Backspace in a composition: the word went out, then ONE Backspace, and the bar reads A', JSON.stringify([await downs(), info]))

  // 5. A pasted Tab is a space, never the key. (Back to Jogador 1 with a tap: Tab from the last field would land on the draw button.)
  await s.tapG(290, 157, 700); await clearKeys()
  await c.send('Input.insertText', { text: 'Zé\tSilva' }); await sleep(1200)
  const pasted = await downs()
  check(!pasted.includes(258) && JSON.stringify(pasted.slice(-6)) === JSON.stringify([32, 83, 73, 76, 86, 65]), 'a pasted Tab typed a space and pressed no Tab: Z, the accent (an Alt code), space, S i l v a', JSON.stringify(pasted))
  console.log('   screen after the pasted Tab and the cut paste:', JSON.stringify(await s.shot('moves-4')))

  // 6. Closing the bar in the middle of a paste stops it, and says so.
  await s.tapG(290, 183, 700); await clearKeys()
  await c.send('Input.insertText', { text: 'abcdefghij'.repeat(8) }); await sleep(250)
  check(!!(await rectOf('.type-bar-progress')), 'an 80 character paste is going out, with its Cancelar')
  await tapSel('.type-bar-close', 600)
  const cut = (await downs()).length
  check(cut > 0 && cut < 80, 'closing the bar cut the paste part-way', String(cut))
  await sleep(2500)
  check((await downs()).length === cut, 'nothing more was typed after the bar was closed')
  check(await c.ev(`[...document.querySelectorAll('ion-toast')].some(t => /Envio cancelado/.test(t.message || ''))`), 'and the player was told')
  check(await c.ev(`!document.querySelector('.type-bar')`), 'the bar is gone')
  check(await c.evBody(`return __g.emulatorControlService.pendingKeys === 0`), 'nothing is left in the key queue')
} else {
  console.error(`unknown mode ${mode}`)
  process.exit(1)
}
