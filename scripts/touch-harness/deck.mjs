#!/usr/bin/env node
/**
 * The control deck against the real page: where it sits, what each key sends, and how a held key repeats.
 *
 *   node scripts/touch-harness/deck.mjs layout [sizes]   the picture's box with the deck on, off and (launcher, rails) with the sheet open; every panel's keys: size, overlap, inside the viewport (a landscape phone's rails are stage.mjs's)
 *   node scripts/touch-harness/deck.mjs keys             one real tap on each key that is safe to press, and what the guest got
 *   node scripts/touch-harness/deck.mjs repeat           a 1.5 s hold on Down: the first repeat, the interval, and the stop on release
 *   node scripts/touch-harness/deck.mjs scroll           a hold with 40 px of vertical drift survives inside the scrolling sheet; a drag from a landing key does not scroll, one from a gap does
 *
 * It needs the page booted by boot.mjs (a dev build: it reads window.ng) and, for `keys` and `repeat`, a screen where Tab, the
 * arrows and the letters do no harm (Acerca or Registo). It never taps Enter, Esc or Sair: on the first dialog Enter and Esc
 * quit the game (see CLAUDE.md, "Guest hazard"), and Alt+F4 is the whole point of its confirm.
 *
 * Keys are recorded by wrapping `dosCI.sendKeyEvent`, so what is graded is what the emulator received, after the key queue.
 */
import { connect, sleep } from './lib.mjs'

const [mode = 'layout', arg] = process.argv.slice(2)
const c = await connect()
const check = (ok, what, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? `  ${detail}` : ''}`); if (!ok) process.exitCode = 1 }
await c.evBody(`window.__g = ng.getComponent(document.querySelector('app-game')); window.dosCI = window.__g.dosCI`)
const settle = async () => { await c.evBody(`ng.applyChanges(document.querySelector('app-game'))`); await sleep(500); await c.evBody(`ng.applyChanges(document.querySelector('app-game'))`); await sleep(250) }
const rects = () => c.ev(`JSON.stringify(['#game-container', '.emulator-canvas'].map(s => { const b = document.querySelector(s).getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map(v => Math.round(v * 10) / 10) }))`)

// `scrolls` is a key inside a panel that overflows: it may be below the viewport until scrolled to, and then it must be reachable
// (inside the panel's scroll height), which is what a panel that shrank its own contents got wrong.
const KEYS_OF = `(() => [...document.querySelectorAll('app-dock .deck-panel .deck-key')].filter(e => e.getClientRects().length).map(e => { const b = e.getBoundingClientRect(); const p = e.closest('.deck-panel'); const pb = p.getBoundingClientRect(); const scrolls = p.scrollHeight > p.clientHeight + 1; return { n: e.getAttribute('aria-label') || e.textContent.trim().slice(0, 12), l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height, scrolls, reachable: b.bottom - pb.top + p.scrollTop <= p.scrollHeight + 1 } }))()`
/** Pairs of keycaps whose boxes share more than 1 px in both directions: a tap aimed at one would land on the other. */
const overlaps = keys => {
  const found = []
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const a = keys[i], b = keys[j]
    if (Math.min(a.r, b.r) - Math.max(a.l, b.l) > 1 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 1) found.push(`${a.n} / ${b.n}`)
  }
  return found
}
/** Shows a panel of keys without tapping (a second tap on the open tab would fold it). */
/** One wrapper on `sendKeyEvent` for every mode, writing [ms, code, down] to window.__keys (a second wrapper would record each event twice). */
const hookKeys = () => c.evBody(`window.__keys = window.__keys || []; if (!window.__keyHook) { window.__keyHook = true; const o = dosCI.sendKeyEvent.bind(dosCI); dosCI.sendKeyEvent = (k, d) => { window.__keys.push([Math.round(performance.now()), k, d ? 1 : 0]); return o(k, d) } } window.__keys.length = 0`)
const showPanel = panel => c.evBody(`const d = ng.getComponent(document.querySelector('app-dock')); d.panelState = { keys: '${panel}', chatOpen: false }; ng.applyChanges(d)`)

if (mode === 'layout') {
  const sizes = (arg || '360x640,375x667,393x852,412x915,430x932,844x390,932x430,667x375,820x1180,1180x820,1024x768,768x1024,1280x800,375x553,360x512,320x460,667x340,667x320,852x340,800x290').split(',').map(s => s.split('x').map(Number))
  for (const [w, h] of sizes) {
    await c.emulate(w, h, 2, true)
    await c.evBody(`__g.applyDeckSetting('auto')`); await settle()
    const kind = await c.ev(`__g.layout.kind + '/' + __g.layout.shape`)
    const withDeck = await rects()
    let withSheet = withDeck
    if (kind.startsWith('launcher') || kind.startsWith('rails')) { await c.evBody(`__g.deckSheetOpen = true`); await settle(); withSheet = await rects() }
    // Every panel, in the presentation the page picked: the keys' sizes, whether any two overlap, whether any is outside the viewport.
    for (const panel of ['tactics', 'arrows', 'more']) {
      await showPanel(panel); await settle()
      const keys = await c.ev(KEYS_OF)
      const picture = await c.ev(`(() => { const b = document.querySelector('#game-container').getBoundingClientRect(); return { b: b.bottom, r: b.right } })()`)
      const clash = overlaps(keys)
      check(clash.length === 0, `${w}x${h} ${kind} / ${panel}: no two keycaps overlap`, JSON.stringify(clash.slice(0, 4)))
      const bad = keys.filter(k => k.h < 43.5 || k.w < 43.5 || k.r > w + 0.5 || (k.scrolls ? !k.reachable : k.b > h + 0.5) || (kind.startsWith('band') && k.t < picture.b - 0.5)).map(k => `${k.n} ${Math.round(k.w)}x${Math.round(k.h)}`)
      check(bad.length === 0, `${w}x${h} ${kind} / ${panel}: every keycap is 44x44 or more and inside the viewport or reachable by scrolling${kind.startsWith('band') ? ' and under the picture' : ''}`, JSON.stringify(bad.slice(0, 4)))
    }
    await c.evBody(`__g.deckSheetOpen = false`)
    await c.evBody(`__g.applyDeckSetting('off')`); await settle()
    const without = await rects()
    await c.evBody(`__g.applyDeckSetting('auto')`); await settle()
    check(withDeck === without && withSheet === without, `${w}x${h} ${kind}: the picture's box is the same with the deck on, off and the sheet open`, withDeck)
  }
} else if (mode === 'keys') {
  await c.emulate(393, 852, 2, true); await settle()
  await hookKeys()
  const tapLabel = async label => {
    const p = await c.ev(`(() => { const e = [...document.querySelectorAll('app-dock button')].find(b => b.getAttribute('aria-label') === ${JSON.stringify(label)} || (b.querySelector('.deck-key-label, .deck-tab-label') || {}).textContent === ${JSON.stringify(label)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
    if (!p) return false
    await c.tap(p.x, p.y, 60); await sleep(350); return true
  }
  // A second tap on the open tab folds its panel, so a tab is tapped only when it is not the one that is up.
  const openPanel = async name => {
    const on = await c.ev(`[...document.querySelectorAll('app-dock .deck-tab--on .deck-tab-label')].some(l => l.textContent.trim() === ${JSON.stringify(name)})`)
    if (!on) await tapLabel(name)
    await sleep(300)
  }
  const sent = async () => { const k = await c.ev('window.__keys.map(e => [e[1], e[2]])'); await c.evBody('window.__keys.length = 0'); return k }
  const panels = { Táticas: [], Setas: [], Mais: [] }
  for (const panel of Object.keys(panels)) {
    await openPanel(panel)
    const labels = await c.ev(`[...document.querySelectorAll('app-dock .deck-panel .deck-key')].map(b => b.getAttribute('aria-label'))`)
    panels[panel] = labels
  }
  const SKIP = /^(Enter|Esc|Sair|Abrir)|^(Shift|Ctrl|Alt)(,|$)/
  for (const [panel, labels] of Object.entries(panels)) {
    await openPanel(panel); await sent()
    for (const label of labels.filter(l => l && !SKIP.test(l))) {
      await tapLabel(label)
      const k = await sent()
      const downs = k.filter(e => e[1] === 1).map(e => e[0])
      const ups = k.filter(e => e[1] === 0).map(e => e[0])
      const fn = /^F(\d+),/.exec(label) ?? /^F(\d+)$/.exec(label)
      const ok = downs.length >= 1 && downs.length === ups.length && (!fn || downs[0] === 289 + Number(fn[1]))
      check(ok, `${panel} / ${label}`, `down ${JSON.stringify(downs)} up ${JSON.stringify(ups)}`)
    }
  }
} else if (mode === 'repeat') {
  await c.emulate(393, 852, 2, true); await settle()
  await hookKeys()
  const tab = await c.ev(`(() => { const e = [...document.querySelectorAll('app-dock .deck-tab')].find(b => b.textContent.trim() === 'Setas'); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
  await c.tap(tab.x, tab.y, 60); await sleep(400)
  const down = await c.ev(`(() => { const e = [...document.querySelectorAll('app-dock button')].find(b => b.getAttribute('aria-label') === 'Seta para baixo'); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
  await c.evBody('window.__keys.length = 0')
  await c.touch('touchStart', [{ x: down.x, y: down.y }]); await sleep(1500); await c.touch('touchEnd', []); await sleep(100)
  const atRelease = (await c.ev('window.__keys.filter(e => e[2] === 1).length'))
  await sleep(800)
  const downs = (await c.ev('window.__keys.filter(e => e[2] === 1).map(e => e[0])'))
  const gaps = downs.slice(1).map((t, i) => t - downs[i])
  check(Math.abs(gaps[0] - 380) <= 40, 'the first repeat comes about 380 ms after the landing', `${gaps[0]} ms`)
  const interval = gaps.slice(1)
  check(interval.every(g => g >= 40 && g <= 75), 'the repeats are 40-75 ms apart', `min ${Math.min(...interval)} max ${Math.max(...interval)} over ${interval.length}`)
  check(downs.length === atRelease, 'nothing is pressed after the finger lifts', `${atRelease} at release, ${downs.length} 800 ms later`)
} else if (mode === 'scroll') {
  // The sheet's panels scroll (pan-y), and a key that presses on landing sits inside one. Without `.deck-key--landing` the browser
  // took a vertical drift over ~20 px for a scroll, cancelled the pointer, and a held arrow stopped dead.
  await c.emulate(667, 320, 2, true); await settle()
  await c.evBody(`__g.applyDeckSetting('auto'); __g.deckSheetOpen = true`); await settle()
  await hookKeys()
  await c.evBody(`window.__cancels = 0; if (!window.__cancelHook) { window.__cancelHook = true; addEventListener('pointercancel', () => { window.__cancels++ }, true) }`)
  const centre = label => c.ev(`(() => { const e = [...document.querySelectorAll('app-dock .deck-sheet button')].find(b => b.getAttribute('aria-label') === ${JSON.stringify(label)}); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
  const sheetTab = async name => { const p = await c.ev(`(() => { const e = [...document.querySelectorAll('app-dock .deck-sheet .deck-tab')].find(b => b.textContent.trim() === ${JSON.stringify(name)}); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`); await c.tap(p.x, p.y, 60); await sleep(400) }
  const drag = async (from, dy, steps = 8, hold = 1200) => {
    await c.touch('touchStart', [from]); await sleep(60)
    for (let i = 1; i <= steps; i++) { await c.touch('touchMove', [{ x: from.x, y: from.y + dy * i / steps }]); await sleep(hold / steps) }
    await c.touch('touchEnd', []); await sleep(150)
  }
  const downsOf = () => c.ev(`window.__keys.filter(e => e[2] === 1).length`)

  await sheetTab('Setas')
  const down = await centre('Seta para baixo')
  await c.evBody('window.__keys.length = 0; window.__cancels = 0')
  await drag(down, 40)
  const held = await downsOf()
  const cancels = await c.ev('window.__cancels')
  check(cancels === 0 && held >= 12, 'a held arrow in the scrolling sheet keeps repeating through 40 px of vertical drift', `${held} presses, ${cancels} pointercancel`)
  await sleep(700)
  check(await downsOf() === held, 'and nothing is pressed after the finger lifts', `${held} then ${await downsOf()}`)

  await sheetTab('Mais')
  const scroller = `document.querySelector('app-dock .deck-sheet .deck-panel--scroll')`
  const overflow = await c.ev(`${scroller}.scrollHeight - ${scroller}.clientHeight`)
  check(overflow > 0, 'Mais teclas overflows the 667x320 sheet, so the scroll cases mean something', `${overflow} px`)
  // From a key that presses on landing (Del): it types, and the panel does not move.
  await c.evBody(`${scroller}.scrollTop = 0; window.__keys.length = 0; window.__cancels = 0`)
  await drag(await centre('Delete'), -60, 6, 400)
  const delSent = await c.ev(`window.__keys.filter(e => e[2] === 1).map(e => e[1])`)
  const movedFromKey = await c.ev(`${scroller}.scrollTop`)
  check(delSent[0] === 261 && movedFromKey === 0 && (await c.ev('window.__cancels')) === 0, 'a drag that starts on Del types it and does not scroll or cancel', `sent ${JSON.stringify(delSent.slice(0, 3))}, scrollTop ${movedFromKey}`)
  // From a key that presses on release (Home): the browser takes the gesture, the panel scrolls, nothing is typed.
  await c.evBody(`${scroller}.scrollTop = 0; window.__keys.length = 0; window.__cancels = 0`)
  const home = await c.ev(`(() => { const e = [...document.querySelectorAll('app-dock .deck-sheet button')].find(b => b.getAttribute('aria-label') === 'Home, início'); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
  await drag(home, -80, 8, 400)
  const homeSent = await c.ev(`window.__keys.length`)
  const movedFromRelease = await c.ev(`${scroller}.scrollTop`)
  check(homeSent === 0 && movedFromRelease > 0, 'a drag that starts on Home scrolls the panel and types nothing', `sent ${homeSent}, scrollTop ${movedFromRelease}`)
  await c.evBody(`__g.deckSheetOpen = false`)
} else {
  console.error('usage: deck.mjs layout|keys|repeat|scroll')
  process.exit(1)
}
process.exit(process.exitCode ?? 0)
