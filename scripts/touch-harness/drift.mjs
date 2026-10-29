#!/usr/bin/env node
// Does the engine's model drift? Many taps in a row with re-homing switched off, graded after every tap against the guest's RAM.
//
//   node scripts/touch-harness/drift.mjs [--walk far|local] [--spacing 24] [--taps 160] [--seed 21]
//     far:   every tap at a random place on the screen (long moves)
//     local: a random walk of 1..120 px steps from the last position (the short moves a real session is mostly made of)
//
// The model's error comes and goes in steps of 2 px (one mickey at the 2x gain) and does not accumulate. Over 160 far taps and
// 250 local ones it never left 0 on the run this was written with; across the accuracy sweep's 108 short runs it left 0 in 14,
// by 2 px each time, sometimes for one tap and sometimes for the rest of the run's eight.
import { sleep } from './lib.mjs'
import { swallowButtons } from './measure.mjs'
import { session } from './nav.mjs'

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback }
const walk = arg('walk', 'far')
const spacing = Number(arg('spacing', '24'))
const taps = Number(arg('taps', '160'))
const seed0 = Number(arg('seed', '21'))

const s = await session()
const { c } = s
console.log('oracle', JSON.stringify(await s.loadOracle()))
await swallowButtons(c, true)
await c.ev(`__g.touchInputService.retune({ pointer: { spacingMs: ${spacing}, idleRehomeMs: 1e9, forcedRehomeSends: 1e9 } })`)
await c.ev(`__g.touchInputService['session'].pointer.invalidate('harness')`)
let seed = seed0
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
const f = await s.frame()
let cx = f.w / 2, cy = f.h / 2
const rows = []
for (let i = 0; i < taps; i++) {
  if (walk === 'local') {
    const reach = i % 5 === 0 ? 120 : i % 2 ? 8 : 40
    cx = Math.min(f.w - 6, Math.max(5, cx + Math.round((rnd() * 2 - 1) * reach)))
    cy = Math.min(f.h - 6, Math.max(5, cy + Math.round((rnd() * 2 - 1) * reach)))
  } else {
    cx = 4 + Math.floor(rnd() * (f.w - 8))
    cy = 4 + Math.floor(rnd() * (f.h - 8))
  }
  const p = await s.toCss(cx, cy)
  await c.touch('touchStart', [{ x: p.x, y: p.y }]); await sleep(60); await c.touch('touchEnd', [])
  for (let k = 0; k < 150; k++) {
    if ((await c.ev(`__g.touchInputService.inspect().pending`)) === 0) break
    await sleep(20)
  }
  await sleep(150)
  const truth = await s.truth()
  const model = (await s.insp()).position
  rows.push({ ex: truth.x - model.x, ey: truth.y - model.y, tx: truth.x - cx, ty: truth.y - cy })
  await sleep(100)
}
await swallowButtons(c, false)
await c.ev(`__g.touchInputService.retune({ pointer: { idleRehomeMs: 900, forcedRehomeSends: 600 } })`)

const changes = rows.filter((r, i) => i > 0 && (r.ex !== rows[i - 1].ex || r.ey !== rows[i - 1].ey)).length
console.log(`${taps} taps (${walk}): model error x max ${Math.max(...rows.map(r => Math.abs(r.ex)))}, y max ${Math.max(...rows.map(r => Math.abs(r.ey)))}; `
  + `changed ${changes} times; against the finger max ${Math.max(...rows.map(r => Math.max(Math.abs(r.tx), Math.abs(r.ty))))}`)
console.log('model error x:', rows.map(r => r.ex).join(' '))
console.log('model error y:', rows.map(r => r.ey).join(' '))
