#!/usr/bin/env node
// How close together can two relative sends be? Repeats identical pairs of sends at several gaps and histograms how far the
// guest's cursor ends up from where the rules say it should: {"dx,dy": count}.
//
//   node scripts/touch-harness/spacing.mjs                       # the two canonical pairs below
//   node scripts/touch-harness/spacing.mjs "[2,0]" "[2,0]" 40 14,16,18,20,22,24,28
//
// Pair 1, (2,0) then (2,0): coalesced, the guest sees one send of 4 units and moves 8 px instead of 4, so a "4,0" error means
// the two sends fell into one frame. It marks the boundary: DOSBox hands the guest one motion callback per frame (~16.7 ms).
// Pair 2, (90,-90) then (2,-77): the shape of a real move. Its rare "2,0" / "0,-2" errors are NOT coalescing: they come at every
// gap, 96 ms included. They are a 2 px quantum in the guest (one mickey at the 2x gain) that comes and goes and does not
// accumulate, and are the reason a tap is graded against 3 px and not 1.
//
// Drives dosCI directly, so the touch layer is detached for the run and put back at the end.
import { session } from './nav.mjs'
import { sleep } from './lib.mjs'

const s = await session()
const { c } = s
await c.ev(`__g.touchInputService.detach('harness: spacing')`)
console.log('calibrate', JSON.stringify(await s.loadOracle()))

const gain = d => Math.abs(d) <= 2 ? d : 2 * d
const pairs = process.argv[2]
  ? [{ a: JSON.parse(process.argv[2]), b: JSON.parse(process.argv[3]), n: Number(process.argv[4] || 30), gaps: (process.argv[5] || '16,20,24,32,48,96').split(',').map(Number) }]
  : [
    { a: [2, 0], b: [2, 0], n: 40, gaps: [14, 16, 18, 20, 22, 24, 28] },
    { a: [90, -90], b: [2, -77], n: 30, gaps: [16, 24, 32, 48, 96] },
  ]

for (const { a, b, n, gaps } of pairs) {
  await c.ev(`(window.__res = null, window.__job = (async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms)); const out = {}
    for (const gap of ${JSON.stringify(gaps)}) {
      const hist = {}
      for (let i = 0; i < ${n}; i++) {
        await ORACLE.home()
        // start from (100, 400) so neither pair clips
        dosCI.sendMouseRelativeMotion(50, 100); await sleep(100); dosCI.sendMouseRelativeMotion(0, 100); await sleep(300)
        const start = await ORACLE.read()
        dosCI.sendMouseRelativeMotion(${a[0]}, ${a[1]}); await sleep(gap); dosCI.sendMouseRelativeMotion(${b[0]}, ${b[1]}); await sleep(300)
        const end = await ORACLE.read()
        const clip = (v, hi) => Math.max(0, Math.min(hi, v))
        const expectX = clip(clip(start.x + ${gain(a[0])}, 639) + ${gain(b[0])}, 639), expectY = clip(clip(start.y + ${gain(a[1])}, 479) + ${gain(b[1])}, 479)
        const key = (end.x - expectX) + ',' + (end.y - expectY); hist[key] = (hist[key] || 0) + 1
      }
      out[gap] = hist
    }
    window.__res = out })(), 1)`)
  let result = null
  for (let i = 0; i < 600 && !result; i++) { await sleep(3000); result = await c.ev('window.__res') }
  console.log(`\npair A=${JSON.stringify(a)} then B=${JSON.stringify(b)}, ${n} each.  gap ms: error histogram {"dx,dy": count}`)
  for (const [gap, histogram] of Object.entries(result)) console.log(String(gap).padStart(4), JSON.stringify(histogram))
}
await c.ev(`__g.applyTouchMode()`)
