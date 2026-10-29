#!/usr/bin/env node
// Does Elifoot (or Windows) ever move the cursor by itself when a window opens? Compares the guest's real cursor with the
// engine's model after every step of the tour, i.e. once each menu, tab and modal has appeared. A difference would mean the
// dead reckoning is wrong from there on.
//
//   node scripts/touch-harness/warpcheck.mjs        # from the main window of a running game
import { sleep } from './lib.mjs'
import { session } from './nav.mjs'
import { STEPS } from './tour.mjs'

const s = await session()
console.log('oracle', JSON.stringify(await s.loadOracle()))
await s.c.ev(`__g.touchInputService['session'].pointer.invalidate('harness')`)
await s.tapC(0, 0, 1200)        // one tap, to home and park the model
let worst = 0
for (const step of STEPS) {
  await step.go(s)
  await sleep(1800)            // the window is up
  const truth = await s.truth()
  const model = (await s.insp()).position
  const difference = Math.max(Math.abs(truth.x - model.x), Math.abs(truth.y - model.y))
  worst = Math.max(worst, difference)
  console.log(`${step.name.padEnd(26)} cursor ${truth.x},${truth.y}  model ${model.x},${model.y}  difference ${difference}`)
  if (step.after) await step.after(s)
}
console.log('largest difference after any window opened:', worst, 'px')
