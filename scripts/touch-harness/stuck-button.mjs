#!/usr/bin/env node
// A held button is the worst failure this layer has. Starts a drag, ends it in every way a gesture can end except lifting the
// finger, and checks that the guest saw the button go up. Button events are logged and forwarded, so this reads what the guest got.
//
//   node scripts/touch-harness/boot.mjs sb android && node scripts/touch-harness/stuck-button.mjs
//
// Needs a screen with a list under (150, 200)-(150, 270): the country list of a new game. `gestures.mjs` leaves you on one.
//
// Not covered, and why: a real background/foreground switch. CDP's Page.setWebLifecycleState delivers no lifecycle events to this
// headless page (probed: not even blur), so `visibilitychange` and `freeze` are dispatched by hand and the real thing is on the
// device checklist.
import { session } from './nav.mjs'
import { sleep } from './lib.mjs'

const s = await session()
const { c } = s
await c.ev(`(() => { window.__bl = []; if (!dosCI.__realBtn2) { dosCI.__realBtn2 = dosCI.sendMouseButton; dosCI.sendMouseButton = function (b, p) { window.__bl.push(p ? 'down' : 'up'); return dosCI.__realBtn2.call(dosCI, b, p) } } return 1 })()`)
const events = () => c.ev('window.__bl.splice(0).join(",")')

const startDrag = async () => {
  const a = await s.toCss(150, 200)
  const b = await s.toCss(150, 270)
  await c.touch('touchStart', [{ x: a.x, y: a.y }]); await sleep(60)
  for (let i = 1; i <= 6; i++) { await c.touch('touchMove', [{ x: a.x, y: a.y + (b.y - a.y) * i / 6 }]); await sleep(30) }
  await sleep(150)
  return (await s.insp()).buttonDown
}

const results = []
const check = async (name, how, { stillDown = false } = {}) => {
  await events()
  const held = await startDrag()
  const before = await events()
  await how()
  await sleep(900)
  const after = await events()
  const i = await s.insp()
  // After a detach there is no layer to ask; with a second finger down the touch stays dead ("ignoring") until it lifts.
  const quiet = !i || (!i.buttonDown && (i.gesture === 'idle' || (stillDown && i.gesture === 'ignoring')))
  const ok = held && before === 'down' && after === 'up' && quiet
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(50)} held during the drag: ${held}  guest saw [${before}] then [${after}]  engine: ${i ? `buttonDown=${i.buttonDown} gesture=${i.gesture}` : 'detached'}`)
  await c.touch('touchEnd', []).catch(() => undefined)
  await sleep(500)
  await events()
}

await check('pointercancel (touchCancel)', () => c.touch('touchCancel', []))
await check('a second finger lands on the picture', async () => {
  const a = await s.toCss(150, 270)
  const b = await s.toCss(400, 100)
  await c.touch('touchStart', [{ x: a.x, y: a.y, id: 0 }, { x: b.x, y: b.y, id: 1 }])
}, { stillDown: true })
await check('window blur', () => c.ev(`window.dispatchEvent(new Event('blur'))`))
await check('pagehide', () => c.ev(`window.dispatchEvent(new Event('pagehide'))`))
await check('touchend with no pointerup (a lost pointerup)', () => c.ev(`document.querySelector('.emulator-mouse-overlay').dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [] }))`))
await check('visibilitychange (dispatched by hand)', () => c.ev(`document.dispatchEvent(new Event('visibilitychange'))`))
await check('freeze (dispatched by hand)', () => c.ev(`document.dispatchEvent(new Event('freeze'))`))
await check('layer detached (switch to the classic touchpad)', () => c.ev(`__g.touchInputService.detach('harness')`))
await c.ev(`__g.applyTouchMode()`)
console.log(results.every(Boolean) ? 'ALL RELEASED' : 'SOMETHING STAYED HELD')
process.exitCode = results.every(Boolean) ? 0 : 1
