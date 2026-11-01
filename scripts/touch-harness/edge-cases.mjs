#!/usr/bin/env node
// The cases a review of the touch layer turned up, on the real game: each one is a way a gesture used to be lost or to land
// somewhere the finger was not. The specs cover the logic (touch-input.service.spec.ts, guest-pointer.helper.spec.ts); this is
// the same thing through CDP touches and the real guest, so a change to the event order of a browser shows up here.
//
//   node scripts/touch-harness/boot.mjs ec android && node scripts/touch-harness/edge-cases.mjs
//
// Needs a screen with a list under (150, 200)-(150, 270) and a quiet strip at the picture's left edge: the country list of a
// new game, where `gestures.mjs` leaves you. It clicks on that list.
import { session } from './nav.mjs'
import { sleep } from './lib.mjs'

const s = await session()
const { c } = s
await c.ev(`(() => {
  window.__log = []
  if (!dosCI.__realBtn3) {
    dosCI.__realBtn3 = dosCI.sendMouseButton
    dosCI.sendMouseButton = function (b, p) { window.__log.push(p ? 'down' : 'up'); return dosCI.__realBtn3.call(dosCI, b, p) }
    dosCI.__realMove3 = dosCI.sendMouseRelativeMotion
    dosCI.sendMouseRelativeMotion = function (dx, dy) { window.__log.push('m' + dx + ',' + dy); return dosCI.__realMove3.call(dosCI, dx, dy) }
  }
  return 1 })()`)
const buttons = async () => (await c.ev('window.__log.splice(0)')).filter(e => e === 'down' || e === 'up')
const results = []
const check = (ok, what, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? `  ${detail}` : ''}`)
}

// 1. Two thumbs, or a quick double tap: the second finger lands inside the 80 ms in which the layer waits to see whether the
//    first one's pointerup was lost. It used to be taken for the lost one and cancelled, with the click dropped.
await c.ev('window.__log.length = 0')
const row = await s.toCss(120, 428)
await c.tap(row.x, row.y, 40)
await sleep(40)
await c.tap(row.x + 6, row.y + 2, 70)
await sleep(1500)
let i = await s.insp()
const fast = (await buttons()).join(',')
check(fast === 'down,up,down,up' && i.gesture === 'idle', 'a second tap 40 ms after the first lifted is not cancelled: two clicks', `guest saw [${fast}] ${i.gesture}`)

// 2. A retry after a miss. In landscape the picture has a strip on each side that belongs to the overlay but not to the picture:
//    a tap there clicks nothing. A second tap soon after, inside the picture, used to be taken for a double-tap and click again
//    wherever the cursor had been left, instead of under the finger.
await c.emulate(844, 390, 2, true)
await sleep(1200)
const rect = JSON.parse(await c.ev(`JSON.stringify(document.querySelector('.emulator-canvas').getBoundingClientRect().toJSON())`))
const frame = await s.frame()
const y = rect.top + rect.height * 0.5
const miss = { x: rect.left - 12, y }
const retry = { x: rect.left + 8, y: y + 4 }
await s.tapG(520, 100, 700)            // park the cursor far from where the retry will land
await buttons()
await c.tap(miss.x, miss.y, 50)
await sleep(120)
await c.tap(retry.x, retry.y, 50)
await sleep(1500)
i = await s.insp()
const want = { x: Math.floor((retry.x - rect.left) / rect.width * frame.w), y: Math.floor((retry.y - rect.top) / rect.height * frame.h) }
const retried = (await buttons()).join(',')
check(retried === 'down,up' && Math.abs(i.position.x - want.x) <= 3 && Math.abs(i.position.y - want.y) <= 3,
  'a retry after a miss outside the picture clicks once, under the second finger', `guest saw [${retried}] cursor ${JSON.stringify(i.position)} wanted ~${JSON.stringify(want)}`)
await c.emulate(390, 844, 2, true)
await sleep(1200)

// 3. The send budget (a safety net: a home after so many sends) must not fire with the button down. A home is four sends of
//    (-200, -200): with the button held it would drag whatever is under the cursor to the corner.
await c.ev(`__g.touchInputService.retune({ pointer: { forcedRehomeSends: 4 } })`)
await sleep(100)
await c.ev('window.__log.length = 0')
const a = await s.toCss(150, 200)
const b = await s.toCss(150, 270)
await c.touch('touchStart', [{ x: a.x, y: a.y }]); await sleep(60)
for (let n = 1; n <= 12; n++) { await c.touch('touchMove', [{ x: a.x + n * 3, y: a.y + (b.y - a.y) * n / 12 }]); await sleep(40) }
await sleep(200)
await c.touch('touchEnd', []); await sleep(1200)
const log = await c.ev('window.__log.splice(0)')
const held = log.slice(log.indexOf('down'), log.lastIndexOf('up') + 1)
const flung = held.filter(e => e === 'm-200,-200').length
check(log.includes('down') && log.lastIndexOf('up') > log.indexOf('down') && flung === 0,
  'no home while the button is held, however many sends the drag spends', `${held.filter(e => e.startsWith('m')).length} motion sends between down and up, ${flung} of them homes`)
await c.ev(`__g.touchInputService.retune({ pointer: { forcedRehomeSends: 600 } })`)

// 4. The game's audio. js-dos wakes its AudioContext from a document-level click/touchstart that this layer stops, so a lifted
//    finger has to do it. What is asserted is that the tap ASKS (resume() is called on a suspended context); whether the context
//    then runs is the browser's: the headless shell here, which has no audio device, resumed a context once per boot and left
//    every later resume() pending, so the state is printed and not graded.
const state = () => c.ev(`(() => { const n = getDosAudioNode(); return n ? n.context.state : 'no node' })()`)
if ((await state()) === 'no node') {
  console.log('SKIP  the game\'s audio: js-dos has no audio node on this page')
} else {
  await c.evBody(`window.__resumeCalls = 0; const ctx = getDosAudioNode().context
    if (!ctx.__counted) { const real = ctx.resume.bind(ctx); ctx.resume = function () { window.__resumeCalls++; return real() }; ctx.__counted = true }
    ctx.suspend(); return 1`)
  await sleep(300)
  const before = await state()
  await s.tapG(520, 100, 700)
  const calls = await c.ev('window.__resumeCalls')
  check(before === 'suspended' && calls >= 1, 'a tap asks a suspended audio context to resume', `${before} -> ${await state()}, resume() called ${calls} time(s)`)
}

console.log(results.every(Boolean) ? 'ALL PASSED' : 'SOMETHING FAILED')
process.exitCode = results.every(Boolean) ? 0 : 1
