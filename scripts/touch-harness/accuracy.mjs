#!/usr/bin/env node
// How close does a tap land, and what does the send spacing cost? 18 distinct screens (the six dialogs of starting a new game,
// the main window's five tabs, two menus and five modals), 8 seeded taps each, once per spacing, graded against the guest's
// RAM. Takes about 3 minutes per spacing.
//
//   node scripts/touch-harness/boot.mjs acc android          # a fresh boot, on the splash
//   node scripts/touch-harness/accuracy.mjs [--spacings 18,20,24,32,40] [--taps 8] [--only newgame|tour] [--out file.json]
//
// --only tour starts from the main window of a game that is already running.
import fs from 'node:fs'
import path from 'node:path'
import { OUT, sleep } from './lib.mjs'
import { measure } from './measure.mjs'
import { KEY, session } from './nav.mjs'
import { STEPS } from './tour.mjs'

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback }
const spacings = arg('spacings', '16,18,20,24,32,40').split(',').map(Number)
const taps = Number(arg('taps', '8'))
const only = arg('only', 'all')
const out = arg('out', path.join(OUT, 'results', `accuracy-${Date.now()}.json`))

const s = await session()
console.log('oracle', JSON.stringify(await s.loadOracle()), 'frame', JSON.stringify(await s.frame()))
const all = []
const grade = async name => { all.push(...await measure(s, name, { spacings, taps })); fs.writeFileSync(out, JSON.stringify(all)) }

if (only === 'all' || only === 'newgame') {
  await grade('acerca')
  await s.tapC(215, -90, 2200); await grade('newcont')
  await s.tapC(-205, -117, 700); await s.type('ACCUR', 500); await s.key(KEY.enter, 3800); await grade('countries')
  await s.tapC(-235, -31, 800); await s.tapC(200, -169, 2800); await grade('currency')
  await s.key(KEY.enter, 3500); await sleep(14000); await grade('jogadores')
  await s.type('Leu', 500); await s.tapC(-1, 117, 4500); await grade('sorteio')
  await s.tapC(-1, 117, 5500)
}
if (only === 'all' || only === 'tour') {
  for (const step of STEPS) {
    await step.go(s)
    await sleep(500)
    await grade(step.name)
    if (step.after) await step.after(s)
  }
}

console.log('wrote', out)
for (const spacing of spacings) {
  const rows = all.filter(r => r.spacing === spacing)
  const worstTarget = Math.max(...rows.map(r => r.errTarget.max))
  const worstModel = Math.max(...rows.map(r => r.errModel.max))
  const over = rows.filter(r => r.errTarget.max > 3).map(r => `${r.screen}(${r.errTarget.max})`)
  console.log(`SPACING ${spacing}: ${rows.length} screens, worst error vs target ${worstTarget} px, vs model ${worstModel} px, screens over 3 px: ${over.join(', ') || 'none'}`)
}
