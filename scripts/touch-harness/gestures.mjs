#!/usr/bin/env node
// The gesture vocabulary on the real game, through CDP touches: what must NOT click (a palm, two fingers, a cancelled touch),
// a tap, aim mode, a double tap against two slow taps, dragging a scrollbar thumb, and a tap in the scrollbar's trough. Button
// events are logged AND forwarded, so what is printed is what the guest got. Several results are for the eye: look at the
// screenshots in the harness's output folder (see lib.mjs: shots/g1..g9), the file names say which step.
//
//   node scripts/touch-harness/boot.mjs g android && node scripts/touch-harness/gestures.mjs
//
// Starts on Acerca (the splash right after a boot) and ends on the country list of a new game.
import path from 'node:path'
import { KEY, session } from './nav.mjs'
import { OUT, sleep } from './lib.mjs'

const s = await session()
const { c } = s
await c.ev(`(() => {
  window.__bl = []
  if (!dosCI.__realBtn2) { dosCI.__realBtn2 = dosCI.sendMouseButton; dosCI.sendMouseButton = function (b, p) { window.__bl.push(p ? 'down' : 'up'); return dosCI.__realBtn2.call(dosCI, b, p) } }
  return 1 })()`)
const events = () => c.ev('window.__bl.splice(0).join(",")')
const state = async () => { const i = await s.insp(); return `gesture=${i.gesture} buttonDown=${i.buttonDown} pending=${i.pending}` }
const check = (ok, what, detail = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? `  ${detail}` : ''}`)

const ok = await s.toCssC(215, -90)          // Acerca's OK button

await c.touch('touchStart', [{ x: ok.x, y: ok.y, r: 120 }]); await sleep(150); await c.touch('touchEnd', []); await sleep(600)
check((await events()) === '', 'a palm (contact radius 120) on OK clicks nothing', await state())
await s.shot('g1-palm')

await c.touch('touchStart', [{ x: ok.x, y: ok.y, id: 1 }]); await sleep(60)
await c.touch('touchStart', [{ x: ok.x, y: ok.y, id: 1 }, { x: ok.x - 80, y: ok.y + 120, id: 2 }]); await sleep(120)
await c.touch('touchEnd', []); await sleep(700)
check((await events()) === '', 'two fingers (one on OK) click nothing', await state())
await s.shot('g2-two-fingers')

await c.touch('touchStart', [{ x: ok.x, y: ok.y }]); await sleep(80); await c.touch('touchCancel', []); await sleep(700)
check((await events()) === '', 'a touch the browser cancels mid-hold clicks nothing and leaves nothing held', await state())
await s.shot('g3-cancel')

await c.tap(ok.x, ok.y, 70); await sleep(2500)
check((await events()) === 'down,up', 'a tap on OK clicks once and the dialog changes (look at g4)', await state())
await s.shot('g4-tap-ok')

// aim mode: the finger 56 css px BELOW the "Quero começar" radio, held 700 ms. The cursor must be on the radio, a ring under the
// finger, and the click at release must select the radio.
const radio = await s.toCssC(-205, -117)
await c.touch('touchStart', [{ x: radio.x, y: radio.y + 56 }]); await sleep(750)
const held = await s.insp()
const rings = await c.ev(`document.querySelectorAll('.touch-feedback').length`)
const f = await s.frame()
check(Math.abs(held.position.x - (f.w / 2 - 205)) <= 2 && Math.abs(held.position.y - (f.h / 2 - 117)) <= 2 && rings === 1,
  'aim mode: the cursor sits on the radio above the finger and one ring follows the finger', `cursor ${JSON.stringify(held.position)} rings ${rings}`)
await s.shot('g5-aim-held')
await c.shot(path.join(OUT, 'shots', 'g5-aim-held-page.png'))
await c.touch('touchEnd', []); await sleep(900)
check((await events()) === 'down,up', 'releasing clicks once, where the cursor was (the radio is selected: look at g5-aim-released)', await state())
await s.shot('g5-aim-released')

// the country list: each click on a row toggles it, which is what tells a real double-click from two clicks
await s.type('GESTUR', 500)
await s.key(KEY.enter, 3800)
await events()
const row = async y => s.toCss(120, y)
let p = await row(397)       // Espanha
await c.tap(p.x, p.y, 40); await sleep(110); await c.tap(p.x, p.y, 40); await sleep(1200)
check((await events()) === 'down,up,down,up', 'a double tap on Espanha clicks twice, at one position; Espanha stays selected (20 teams: look at g6)')
await s.shot('g6-double-tap')
p = await row(428)           // França
await c.tap(p.x, p.y, 50); await sleep(900); await c.tap(p.x, p.y, 50); await sleep(1200)
check((await events()) === 'down,up,down,up', 'two taps 900 ms apart on França are two single clicks: toggled on, then off (still 20 teams: look at g7)')
await s.shot('g7-two-slow-taps')

const a = await s.toCss(365, 64), b = await s.toCss(365, 214)      // the scrollbar thumb, 16 guest px wide
await c.touch('touchStart', [{ x: a.x, y: a.y }]); await sleep(60)
for (let i = 1; i <= 12; i++) { await c.touch('touchMove', [{ x: a.x + (b.x - a.x) * i / 12, y: a.y + (b.y - a.y) * i / 12 }]); await sleep(30) }
const dragging = await s.insp()
await sleep(200); await c.touch('touchEnd', []); await sleep(1200)
check(dragging.buttonDown && dragging.gesture === 'drag' && (await events()) === 'down,up', 'dragging the scrollbar thumb holds the button for the whole drag and releases it (the list scrolled: look at g8)')
await s.shot('g8-thumb-drag')

await s.tapG(365, 380, 1200)
check((await events()) === 'down,up', 'a tap in the scrollbar trough below the thumb pages the list (look at g9)')
await s.shot('g9-trough-tap')
