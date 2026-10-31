// Driving the game from the harness: real CDP touches through the app's own touch layer, keys through the app's own
// key queue (never raw dosCI key calls), screenshots, and the oracle. Everything is relative to the CENTRE of the
// frame where it can be, so it holds at 640x480 and at 800x600.
//
// It reaches the app through `window.ng` (Angular's dev-mode debug API), so it only works against `npm start`.
import fs from 'node:fs'
import path from 'node:path'
import { connect, OUT, sleep } from './lib.mjs'

export const KEY = { enter: 257, esc: 256, tab: 258, space: 32, left: 263, right: 262, up: 265, down: 264, pageUp: 266, pageDown: 267, home: 268, end: 269 }

export async function session() {
  const c = await connect()
  await c.ev(`(() => { const g = ng.getComponent(document.querySelector('app-game')); window.__g = g; window.dosCI = g.dosCI; return 1 })()`)

  const rect = async () => JSON.parse(await c.ev(`JSON.stringify(document.querySelector('.emulator-canvas').getBoundingClientRect().toJSON())`))
  const frame = async () => JSON.parse(await c.ev(`JSON.stringify({ w: dosCI.width(), h: dosCI.height() })`))
  /** A guest pixel's centre, as page css px: the layer's own mapping, inverted. */
  const toCss = async (gx, gy) => {
    const [r, f] = [await rect(), await frame()]
    return { x: r.left + (gx + 0.5) / f.w * r.width, y: r.top + (gy + 0.5) / f.h * r.height }
  }
  const toCssC = async (ox, oy) => { const f = await frame(); return toCss(f.w / 2 + ox, f.h / 2 + oy) }
  const tapG = async (gx, gy, wait = 900, hold = 70) => { const p = await toCss(gx, gy); await c.tap(p.x, p.y, hold); await sleep(wait); return p }
  const tapC = async (ox, oy, wait = 900, hold = 70) => { const p = await toCssC(ox, oy); await c.tap(p.x, p.y, hold); await sleep(wait); return p }

  const key = async (code, wait = 600) => { await c.ev(`__g.emulatorControlService.sendKey(dosCI, ${code})`); await sleep(wait) }
  const type = async (text, wait = 400) => { await c.ev(`__g.emulatorControlService.sendString(dosCI, ${JSON.stringify(text)})`); await sleep(wait) }
  const shot = name => c.dosShot(path.join(OUT, 'shots', `${name}.png`))
  /** The touch layer's own view: model position, button, gesture. `null` while it is detached. */
  const insp = async () => JSON.parse(await c.ev(`JSON.stringify(__g.touchInputService.inspect())`))
  const loadOracle = async () => {
    await c.ev(fs.readFileSync(new URL('./oracle.js', import.meta.url), 'utf8'))
    return c.ev('ORACLE.calibrate()', 120000)
  }
  const truth = () => c.ev('ORACLE.read()')

  // ---- the options menu (P13): a sheet on a touch screen, a popover under a mouse; the same `app-options-menu` inside either ----
  /** Open the menu with a real tap on its button: the toolbar's, or the round one at the top of a landscape phone's left rail. */
  const openMenu = async () => {
    // A fresh profile on a portrait phone gets the one-time "Gire o aparelho" toast, which covers the toolbar until it goes.
    await c.ev(`(async () => { for (const toast of document.querySelectorAll('ion-toast')) await toast.dismiss(); return 1 })()`)
    await sleep(300)
    const at = await c.ev(`(() => { const b = document.querySelector('ion-header ion-buttons[slot="end"] > ion-button') ?? document.querySelector('.rail-menu-btn'); if (!b) return null; const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }) })()`)
    if (!at) throw new Error('there is no options button on the page')
    const { x, y } = JSON.parse(at)
    await c.tap(x, y, 60)
    await sleep(1300)
  }
  /** A real tap on the row of the open menu whose text matches (scrolled into view first: the sheet opens at 60% of a portrait phone). */
  const tapMenuRow = async text => {
    // A sheet opens at 60% of a portrait phone and the rows below the fold are only reachable once it is expanded, as a thumb would drag it.
    await c.ev(`document.querySelector('ion-modal.menu-sheet')?.setCurrentBreakpoint?.(1)`)
    await sleep(600)
    const at = await c.ev(`(() => { const i = [...document.querySelectorAll('app-options-menu ion-item')].find(i => new RegExp(${JSON.stringify(text)}).test(i.innerText)); if (!i) return null; i.scrollIntoView({ block: 'center' }); const r = i.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }) })()`)
    if (!at) throw new Error(`the menu has no row ${text}`)
    await sleep(300)
    const { x, y } = JSON.parse(await c.ev(`(() => { const i = [...document.querySelectorAll('app-options-menu ion-item')].find(i => new RegExp(${JSON.stringify(text)}).test(i.innerText)); const r = i.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }) })()`))
    await c.tap(x, y, 60)
    await sleep(900)
  }
  /** Open "Dados e avançado" through the menu, with real taps. */
  const openAdvanced = async () => { await openMenu(); await tapMenuRow('Dados e avançado'); await sleep(900) }
  /** Where a switch of the open "Dados e avançado" window is, and whether it is on. */
  const advancedSwitch = async label => {
    const at = await c.ev(`(() => { const row = [...document.querySelectorAll('app-advanced-modal label.win9x-switch')].find(l => l.innerText.includes(${JSON.stringify(label)})); if (!row) return null; row.scrollIntoView({ block: 'center' }); return 'ok' })()`)
    if (!at) throw new Error(`the window has no switch ${label}`)
    await sleep(300)
    return JSON.parse(await c.ev(`(() => { const row = [...document.querySelectorAll('app-advanced-modal label.win9x-switch')].find(l => l.innerText.includes(${JSON.stringify(label)})); const i = row.querySelector('input'); const r = i.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2, checked: i.checked, text: row.innerText.replace(/\\s+/g, ' ') }) })()`))
  }
  /** Close the open window with a real tap on its "Fechar" button. */
  const closeAdvanced = async () => {
    const { x, y } = JSON.parse(await c.ev(`(() => { const b = [...document.querySelectorAll('app-advanced-modal .win9x-close')].pop(); b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }) })()`))
    await sleep(300)
    await c.tap(x, y, 60)
    await sleep(900)
  }
  return { c, rect, frame, toCss, toCssC, tapG, tapC, key, type, shot, insp, loadOracle, truth, openMenu, tapMenuRow, openAdvanced, advancedSwitch, closeAdvanced }
}
