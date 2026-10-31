#!/usr/bin/env node
/**
 * The stage against the real page: where the picture is, what the rails and the chat take, and that nothing but the documented
 * inputs moves it. It is the evidence behind CLAUDE.md's *The stage* and the contract that no panel, sheet or keyboard may break.
 *
 *   node scripts/touch-harness/stage.mjs layout [sizes]   the picture's box at 19 windows, with every input the contract names and every one it does not (the OS keyboard twice: simulated, and as a browser that really shrinks its layout viewport)
 *   node scripts/touch-harness/stage.mjs rails            the keys of a landscape phone's rails: size, overlap, reach, one real tap on each safe key, a held arrow, the sheet, and that the room's pill is drawn inside its own capsule
 *   node scripts/touch-harness/stage.mjs guest <port>     the spectator's picture against the host's, window by window (the host here, the guest's driver on <port>, in a room: see room.mjs)
 *   node scripts/touch-harness/stage.mjs room <port>      the room itself at the new stage: a remote cursor lands where the guest pointed, the chat both ways with each picture's box, in the rail and out of it
 *   node scripts/touch-harness/stage.mjs leave <port>     the spectator's rail: Sala opens the room window, Sair asks first, a confirmed leave reloads the page and the host's roster drops
 *
 * It needs the page booted by boot.mjs (a dev build: it reads window.ng). `layout` starts a room on the host the first time it needs
 * one (no peer is needed to host), which is why it is the only mode that leaves one running. `rails` never taps Enter or Esc: on the
 * first dialog they quit the game (see CLAUDE.md, "Guest hazard").
 *
 * Safe areas are emulated with `Emulation.setSafeAreaInsetsOverride`, which the headless shell has: the notch of a landscape iPhone is
 * 47 px a side (44 on an X, 59 with the Dynamic Island) and the home indicator 21 px. The OS keyboard is simulated as the type bar's
 * harness does (typebar.mjs): `visualViewport.height` is made `innerHeight - px` and a `resize` dispatched on it, and `--kb-inset`
 * written for the pages that do not run the inset service. That simulation moves nothing the stage reads, so it cannot fail; the other
 * keyboard is the real thing for a browser that resizes the LAYOUT viewport (the window gets half as tall while an <input> has the
 * focus), which fails without StageLayoutService's `covered` compensation.
 */
import { connect, sleep } from './lib.mjs'

const [mode = 'layout', arg] = process.argv.slice(2)
const c = await connect()
const check = (ok, what, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? `  ${detail}` : ''}`); if (!ok) process.exitCode = 1 }
await c.evBody(`window.__g = ng.getComponent(document.querySelector('app-game')); window.dosCI = window.__g.dosCI`)
const settle = async () => { await c.evBody(`ng.applyChanges(document.querySelector('app-game'))`); await sleep(650); await c.evBody(`ng.applyChanges(document.querySelector('app-game'))`); await sleep(250) }
const round = v => Math.round(v * 100) / 100
const rect = selector => c.ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map(v => Math.round(v * 100) / 100) })()`)
const same = (a, b, tolerance = 0.01) => !!a && !!b && a.every((v, i) => Math.abs(v - b[i]) <= tolerance)
const emulate = async (w, h, l = 0, r = 0, b = 0, top = 0) => {
  await c.emulate(w, h, 2, true)
  await c.send('Emulation.setSafeAreaInsetsOverride', { insets: { top, left: l, bottom: b, right: r } })
  await settle()
}
/** The OS keyboard, simulated; --kb-inset is written by hand as well, for the pages where the inset service is not running. */
const keyboard = px => c.evBody(`
  if (!window.__vvPatched) { window.__vvPatched = true; window.__kb = 0; Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => window.innerHeight - window.__kb }) }
  window.__kb = ${px}; document.documentElement.style.setProperty('--kb-inset', '${px}px'); document.documentElement.style.setProperty('--kb-open', '${px ? 1 : 0}')
  window.visualViewport.dispatchEvent(new Event('resize'))`)
const plan = () => c.ev(`JSON.parse(JSON.stringify(__g.stagePlan))`)
const vars = () => c.ev(`(() => { const s = getComputedStyle(document.documentElement); return Object.fromEntries(['--stage-w', '--stage-h', '--stage-mx', '--stage-my', '--stage-left', '--stage-right', '--chat-panel-width', '--chat-dock-w'].map(n => [n, s.getPropertyValue(n).trim()])) })()`)

/** [width, height, left inset, right inset, bottom inset, what it is] */
const MATRIX = [
  [360, 640, 0, 0, 0, 'A07-class portrait'], [375, 667, 0, 0, 0, 'iPhone SE portrait'], [393, 852, 0, 0, 0, 'iPhone 15 Pro portrait'],
  [412, 915, 0, 0, 0, 'Pixel portrait'], [430, 932, 0, 0, 0, 'iPhone 15 Pro Max portrait'],
  [844, 390, 47, 47, 21, 'iPhone 13/14 landscape (notch)'], [844, 390, 0, 0, 0, '844x390 without a notch'], [915, 412, 0, 0, 0, 'A07-class landscape'],
  [932, 430, 59, 59, 21, 'iPhone 15 Pro Max landscape'], [852, 393, 59, 59, 21, 'iPhone 15 Pro landscape'], [812, 375, 44, 44, 21, 'iPhone X landscape'],
  [667, 375, 0, 0, 0, 'iPhone SE landscape'], [640, 360, 0, 0, 0, 'small Android landscape'],
  [820, 1180, 0, 0, 0, 'iPad portrait'], [768, 1024, 0, 0, 0, 'iPad mini portrait'], [1180, 820, 0, 0, 0, 'iPad Air landscape'],
  [1024, 768, 0, 0, 0, 'iPad landscape'], [1280, 800, 0, 0, 0, 'laptop'], [1366, 768, 0, 0, 0, 'laptop 1366'],
]

/** The spectator's browser (a second driver.mjs on <port>), with the few calls the checks need. */
const connectGuest = async port => {
  const base = `http://127.0.0.1:${port}`
  const { sid } = await (await fetch(`${base}/session`)).json()
  const send = async (method, params = {}) => { const m = await (await fetch(`${base}/send`, { method: 'POST', body: JSON.stringify({ method, params, sessionId: sid }) })).json(); if (m.error) throw new Error(`${method} ${JSON.stringify(m.error)}`); return m.result }
  const ev = async expression => { const r = await send('Runtime.evaluate', { expression: `(async()=>(${expression}))()`, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value }
  return {
    send, ev,
    emulate: async (w, h, l = 0, r = 0, b = 0) => { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true }); await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); await send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, left: l, bottom: b, right: r } }) },
    tap: async (x, y) => { await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 0 }] }); await sleep(70); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }) },
    mouse: (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y }),
    rect: selector => ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map(v => Math.round(v * 100) / 100) })()`),
  }
}
const centre = r => ({ x: r[0] + r[2] / 2, y: r[1] + r[3] / 2 })

if (mode === 'layout') {
  const wanted = arg ? arg.split(',').map(s => s.split('x').map(Number)) : null
  const list = wanted ? MATRIX.filter(m => wanted.some(([w, h]) => w === m[0] && h === m[1])) : MATRIX
  let hosted = false
  const table = []
  for (const [w, h, l, r, b, what] of list) {
    await emulate(w, h, l, r, b)
    await c.evBody(`__g.applyDeckSetting('auto'); __g.applyStageView('fit')`); await settle()
    const label = `${w}x${h}${l || r ? ` (${l}/${r}/${b})` : ''}`
    const p = await plan()
    const landscape = w > h
    const R0 = await rect('#game-container')
    const canvas = await rect('.emulator-canvas')
    const v = await vars()

    // ---- what the page is: the container is the picture ----
    if (landscape) {
      check(same(R0, canvas, 1), `${label}: #game-container is the canvas (the picture), to the pixel`, `${JSON.stringify(R0)} vs ${JSON.stringify(canvas)}`)
      check(Math.abs(R0[2] - parseFloat(v['--stage-w'])) <= 0.5 && Math.abs(R0[3] - parseFloat(v['--stage-h'])) <= 0.5, `${label}: it is the size the plan wrote (--stage-w x --stage-h)`, `${R0[2]}x${R0[3]} vs ${v['--stage-w']} x ${v['--stage-h']}`)
      check(Math.round(R0[2]) * 3 === Math.round(R0[3]) * 4, `${label}: exactly 4:3`, `${R0[2]}x${R0[3]}`)
      check(Math.abs(R0[0] - (p.offset.x)) <= 0.5 && Math.abs(R0[1] - (p.offset.y) - (await rect('.game-stream-flex-container'))[1]) <= 0.5, `${label}: and where the plan put it`, `x ${R0[0]} vs ${p.offset.x}`)
    } else {
      check(Math.abs(R0[2] - w) <= 0.5 && Math.abs(R0[3] - Math.min(h - 56, w * 0.75)) <= 1, `${label}: portrait is still the width and its 75vw height`, JSON.stringify(R0))
    }
    if (p.leftColumns || p.rightColumns) {
      const rl = await rect('.stage-rail--left'); const rr = await rect('.stage-rail--right')
      check(Math.abs(rl[2] - p.left) <= 0.5, `${label}: the left rail is as wide as the plan says (${p.left} px)`, JSON.stringify(rl))
      if (p.rightColumns) check(Math.abs(rr[2] - p.right) <= 0.5, `${label}: and the right one (${p.right} px)`, JSON.stringify(rr))
      check(rl[0] + rl[2] <= R0[0] + 0.5 && (!rr || R0[0] + R0[2] <= rr[0] + 0.5), `${label}: the rails are beside the picture, never over it`)
    }

    // ---- the inputs the contract says do NOT move it ----
    const kind = await c.ev(`__g.layout.kind + '/' + __g.layout.shape`)
    let sheet = 'n/a'
    if (kind.startsWith('launcher') || kind.startsWith('rails')) {
      await c.evBody(`__g.deckSheetOpen = true`); await settle()
      sheet = same(await rect('#game-container'), R0) ? 'same' : 'MOVED'
      check(sheet === 'same', `${label}: the sheet open does not move the picture`)
      await c.evBody(`__g.deckSheetOpen = false`); await settle()
    }
    await keyboard(w > h ? 200 : 300); await settle()
    const kb = same(await rect('#game-container'), R0) ? 'same' : 'MOVED'
    check(kb === 'same', `${label}: the OS keyboard (simulated) does not move the picture`)
    await keyboard(0); await settle()
    // The simulation above only moves visualViewport, which nothing in the stage reads, so it cannot fail. This is the keyboard of a
    // browser that RESIZES the layout viewport (older Android WebViews, some OEM browsers): the window itself gets half as tall while
    // a field has the focus, the element shrinks with it, and LayoutShapeHelper.settle holds the shape. The stage must hold too.
    // Landscape only: in portrait such a window is also `(orientation: landscape)` to the stylesheets, which is the documented limit.
    let shrunk = 'n/a'
    if (landscape) {
      await c.evBody(`const i = document.createElement('input'); i.id = '__kbprobe'; i.style.cssText = 'position:fixed;left:0;bottom:0;width:10px;height:10px;opacity:0.01'; document.body.appendChild(i); i.focus()`)
      await c.emulate(w, Math.round(h / 2), 2, true); await settle()
      const during = await rect('#game-container')
      shrunk = same(during, R0) ? 'same' : 'MOVED'
      check(shrunk === 'same', `${label}: the layout viewport shrunk to ${Math.round(h / 2)} px with a field focused does not move the picture`, `${JSON.stringify(R0)} -> ${JSON.stringify(during)}`)
      await c.emulate(w, h, 2, true); await settle()
      check(same(await rect('#game-container'), R0), `${label}: and it is exactly where it was when the keyboard goes`)
      await c.evBody(`document.getElementById('__kbprobe')?.remove()`)
    }
    await c.evBody(`__g.applyDeckSetting('off')`); await settle()
    const off = same(await rect('#game-container'), R0) ? 'same' : 'MOVED'
    check(off === 'same', `${label}: the deck off does not move the picture`, JSON.stringify(await rect('#game-container')))
    await c.evBody(`__g.applyDeckSetting('on')`); await settle()
    const on = same(await rect('#game-container'), R0) ? 'same' : 'MOVED'
    check(on === 'same', `${label}: ${kind.startsWith('none') ? 'forcing the deck on' : 'the deck on'} does not move the picture${kind.startsWith('none') ? ' (a launcher in the toolbar)' : ''}`)
    await c.evBody(`__g.applyDeckSetting('auto')`); await settle()

    // ---- Ampliar: the player's one input that is allowed to ----
    await c.evBody(`__g.applyStageView('wide')`); await settle()
    const wide = await rect('#game-container')
    const wideNote = same(wide, R0) ? 'same' : `${wide[2]}x${wide[3]} at ${wide[0]}`
    await c.evBody(`__g.applyStageView('fit')`); await settle()
    check(same(await rect('#game-container'), R0), `${label}: Ajustar again is the picture it was`)

    // ---- a room: the pill and the Chat key appear, the picture does not move; then the chat, which is allowed to ----
    if (!hosted) {
      await c.evBody(`__g.hostRoomId = 'ELI-TSTA'; __g.hostName = 'Anfitriao'; __g.hostMaxSpectators = 6; await __g.startHosting()`).catch(() => undefined)
      await sleep(1500); await settle(); hosted = true
    }
    const R1 = await rect('#game-container')
    check(same(R1, R0), `${label}: a room starting (the pill, the Chat key) does not move the picture`, `${JSON.stringify(R0)} -> ${JSON.stringify(R1)}`)
    await c.evBody(`__g.toggleChat(true)`); await sleep(500); await settle()
    const open = await rect('#game-container')
    const dock = await vars()
    await c.evBody(`__g.toggleChat(false)`); await sleep(700); await settle()
    const closed = await rect('#game-container')
    check(same(closed, R0), `${label}: closing the chat gives the picture back exactly`, `${JSON.stringify(closed)} vs ${JSON.stringify(R0)}`)
    const chatNote = same(open, R0) ? 'same' : `${open[2]}x${open[3]} at ${open[0]} (${round((1 - open[2] / R0[2]) * 100)}% smaller)`
    if (!landscape) check(chatNote === 'same', `${label}: the chat under a portrait picture does not move it`)
    else check(open[0] >= 0 && open[0] + open[2] <= w + 0.5, `${label}: with the chat open the picture is on screen (dock ${dock['--chat-dock-w']})`)
    table.push(`${label.padEnd(18)} ${kind.padEnd(24)} columns ${p.leftColumns}+${p.rightColumns}  stage ${R0[2]}x${R0[3]} at ${R0[0]},${R0[1]}  sheet ${sheet}  keyboard ${kb}  resized-keyboard ${shrunk}  deck-off ${off}  Ampliar ${wideNote}  chat ${chatNote}   ${what}`)
  }
  console.log('\n' + table.join('\n'))
  await c.evBody(`__g.stopHosting && __g.stopHosting()`).catch(() => undefined)
} else if (mode === 'rails') {
  const hookKeys = () => c.evBody(`window.__keys = window.__keys || []; if (!window.__keyHook) { window.__keyHook = true; const o = dosCI.sendKeyEvent.bind(dosCI); dosCI.sendKeyEvent = (k, d) => { window.__keys.push([Math.round(performance.now()), k, d ? 1 : 0]); return o(k, d) } } window.__keys.length = 0`)
  const RAIL_KEYS = `(() => [...document.querySelectorAll('.stage-rail button, .stage-rail .rail-menu-btn')].filter(e => e.getClientRects().length).map(e => { const b = e.getBoundingClientRect(); const p = e.closest('.stage-rail'); const pb = p.getBoundingClientRect(); const scrolls = p.scrollHeight > p.clientHeight + 1; return { n: e.getAttribute('aria-label') || e.textContent.trim().slice(0, 12), side: p.classList.contains('stage-rail--left') ? 'L' : 'R', l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height, scrolls, reachable: b.bottom - pb.top + p.scrollTop <= p.scrollHeight + 1 } }))()`
  const overlaps = keys => {
    const found = []
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      const a = keys[i], k = keys[j]
      if (Math.min(a.r, k.r) - Math.max(a.l, k.l) > 1 && Math.min(a.b, k.b) - Math.max(a.t, k.t) > 1) found.push(`${a.n} / ${k.n}`)
    }
    return found
  }
  const sizes = [[844, 390, 47, 47, 21], [844, 390, 0, 0, 0], [915, 412, 0, 0, 0], [932, 430, 59, 59, 21], [852, 393, 59, 59, 21], [667, 375, 0, 0, 0], [640, 360, 0, 0, 0], [667, 320, 0, 0, 0], [667, 340, 0, 0, 0], [800, 290, 0, 0, 0]]
  for (const [w, h, l, r, b] of sizes) {
    await emulate(w, h, l, r, b)
    await c.evBody(`__g.applyDeckSetting('auto'); __g.applyStageView('fit')`); await settle()
    const label = `${w}x${h}${l || r ? ` (${l}/${r}/${b})` : ''}`
    const p = await plan()
    const keys = await c.ev(RAIL_KEYS)
    const stage = await rect('#game-container')
    const clash = overlaps(keys)
    check(clash.length === 0, `${label}: no two keys overlap (${p.leftColumns}+${p.rightColumns} columns, ${keys.length} controls)`, JSON.stringify(clash.slice(0, 4)))
    const bad = keys.filter(k => k.h < 43.5 || k.w < 43.5 || k.r > w + 0.5 || (k.scrolls ? !k.reachable : k.b > h + 0.5)).map(k => `${k.n} ${Math.round(k.w)}x${Math.round(k.h)}`)
    check(bad.length === 0, `${label}: every control is 44x44 or more, inside the window or reachable by scrolling`, JSON.stringify(bad.slice(0, 4)))
    const inside = keys.filter(k => (k.side === 'L' && k.r > stage[0] + 0.5) || (k.side === 'R' && k.l < stage[0] + stage[2] - 0.5)).map(k => k.n)
    check(inside.length === 0, `${label}: no key is over the picture`, JSON.stringify(inside))
    const scrolls = keys.some(k => k.scrolls)
    console.log(`      ${label}: ${scrolls ? 'a rail scrolls (the window is shorter than seven rows)' : 'no rail scrolls'}`)
  }

  // ---- one real tap on each key of the two-column rails that is safe to press ----
  await emulate(844, 390, 0, 0, 0)
  await c.evBody(`__g.applyDeckSetting('auto'); __g.applyStageView('fit')`); await settle()
  await hookKeys()
  const tapLabel = async label => {
    const pt = await c.ev(`(() => { const e = [...document.querySelectorAll('.stage-rail button')].find(b => b.getAttribute('aria-label') === ${JSON.stringify(label)} || (b.querySelector('.deck-key-label') || {}).textContent === ${JSON.stringify(label)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
    if (!pt) return false
    await c.tap(pt.x, pt.y, 60); await sleep(350); return true
  }
  const labels = await c.ev(`[...document.querySelectorAll('.stage-rail .deck-key')].map(b => b.getAttribute('aria-label'))`)
  const SKIP = /^(Enter|Esc|Texto|Painel de teclas|Digitar)/
  for (const label of labels.filter(l => l && !SKIP.test(l))) {
    await c.evBody('window.__keys.length = 0')
    await tapLabel(label)
    const k = await c.ev('window.__keys.map(e => [e[1], e[2]])')
    const downs = k.filter(e => e[1] === 1).map(e => e[0]); const ups = k.filter(e => e[1] === 0).map(e => e[0])
    const fn = /^F(\d+),/.exec(label)
    check(downs.length >= 1 && downs.length === ups.length && (!fn || downs[0] === 289 + Number(fn[1])), `a tap on "${label}" in a rail is one key down and up`, `down ${JSON.stringify(downs)} up ${JSON.stringify(ups)}`)
  }

  // ---- the sheet opens beside the left rail, and closes ----
  const beforeSheet = await rect('#game-container')
  await tapLabel('Painel de teclas'); await settle()
  const sheet = await rect('.deck-sheet'); const rl = await rect('.stage-rail--left')
  check(!!sheet && Math.abs(sheet[0] - (rl[0] + rl[2])) <= 1, 'the Teclas key opens the sheet from the left rail\'s edge, not over the rail', JSON.stringify(sheet))
  check(same(await rect('#game-container'), beforeSheet), 'and the picture does not move for it')
  await c.evBody(`__g.deckSheetOpen = false`); await settle()

  // ---- a held arrow in a rail: the repeat, and nothing after the finger lifts ----
  await hookKeys()
  const down = await c.ev(`(() => { const e = [...document.querySelectorAll('.stage-rail button')].find(b => b.getAttribute('aria-label') === 'Seta para baixo'); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
  await c.evBody('window.__keys.length = 0')
  await c.touch('touchStart', [{ x: down.x, y: down.y }]); await sleep(1500); await c.touch('touchEnd', []); await sleep(100)
  const atRelease = await c.ev('window.__keys.filter(e => e[2] === 1).length')
  await sleep(800)
  const downs = await c.ev('window.__keys.filter(e => e[2] === 1).map(e => e[0])')
  const gaps = downs.slice(1).map((t, i) => t - downs[i])
  check(Math.abs(gaps[0] - 380) <= 40, 'the first repeat of a held arrow comes about 380 ms after the landing', `${gaps[0]} ms`)
  check(gaps.slice(1).every(g => g >= 40 && g <= 75), 'the repeats are 40-75 ms apart', `min ${Math.min(...gaps.slice(1))} max ${Math.max(...gaps.slice(1))} over ${gaps.length - 1}`)
  check(downs.length === atRelease, 'nothing is pressed after the finger lifts', `${atRelease} at release, ${downs.length} 800 ms later`)

  // ---- in a window shorter than seven rows the rail scrolls, and a held arrow survives 40 px of drift ----
  await emulate(667, 300, 0, 0, 0)
  await c.evBody(`__g.applyDeckSetting('auto')`); await settle()
  await hookKeys()
  await c.evBody(`window.__cancels = 0; if (!window.__cancelHook) { window.__cancelHook = true; addEventListener('pointercancel', () => { window.__cancels++ }, true) }`)
  const arrow = await c.ev(`(() => { const e = [...document.querySelectorAll('.stage-rail button')].find(b => b.getAttribute('aria-label') === 'Seta para baixo'); e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
  await c.evBody('window.__keys.length = 0; window.__cancels = 0')
  await c.touch('touchStart', [arrow]); await sleep(60)
  for (let i = 1; i <= 8; i++) { await c.touch('touchMove', [{ x: arrow.x, y: arrow.y + 40 * i / 8 }]); await sleep(150) }
  await c.touch('touchEnd', []); await sleep(200)
  const held = await c.ev(`window.__keys.filter(e => e[2] === 1).length`)
  check((await c.ev('window.__cancels')) === 0 && held >= 12, 'a held arrow in a scrolling rail keeps repeating through 40 px of vertical drift', `${held} presses, ${await c.ev('window.__cancels')} pointercancel`)

  // ---- the room's pill in a rail: the dot, the code and the lock are all inside the capsule that is painted ----
  await c.evBody(`__g.hostRoomId = 'ELI-TSTA'; __g.hostName = 'Anfitriao'; __g.hostMaxSpectators = 6; await __g.startHosting()`).catch(() => undefined)
  await sleep(1500)
  const PILL = `(() => { const p = document.querySelector('.stage-rail .mp-status-pill'); if (!p) return null; const cs = getComputedStyle(p); const b = p.getBoundingClientRect(); const px = v => parseFloat(v) || 0
    const painted = cs.backgroundClip === 'padding-box' ? { l: b.left + px(cs.borderLeftWidth), t: b.top + px(cs.borderTopWidth), r: b.right - px(cs.borderRightWidth), b: b.bottom - px(cs.borderBottomWidth) } : { l: b.left, t: b.top, r: b.right, b: b.bottom }
    const rail = p.closest('.stage-rail').getBoundingClientRect()
    const kids = [...p.children].filter(e => e.getClientRects().length).map(e => { const r = e.getBoundingClientRect(); return { n: e.className.split(' ')[0], l: r.left, t: r.top, r: r.right, b: r.bottom } })
    return { painted, rail: { l: rail.left, r: rail.right }, kids, height: painted.b - painted.t, clip: cs.backgroundClip, lines: Math.round(p.querySelector('.mp-status-code').getBoundingClientRect().height / parseFloat(getComputedStyle(p.querySelector('.mp-status-code')).lineHeight)) } })()`
  for (const [w, h, l, r, b] of [[667, 375, 0, 0, 0], [640, 360, 0, 0, 0], [852, 393, 59, 59, 21], [844, 390, 0, 0, 0], [915, 412, 0, 0, 0]]) {
    await emulate(w, h, l, r, b)
    const label = `${w}x${h}${l || r ? ` (${l}/${r}/${b})` : ''}`
    for (const locked of [false, true]) {
      await c.evBody(`__g.hostPassword = ${locked ? "'abc'" : "''"}; ng.applyChanges(document.querySelector('app-game'))`); await sleep(300)
      const pill = await c.ev(PILL)
      if (!pill) { check(false, `${label}: the pill is in the rail`); continue }
      const out = pill.kids.filter(k => k.l < pill.painted.l - 1 || k.r > pill.painted.r + 1 || k.t < pill.painted.t - 1 || k.b > pill.painted.b + 1).map(k => k.n)
      check(out.length === 0, `${label}: ${locked ? 'with the lock, ' : ''}everything on the pill (${pill.kids.map(k => k.n.replace('mp-status-', '')).join(', ')}) is inside the capsule that is painted`, `${JSON.stringify(out)} painted ${JSON.stringify(pill.painted)} ${pill.lines} line(s), clip ${pill.clip}`)
      check(pill.painted.l >= pill.rail.l - 0.5 && pill.painted.r <= pill.rail.r + 0.5, `${label}: and the capsule is inside the rail`)
    }
  }
  await c.evBody(`__g.hostPassword = ''; __g.stopHosting && __g.stopHosting()`).catch(() => undefined)
} else if (mode === 'guest') {
  const G = await connectGuest(arg || '9445')
  console.log('guest page:', await G.ev(`(() => { const g = ng.getComponent(document.querySelector('app-join-game')); return g.gameState + ' ' + (g.isSpectating ? 'spectating' : 'not spectating') })()`))
  const sizes = MATRIX.filter(m => [[844, 390, 47], [844, 390, 0], [915, 412, 0], [932, 430, 59], [667, 375, 0], [393, 852, 0], [430, 932, 0], [1366, 768, 0], [1024, 768, 0]].some(([w, h, l]) => w === m[0] && h === m[1] && l === m[2]))
  for (const [w, h, l, r, b] of sizes) {
    await emulate(w, h, l, r, b)
    await c.evBody(`__g.applyDeckSetting('auto'); __g.applyStageView('fit')`); await settle()
    await G.emulate(w, h, l, r, b); await sleep(1200)
    const label = `${w}x${h}${l || r ? ` (${l}/${r}/${b})` : ''}`
    const host = await rect('.emulator-canvas')
    const video = await G.rect('#stream-target')
    const guestStage = await G.rect('#game-stream-container')
    const overlay = await G.rect('#cursors-overlay')
    check(!!video && Math.abs(video[2] - host[2]) <= 1 && Math.abs(video[3] - host[3]) <= 1, `${label}: the spectator's picture is the host's size`, `host ${host[2]}x${host[3]} at ${host[0]},${host[1]} / guest ${video && video[2]}x${video && video[3]} at ${video && video[0]},${video && video[1]}`)
    check(!!video && Math.abs(video[0] - host[0]) <= 1.5, `${label}: and in the same place`, `x ${host[0]} vs ${video && video[0]}`)
    check(same(video, guestStage, 1), `${label}: #stream-target's border box is the stage (no letterbox inside it)`, `${JSON.stringify(video)} vs ${JSON.stringify(guestStage)}`)
    check(same(overlay, video, 1), `${label}: the cursor overlay is exactly on the picture`, `${JSON.stringify(overlay)} vs ${JSON.stringify(video)}`)
    const headerShown = await G.ev(`!!document.querySelector('ion-header')`)
    check(headerShown === !(w > h && h <= 500), `${label}: the spectator's toolbar is ${w > h && h <= 500 ? 'dropped' : 'kept'}`, `header=${headerShown}`)
  }
} else if (mode === 'room') {
  const G = await connectGuest(arg || '9445')
  const sizes = MATRIX.filter(m => [[844, 390, 47], [667, 375, 0], [932, 430, 59], [915, 412, 0], [393, 852, 0], [1366, 768, 0], [1024, 768, 0]].some(([w, h, l]) => w === m[0] && h === m[1] && l === m[2]))
  for (const [w, h, l, r, b] of sizes) {
    const label = `${w}x${h}${l ? ` (${l}/${r}/${b})` : ''}`
    await emulate(w, h, l, r, b); await G.emulate(w, h, l, r, b); await sleep(1500)

    // ---- a remote cursor: the guest points at 30% x 60% of its picture, the host's overlay cursor is at the same fraction of the canvas ----
    const video = await G.rect('#stream-target'); const canvas = await rect('.emulator-canvas')
    await G.mouse('mouseMoved', video[0] + video[2] * 0.1, video[1] + video[3] * 0.1); await sleep(150)
    await G.mouse('mouseMoved', video[0] + video[2] * 0.3, video[1] + video[3] * 0.6); await sleep(700)
    const cursor = await c.ev(`(() => { const e = [...document.querySelectorAll('#cursors-overlay .cursor')].find(x => !x.classList.contains('self')); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left, b.top, parseFloat(e.dataset.nx), parseFloat(e.dataset.ny)] })()`)
    check(!!cursor, `${label}: the guest's cursor reaches the host`)
    if (cursor) {
      const wantX = canvas[0] + canvas[2] * 0.3, wantY = canvas[1] + canvas[3] * 0.6
      check(Math.abs(cursor[0] - wantX) <= 2 && Math.abs(cursor[1] - wantY) <= 2, `${label}: and lands where the guest pointed (normalised ${cursor[2].toFixed(3)},${cursor[3].toFixed(3)})`, `host cursor ${cursor[0].toFixed(1)},${cursor[1].toFixed(1)} vs wanted ${wantX.toFixed(1)},${wantY.toFixed(1)}`)
    }

    // ---- the guest's chat from its own control (a key in the rail on a landscape phone, the floating tab elsewhere) ----
    const compact = w > h && h <= 500
    const chatSel = compact ? '[data-chat-toggle]' : '.chat-toggle-btn'
    const toggle = await G.rect(chatSel)
    check(!!toggle, `${label}: the guest has a chat control (${compact ? 'a key in the rail' : 'the floating tab'})`)
    const before = await G.rect('#stream-target')
    const t = centre(toggle); await G.tap(t.x, t.y); await sleep(900)
    check(await G.ev(`ng.getComponent(document.querySelector('app-join-game')).isChatOpen`), `${label}: tapping it opens the chat`)
    const during = await G.rect('#stream-target')
    console.log(`      ${label}: guest picture ${before[2]}x${before[3]} -> ${during[2]}x${during[3]} with the chat docked`)
    check((await rect('.emulator-canvas'))[2] === canvas[2], `${label}: the host's picture does not follow the guest's chat`)
    await G.ev(`(() => { const i = document.querySelector('#chat-panel .chat-input'); i.value = 'oi do espectador ${w}'; i.dispatchEvent(new Event('input', { bubbles: true })) })()`); await sleep(200)
    await G.ev(`(() => { document.querySelector('#chat-panel form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })()`); await sleep(900)
    const unread = await c.ev(`(() => { const k = document.querySelector('[data-chat-toggle]'); return k ? k.getAttribute('aria-label') : null })()`)
    check(/mensage/.test(unread || ''), `${label}: the message reaches the host (its chat control says "${unread}")`)
    await c.evBody(`__g.toggleChat(true)`); await sleep(900)
    const lines = await c.ev(`[...document.querySelectorAll('#chat-panel .chat-text')].map(e => e.textContent.trim())`)
    check(lines.some(x => x.includes(`oi do espectador ${w}`)), `${label}: and is in the host's transcript`, JSON.stringify(lines))
    const hostOpen = await rect('.emulator-canvas')
    console.log(`      ${label}: host picture ${canvas[2]}x${canvas[3]} -> ${hostOpen[2]}x${hostOpen[3]} with its chat docked`)
    await c.evBody(`__g.toggleChat(false)`)
    const t2 = centre(await G.rect(chatSel)); await G.tap(t2.x, t2.y); await sleep(900)
    check(same(await G.rect('#stream-target'), before, 0.5), `${label}: closing the chat gives the guest its picture back exactly`)
    check(same(await rect('.emulator-canvas'), canvas, 0.5), `${label}: and the host its own`)
  }
} else if (mode === 'leave') {
  const G = await connectGuest(arg || '9445')
  await G.emulate(844, 390, 47, 47, 21); await sleep(1200)
  const box = selector => G.ev(`(() => { const e = [...document.querySelectorAll('.stage-rail button')].find(b => b.getAttribute('aria-label') === ${JSON.stringify(selector)}); const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height] })()`)
  const sala = centre(await box('Informações da sala'))
  await G.tap(sala.x, sala.y); await sleep(1500)
  check(await G.ev(`!!document.querySelector('app-multiplayer-panel')`), 'Sala opens the room window from the rail')
  await G.ev(`(() => { const x = document.querySelector('app-multiplayer-panel .win9x-titlebar-close'); x && x.click(); return !!x })()`); await sleep(1200)
  const sair = centre(await box('Sair da sala'))
  await G.tap(sair.x, sair.y); await sleep(1500)
  const asked = await G.ev(`(() => { const a = document.querySelector('ion-alert'); return a ? a.textContent.replace(/\\s+/g, ' ').trim().slice(0, 140) : null })()`)
  check(!!asked, 'Sair asks first', asked)
  const confirm = centre(await G.ev(`(() => { const e = [...document.querySelectorAll('ion-alert button')].find(b => !/Ficar|Cancelar/.test(b.textContent)); const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height] })()`))
  await G.tap(confirm.x, confirm.y); await sleep(4000)
  const where = await G.ev(`location.hash + ' | ' + ng.getComponent(document.querySelector('app-join-game')).gameState`)
  check(/#\/join-game/.test(where) && /\| 0$/.test(where), 'a confirmed leave reloads the spectator page to its start', where)
  await sleep(1500)
  const players = await c.ev(`(async () => { const s = ng.getComponent(document.querySelector('app-game')).playerInfoService; return await new Promise(r => { const sub = s.playerList$.subscribe(l => { r(l.length); setTimeout(() => sub.unsubscribe()) }) }) })()`)
  check(players === 1, 'and the host\'s roster is only the host again', `${players} in the room`)
}
