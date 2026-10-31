// Grading the touch layer against the guest's real cursor (the RAM oracle). Taps go through CDP touch to the app's layer; the
// mouse BUTTON is swallowed in the page, so a grading tap never clicks anything, and counted, so a tap that sent the wrong
// number of button events still shows.
import { sleep } from './lib.mjs'

// A small seeded generator, so every spacing is graded on the same targets.
const rng = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647

export async function swallowButtons(c, on) {
  await c.ev(`(() => {
    window.__btn = window.__btn || []; window.__ups = window.__ups || []
    if (!window.__upHook) { window.__upHook = true; document.addEventListener('pointerup', () => window.__ups.push(performance.now()), true) }
    if (${on}) { if (!dosCI.__realBtn) dosCI.__realBtn = dosCI.sendMouseButton; dosCI.sendMouseButton = (b, p) => { window.__btn.push([performance.now(), b, p]) } }
    else if (dosCI.__realBtn) { dosCI.sendMouseButton = dosCI.__realBtn; delete dosCI.__realBtn }
    return 1 })()`)
}

const summary = values => {
  const sorted = values.slice().sort((a, b) => a - b)
  return sorted.length
    ? { n: sorted.length, max: sorted[sorted.length - 1], p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))], median: sorted[Math.floor(sorted.length / 2)] }
    : { n: 0 }
}

/**
 * One screen, one run per spacing: `taps` taps at seeded random positions, each graded against the guest's cursor.
 * `errTarget` is what a person sees (where the cursor is against where the finger was); `errModel` is the engine's own
 * drift (where the cursor is against where the engine thinks it is).
 */
export async function measure(s, name, { spacings = [24], taps = 8, seed = 7, gapMs = 350, margin = 4 } = {}) {
  const { c } = s
  const f = await s.frame()
  await swallowButtons(c, true)
  const out = []
  for (const spacing of spacings) {
    await c.ev(`__g.touchInputService.retune({ pointer: { spacingMs: ${spacing} } })`)
    // Start clean: the model forgets the cursor, so the first tap homes.
    await c.ev(`__g.touchInputService['session'].pointer.invalidate('harness')`)
    const rnd = rng(seed)
    const rows = []
    for (let i = 0; i < taps; i++) {
      const gx = margin + Math.floor(rnd() * (f.w - 2 * margin))
      const gy = margin + Math.floor(rnd() * (f.h - 2 * margin))
      const p = await s.toCss(gx, gy)
      await c.ev(`(window.__btn.length = 0, window.__ups.length = 0, 1)`)
      await c.touch('touchStart', [{ x: p.x, y: p.y }]); await sleep(70); await c.touch('touchEnd', [])
      // Wait for the engine to drain, then for the guest to apply the last send.
      for (let k = 0; k < 150; k++) {
        if ((await c.ev(`__g.touchInputService.inspect().pending`)) === 0) break
        await sleep(20)
      }
      await sleep(180)
      const [truth, model, buttons, ups] = await Promise.all([c.ev('ORACLE.read()'), s.insp(), c.ev('window.__btn'), c.ev('window.__ups')])
      const position = model.position
      rows.push({
        target: [gx, gy], truth: [truth.x, truth.y], model: position ? [position.x, position.y] : null,
        errTarget: [truth.x - gx, truth.y - gy], errModel: position ? [truth.x - position.x, truth.y - position.y] : null,
        buttons: buttons.length,
        pressAfterUpMs: buttons[0] && ups[0] ? Math.round((buttons[0][0] - ups[0]) * 10) / 10 : null,
        homed: i === 0,
      })
      await sleep(gapMs)
    }
    const errTarget = rows.flatMap(r => r.errTarget.map(Math.abs))
    const errModel = rows.filter(r => r.errModel).flatMap(r => r.errModel.map(Math.abs))
    const latency = rows.filter(r => r.pressAfterUpMs !== null && !r.homed).map(r => r.pressAfterUpMs)
    const result = {
      screen: name, spacing, taps, errTarget: summary(errTarget), errModel: summary(errModel), pressAfterUp: summary(latency),
      buttonsOk: rows.every(r => r.buttons === 2), rows,
    }
    out.push(result)
    console.log(`${name.padEnd(24)} spacing ${String(spacing).padStart(2)}  vs target max ${result.errTarget.max}  vs model max ${result.errModel.max}  `
      + `press after lift ${result.pressAfterUp.n ? `${result.pressAfterUp.median} ms (max ${result.pressAfterUp.max})` : '-'}  buttons ${result.buttonsOk ? 'ok' : 'WRONG'}`)
  }
  await swallowButtons(c, false)
  return out
}
