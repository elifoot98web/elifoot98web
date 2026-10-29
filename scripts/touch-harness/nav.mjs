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
  return { c, rect, frame, toCss, toCssC, tapG, tapC, key, type, shot, insp, loadOracle, truth }
}
