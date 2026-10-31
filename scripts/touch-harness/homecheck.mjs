#!/usr/bin/env node
// Does a home always land on the origin? Homes from random start positions and reads where the cursor really ended. The whole
// model rests on (0, 0) being exact.
//
//   node scripts/touch-harness/homecheck.mjs [sends=4] [gapMs=24] [times=60]
import { session } from './nav.mjs'
import { sleep } from './lib.mjs'

const [sendsArg = '4', gapArg = '24', timesArg = '60'] = process.argv.slice(2)
const s = await session()
const { c } = s
await c.ev(`__g.touchInputService.detach('harness: home check')`)
console.log('calibrate', JSON.stringify(await s.loadOracle()))
await c.ev(`(window.__res = null, (async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const hist = {}, odd = {}
  let seed = 5; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < ${Number(timesArg)}; i++) {
    await ORACLE.home()
    dosCI.sendMouseRelativeMotion(Math.floor(rnd() * 300), 0); await sleep(60); dosCI.sendMouseRelativeMotion(0, Math.floor(rnd() * 220)); await sleep(250)
    const before = await ORACLE.read()
    for (let k = 0; k < ${Number(sendsArg)}; k++) { dosCI.sendMouseRelativeMotion(-200, -200); await sleep(${Number(gapArg)}) }
    await sleep(250)
    const after = await ORACLE.read()
    const key = after.x + ',' + after.y; hist[key] = (hist[key] || 0) + 1
    if (after.x || after.y) odd[key + ' from ' + before.x + ',' + before.y] = 1
  }
  window.__res = { hist, odd } })(), 1)`)
let result = null
for (let i = 0; i < 300 && !result; i++) { await sleep(3000); result = await c.ev('window.__res') }
console.log(`${timesArg} homes of ${sendsArg} sends of (-200, -200), ${gapArg} ms apart, from random starts: where the cursor ended`)
console.log(JSON.stringify(result.hist), Object.keys(result.odd).length ? JSON.stringify(result.odd) : '')
await c.ev(`__g.applyTouchMode()`)
