#!/usr/bin/env node
// The guest's relative-motion rules, measured at the current video mode with the RAM oracle: the gain per axis, the clip, the
// wrap, the homing, what a big negative send does, and whether back-to-back sends are summed. Re-run it after any change to the
// video mode, the Windows mouse settings, js-dos or the disk image: every constant in TOUCH_INPUT rests on these tables.
//
//   node scripts/touch-harness/boot.mjs gain android && node scripts/touch-harness/gain.mjs
//
// Drives dosCI directly, so the touch layer is detached for the run and put back at the end.
import { session } from './nav.mjs'

const s = await session()
const { c } = s
await c.ev(`__g.touchInputService.detach('harness: gain table')`)
console.log('calibrate', JSON.stringify(await s.loadOracle()), 'frame', JSON.stringify(await s.frame()))

const run = async (title, body) => {
  const result = await c.ev(`(async () => { const sleep = ms => new Promise(r => setTimeout(r, ms)); ${body} })()`, 300000)
  console.log(`\n${title}\n${JSON.stringify(result)}`)
}

await run('symmetric gain: home, send (d, d), settle 250 ms.  [d, x, y]   expect 1x up to 2 units, 2x from 3, a clip at the frame, a wrap from 256', `
  const out = []
  for (const d of [1, 2, 3, 4, 5, 8, 12, 20, 30, 50, 80, 100, 120, 150, 200, 239, 240, 250, 255, 256, 300]) {
    await ORACLE.home(); dosCI.sendMouseRelativeMotion(d, d); await sleep(250)
    const p = await ORACLE.read(); out.push([d, p.x, p.y])
  }
  return out`)

await run('the axes are independent: home, send (dx, dy).  [dx, dy, x, y, expected x, expected y]', `
  const gain = d => Math.abs(d) <= 2 ? d : 2 * d
  const out = []
  for (const [dx, dy] of [[1, 100], [2, 100], [3, 100], [100, 1], [100, 2], [100, 3], [1, 3], [2, 3], [3, 2], [0, 50], [50, 0], [2, 60], [60, 2], [1, 200], [200, 1], [90, 2], [2, 90]]) {
    await ORACLE.home(); dosCI.sendMouseRelativeMotion(dx, dy); await sleep(250)
    const p = await ORACLE.read(); out.push([dx, dy, p.x, p.y, gain(dx), gain(dy)])
  }
  return out`)

await run('negative sends from about (200, 140).  [dx, dy, moved x, moved y]   a clip at the frame explains a short move', `
  const out = []
  for (const [dx, dy] of [[-1, -1], [-2, -2], [-3, -3], [-50, -50], [-100, -100], [50, -50], [-50, 50], [-90, 2], [2, -90]]) {
    await ORACLE.home(); dosCI.sendMouseRelativeMotion(100, 70); await sleep(250)
    const a = await ORACLE.read(); dosCI.sendMouseRelativeMotion(dx, dy); await sleep(250)
    const p = await ORACLE.read(); out.push([dx, dy, p.x - a.x, p.y - a.y])
  }
  return out`)

await run('wrap: a single positive x event, from the corner.  [n, x]   256 and up wraps modulo 256', `
  const out = []
  for (const n of [100, 127, 128, 200, 239, 255, 256, 257, 300, 350]) {
    await ORACLE.home(); dosCI.sendMouseRelativeMotion(n, 0); await sleep(250)
    out.push([n, (await ORACLE.read()).x])
  }
  return out`)

await run('one big negative send from (300, 220).  [n, x, y after]   only -255..255 is trustworthy; -300 and -400 wrap, -2000 homed once and is unproven', `
  const out = []
  for (const n of [-100, -200, -255, -300, -400, -2000]) {
    await ORACLE.home(); dosCI.sendMouseRelativeMotion(150, 110); await sleep(250)
    dosCI.sendMouseRelativeMotion(n, n); await sleep(250)
    const p = await ORACLE.read(); out.push([n, p.x, p.y])
  }
  return out`)

await run('6 sends of (40, 30) with a gap g.  [g, x, y]   480, 360 whenever nothing wraps: summing only hurts when the sum is 256+ or the units are small (see spacing.mjs)', `
  const out = []
  for (const gap of [0, 0, 4, 8, 16, 24, 40]) {
    await ORACLE.home(); for (let i = 0; i < 6; i++) { dosCI.sendMouseRelativeMotion(40, 30); if (gap) await sleep(gap) } await sleep(300)
    const p = await ORACLE.read(); out.push([gap, p.x, p.y])
  }
  return out`)

await c.ev(`__g.applyTouchMode()`)
