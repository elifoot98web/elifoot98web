#!/usr/bin/env node
// The battery saver ("Economizar bateria quando parado", EmulatorPowerService) on the real game: what it costs in CPU, and
// above all whether it ever slows the game down. Needs a DEV build (window.ng), served with --live-reload=false, and the driver.
//
//   [IDLE=20000] node scripts/touch-harness/idle-pause.mjs static   CPU of the busiest renderer on a still screen, setting off and on
//   node scripts/touch-harness/idle-pause.mjs hidden            the page hidden and shown while the guest sleeps (js-dos owns the hidden page)
//   node scripts/touch-harness/idle-pause.mjs save              the first kickoff of a NEW game: the game's own save dialog, with the idle time cut to 150 ms
//   node scripts/touch-harness/idle-pause.mjs wake              taps and keys sent to a guest that is ASLEEP: accuracy against the RAM oracle, order, spacing, nothing lost
//   node scripts/touch-harness/idle-pause.mjs inert             auto-save off: the saver never sleeps the guest, asks less and less often, and sleeps again once auto-save is back
//   node scripts/touch-harness/idle-pause.mjs ui [portrait|landscape]   the menu entry, a real tap on it, persisted across a reload, wiped with the data
//   MODE=off|on|alt [FIRST=off|PATTERN=0110] ROUNDS=4 RETUNE='{"idleMs":2000,"inputQuietMs":2000}' LABEL=name node scripts/touch-harness/idle-pause.mjs season
//
// `season` plays rounds the way a person does (Enter on every new screen, the injury and penalty pickers answered, the auction skipped)
// from the main window of a game that is already started (boot.mjs, then play to the main window), and prints per round: wall time,
// frames, the longest gap between frames, every gap over 2 s with the time since the last input at its start ("9699@in+39121" is a 9.7 s
// gap that began 39 s after the last tap), CPU, and what the service did. MODE=alt flips the setting every round, so ON and OFF are
// compared inside one game. The result of a run with the roadmap's 2 s idle time is in CLAUDE.md, *Letting the guest sleep*.
//
// Gating is on the PICTURE, not on frames: a new screen is a change of 2% of the pixels or more and it is "settled" after three looks
// 0.7 s apart with under 0.3% moving (a text caret is 0.005%, the live clock about 1%). After a press nothing is done until a new screen
// has appeared, so a computation (no frames at all) is waited out and never interrupted.
import fs from 'node:fs'
import path from 'node:path'
import { connect, OUT, sleep } from './lib.mjs'
import { session, KEY } from './nav.mjs'
import { swallowButtons } from './measure.mjs'

const BASE = `http://127.0.0.1:${process.env.CDP_PORT || 9444}`
const check = (ok, what, detail = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? `  ${detail}` : ''}`)
const round1 = v => Math.round(v * 10) / 10

/** Browser-level CDP (no page session): `SystemInfo` lives there. */
async function browser(method, params = {}) {
  const message = await (await fetch(`${BASE}/send`, { method: 'POST', body: JSON.stringify({ method, params, sessionId: '' }) })).json()
  if (message.error) throw new Error(`${method} ${JSON.stringify(message.error)}`)
  return message.result
}

async function lab() {
  const c = await connect()
  await c.send('Performance.enable').catch(() => undefined)
  const procs = async () => (await browser('SystemInfo.getProcessInfo')).processInfo
  const metrics = async () => Object.fromEntries((await c.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]))
  const sinceMark = async mark => {
    const p1 = await procs(); const m1 = await metrics(); const dt = (Date.now() - mark.at) / 1000
    const renderer = p1.filter(x => x.type === 'renderer').map(p => (p.cpuTime - (mark.procs.find(x => x.id === p.id)?.cpuTime ?? 0)) / dt * 100).sort((a, b) => b - a)[0]
    return { seconds: round1(dt), rendererPct: round1(renderer ?? 0), mainThreadPct: round1((m1.TaskDuration - mark.metrics.TaskDuration) / dt * 100) }
  }
  /** CPU of the busiest renderer process (the page and the emulator's worker are threads of it) over a window. */
  const mark = async () => ({ procs: await procs(), metrics: await metrics(), at: Date.now() })
  const cpu = async seconds => { const m = await mark(); await sleep(seconds * 1000); return sinceMark(m) }

  /** Install the recorder once per page: every frame, every input, every loud sound chunk, every pause and resume. */
  const record = () => c.ev(`(() => {
    if (window.__rec && window.__rec.v === 3) return 'already'
    const r = window.__rec = { v: 3, frames: [], inputs: [], loudAt: [], pauses: [], resumes: [], peak: 0 }
    dosCI.events().onFrame(() => { r.frames.push(performance.now()) })
    for (const type of ['pointerdown', 'pointerup', 'keydown', 'keyup', 'touchstart', 'wheel']) document.addEventListener(type, () => r.inputs.push(performance.now()), { capture: true, passive: true })
    __g.emulatorControlService.keyActivity$.subscribe(() => r.inputs.push(performance.now()))
    dosCI.events().onSoundPush(samples => {
      let peak = 0
      for (let i = 0; i < samples.length; i += 4) { const v = Math.abs(samples[i]); if (v > peak) peak = v }
      if (peak > r.peak) r.peak = peak
      if (peak > 0.001) r.loudAt.push(performance.now())
    })
    for (const name of ['pause', 'resume']) { const real = dosCI[name].bind(dosCI); dosCI[name] = (...a) => { r[name === 'pause' ? 'pauses' : 'resumes'].push(performance.now()); return real(...a) } }
    r.keyEvents = []
    const realKey = dosCI.sendKeyEvent.bind(dosCI)
    dosCI.sendKeyEvent = (key, pressed) => { r.keyEvents.push([performance.now(), key, pressed]); return realKey(key, pressed) }
    return 'installed'
  })()`)
  const now = () => c.ev('performance.now()')
  const frames = async since => JSON.parse(await c.ev(`JSON.stringify((() => {
    const f = __rec.frames.filter(t => t >= ${since}), gaps = f.slice(1).map((t, i) => t - f[i])
    return { n: f.length, maxGapMs: Math.round(Math.max(0, ...gaps)), over5s: gaps.filter(g => g > 5000).length }
  })())`))
  /** Gaps between frames of at least `minMs`, with the time since the last input at the start, and the loud sound inside them. */
  const gaps = async (since, minMs = 2000) => JSON.parse(await c.ev(`JSON.stringify((() => {
    const r = __rec, f = r.frames.filter(t => t >= ${since}), out = []
    const lastInput = t => { let best = null; for (const i of r.inputs) { if (i <= t) best = i; else break } return best }
    for (let i = 1; i < f.length; i++) {
      const gap = f[i] - f[i - 1]
      if (gap < ${minMs}) continue
      const li = lastInput(f[i - 1]), loud = r.loudAt.filter(t => t > f[i - 1] && t < f[i])
      out.push({ gapMs: Math.round(gap), sinceInput: li == null ? null : Math.round(f[i - 1] - li), loudInside: loud.length, loudSpanMs: loud.length ? Math.round(loud[loud.length - 1] - loud[0]) : 0 })
    }
    return out
  })())`))
  /** Pauses that came within 300 ms of a loud sound chunk: a sound that was playing when the guest was put to sleep. */
  const soundCuts = since => c.ev(`__rec.pauses.filter(p => p >= ${since} && __rec.loudAt.some(t => t <= p && p - t < 300)).length`)
  const power = async () => JSON.parse(await c.ev(`(() => { const p = __g.power; return JSON.stringify({ running: p.running, state: p.state, stats: p.stats, setting: __g.idlePause }) })()`))
  /** The setting through the page's own toggle handler (what the menu's switch calls). */
  const setting = async on => { await c.ev(`__g.toggleIdlePause({ detail: { checked: ${on} } })`); await sleep(300); return power() }
  /** The service is a root singleton: what a run retunes stays retuned for the page, so every mode starts from the shipped numbers and gives them back. */
  const retune = config => c.ev(`(__g.power.retune(${JSON.stringify(config)}), 1)`)
  const restore = async () => retune(await c.ev('__g.power.constructor.defaults()'))
  return { c, cpu, mark, sinceMark, record, now, frames, gaps, soundCuts, power, setting, retune, restore }
}

// ------------------------------------------------------------------------------------------------ static

async function modeStatic() {
  // IDLE=20000 runs it on the shipped idle time; the default is short so that a run takes minutes and not a quarter of an hour.
  const IDLE = +(process.env.IDLE || 1500)
  const L = await lab()
  await L.record()
  await L.restore()
  await L.retune({ idleMs: IDLE, inputQuietMs: IDLE })
  console.log(`A still screen (not Acerca, whose credits scroll). 20 s each, the saver given ${round1((IDLE + 4500) / 1000)} s to fall asleep (idle time ${IDLE} ms): off, probe, off, probe, hard.`)
  for (const [on, policy] of [[false, 'probe'], [true, 'probe'], [false, 'probe'], [true, 'probe'], [true, 'hard']]) {
    await L.retune({ policy })
    await L.setting(false)
    await L.setting(on)
    await sleep(on ? IDLE + 4500 : 1500)
    const t = await L.now()
    const cpu = await L.cpu(20)
    const p = await L.power()
    console.log(JSON.stringify({ on, policy: on ? policy : null, ...cpu, frames: (await L.frames(t)).n, state: p.state }))
  }
  await L.setting(false)
  await L.restore()
}

// ------------------------------------------------------------------------------------------------ hidden

async function modeHidden() {
  const L = await lab()
  await L.record()
  await L.restore()
  await L.retune({ idleMs: 1500, inputQuietMs: 1500 })
  await L.setting(false); await sleep(500)
  await L.setting(true)
  await sleep(9000)
  check((await L.power()).state !== 'awake', 'the guest is asleep or probing on a still screen', JSON.stringify((await L.power()).state))
  const probesBefore = (await L.power()).stats.probes
  // document.hidden is overridden on the real document (js-dos's own lifecycle() reads it too) and visibilitychange dispatched, because
  // CDP delivers no lifecycle events to a headless page.
  await L.c.ev(`(Object.defineProperty(document, 'hidden', { get: () => true, configurable: true }), document.dispatchEvent(new Event('visibilitychange')), 1)`)
  await sleep(1000)
  const hidden = await L.cpu(10)
  const probes = (await L.power()).stats.probes - probesBefore
  check(hidden.rendererPct < 5, 'hidden: js-dos has the emulator paused (CPU under 5%)', `${hidden.rendererPct}%`)
  check(probes === 0, 'hidden: the service ran no probe', `${probes} probes`)
  const resumesBefore = await L.c.ev('__rec.resumes.length')
  await L.c.ev(`__g.emulatorControlService.sendKey(dosCI, 258)`)
  await sleep(500)
  const afterKey = await L.cpu(5)
  check(afterKey.rendererPct < 5 && (await L.c.ev('__rec.resumes.length')) === resumesBefore, 'hidden: a key sent meanwhile does not resume the guest', `${afterKey.rendererPct}%`)
  await L.c.ev(`(delete document.hidden, document.dispatchEvent(new Event('visibilitychange')), 1)`)
  await sleep(500)
  check((await L.power()).state === 'awake', 'shown: awake, with a fresh idle time', (await L.power()).state)
  const shown = await L.cpu(1)
  check(shown.rendererPct > 60, 'shown: the emulator runs again', `${shown.rendererPct}%`)
  await sleep(2500)
  const again = await L.cpu(10)
  check(again.rendererPct < 30, 'shown, still: asleep again after the idle time', `${again.rendererPct}%`)
  await L.setting(false)
  await L.restore()
}

// ------------------------------------------------------------------------------------------------ save

async function modeSave() {
  const IDLE = +(process.env.IDLE || 150)
  const s = await session()
  const L = await lab()
  await L.record()
  await L.c.ev(`__g.diagnostics.enable({ persist: false }).then(() => 1)`)
  await L.restore()
  await L.retune({ idleMs: IDLE, inputQuietMs: IDLE })
  await L.setting(true)
  await s.key(294, 800)      // F5: 4-4-2
  await s.key(65, 800)       // A: automatic line-up
  const t0 = await L.now()
  await s.key(KEY.enter, 50) // Jogar
  await sleep(12000)
  const log = await L.c.ev(`__g.diagnostics.entries.filter(e => ['power', 'save', 'ocr'].includes(e.cat)).map(e => Math.round(e.t - ${t0}) + ' ' + e.cat + ' ' + e.msg + ' ' + (e.data || ''))`)
  console.log(log.filter(l => !l.includes('recognize')).join('\n'))
  const has = text => log.some(l => l.includes(text))
  check(has('save dialog seen'), 'the auto-saver saw the game\'s save dialog')
  check(has('not sleeping') && log.some(l => l.includes('save dialog up')), 'the service looked at the dialog while it was up and did not sleep')
  check(has('save dialog gone') && has('persist ok'), 'the auto-saver persisted after the dialog closed')
  const names = await L.c.ev(`(async () => { const b = await __g.saveGameService.prepareSavesBackup(dosCI); return b ? b.names : [] })()`)
  check(names.length > 0, 'the save is on the disk', JSON.stringify(names))
  await L.setting(false)
  await L.restore()
}

// ------------------------------------------------------------------------------------------------ wake

/**
 * What the invariant "anything that talks to the guest wakes it first" is worth: input sent to a guest that is ASLEEP. The saver is
 * given 1.5 s to put the guest to sleep before every send, and the send is graded as if nothing had happened.
 *   taps: against the guest's own cursor (the RAM oracle), the way accuracy.mjs grades them awake; each must cost exactly one resume
 *   keys: the arrows move the squad's highlight on the main window, so their effect is on the screen; and a string of digits is graded on
 *         the raw events the emulator received (the resume comes first, in order, never more than 14 without a gap, 10 ms between groups)
 */
async function modeWake() {
  const TAPS = +(process.env.TAPS || 12)
  // CONTROL=1 runs the same taps with the saver off and the guest never asleep: the baseline the errors are read against.
  const CONTROL = process.env.CONTROL === '1'
  const s = await session()
  const L = await lab()
  const { c } = L
  await L.record()
  await c.ev(`__g.diagnostics.enable({ persist: false }).then(() => 1)`)
  await L.restore()
  await L.setting(false)   // the oracle talks to the guest directly, so it is calibrated awake and with the saver off
  console.log('oracle', JSON.stringify(await s.loadOracle()), 'frame', JSON.stringify(await s.frame()))
  await L.retune({ idleMs: 1500, inputQuietMs: 1500, maxIdleMs: 0 })
  await L.setting(!CONTROL)
  const asleep = async () => {
    if (CONTROL) { await sleep(2500); return true }
    for (let i = 0; i < 80; i++) { if ((await L.power()).state === 'asleep') return true; await sleep(250) }
    return false
  }
  const resumes = () => c.ev('__rec.resumes.length')
  const stalls0 = (await L.power()).stats.stalls   // the counters live as long as the page does

  // ---- taps
  const f = await s.frame()
  await swallowButtons(c, true)
  await c.ev(`__g.touchInputService['session'].pointer.invalidate('harness')`)
  let seed = 11
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const errors = []
  let notAsleep = 0
  let wrongResumes = 0
  for (let i = 0; i < TAPS; i++) {
    const gx = 4 + Math.floor(rnd() * (f.w - 8)), gy = 4 + Math.floor(rnd() * (f.h - 8))
    if (!await asleep()) notAsleep++
    const before = await resumes()
    const p = await s.toCss(gx, gy)
    await c.touch('touchStart', [{ x: p.x, y: p.y }]); await sleep(70); await c.touch('touchEnd', [])
    for (let k = 0; k < 150; k++) { if ((await c.ev(`__g.touchInputService.inspect().pending`)) === 0) break; await sleep(20) }
    await sleep(180)
    const truth = await s.truth()
    const model = (await s.insp()).position
    const delta = (await resumes()) - before
    if (delta !== 1 && !CONTROL) wrongResumes++
    errors.push(Math.max(Math.abs(truth.x - gx), Math.abs(truth.y - gy)))
    console.log(`tap ${String(i + 1).padStart(2)}  target (${gx}, ${gy})  cursor (${truth.x}, ${truth.y})  error ${errors.at(-1)} px  the engine's own idea of the cursor was off by (${model ? truth.x - model.x : '?'}, ${model ? truth.y - model.y : '?'})  resumes ${delta}`)
    if (errors.at(-1) > 3) {
      // Say what the layer and the saver did, so a miss can be told from a harness artefact.
      const lines = await c.ev(`__g.diagnostics.entries.filter(e => ['touch', 'pointer', 'power'].includes(e.cat)).slice(-14).map(e => Math.round(e.t) + ' ' + e.cat + ' ' + e.msg + ' ' + (e.data || ''))`)
      console.log(lines.map(l => '      ' + l.slice(0, 220)).join('\n'))
    }
  }
  await swallowButtons(c, false)
  check(notAsleep === 0, 'the guest was asleep before every tap', `${notAsleep} of ${TAPS} were not`)
  check(Math.max(...errors) <= 3, 'every tap landed within 3 px of the finger, as it does awake', `worst ${Math.max(...errors)} px, ${errors.filter(e => e > 1).length} over 1 px`)
  check(wrongResumes === 0, 'each tap cost exactly one resume', `${wrongResumes} did not`)
  const histogram = [0, 1, 2, 3].map(n => errors.filter(e => (n === 3 ? e >= 3 : e === n)).length)
  console.log(`error per tap, 0 / 1 / 2 / 3+ px: ${histogram.join(' / ')}  (${CONTROL ? 'control: awake' : 'asleep before each tap'})`)
  if (CONTROL) { await L.setting(false); return await L.restore() }

  // ---- keys
  const hash = () => c.ev(`(async () => { const im = await dosCI.screenshot(); let h = 2166136261; for (let i = 0; i < im.data.length; i += 3) { h ^= im.data[i]; h = Math.imul(h, 16777619) } return (h >>> 0).toString(16) })()`)
  const sequence = [['Down', KEY.down], ['Down', KEY.down], ['Down', KEY.down], ['Up', KEY.up], ['Up', KEY.up], ['Up', KEY.up]]
  const play = async sleeping => {
    await L.setting(false); await sleep(300)
    if (sleeping) { await L.retune({ idleMs: 1500, inputQuietMs: 1500, maxIdleMs: 0 }); await L.setting(true) }
    // Three Ups first: the highlight starts at the top of the list, so both runs start from the same screen.
    for (let i = 0; i < 3; i++) await s.key(KEY.up, 500)
    const seen = [await hash()]
    for (const [, code] of sequence) {
      if (sleeping && !await asleep()) notAsleep++
      await s.key(code, 700)
      seen.push(await hash())
    }
    return seen
  }
  const awake = await play(false)
  const slept = await play(true)
  console.log('arrows, awake :', awake.join(' '))
  console.log('arrows, asleep:', slept.join(' '))
  check(new Set(awake).size >= 4, 'the arrows change the screen (the control is meaningful)', `${new Set(awake).size} distinct screens`)
  check(JSON.stringify(awake) === JSON.stringify(slept), 'six arrows sent to a sleeping guest each had the effect they have awake')

  await L.setting(false); await sleep(300)
  await L.retune({ idleMs: 1500, inputQuietMs: 1500, maxIdleMs: 0 }); await L.setting(true)
  if (!await asleep()) notAsleep++
  const t = await L.now()
  const resumesBefore = await resumes()
  await s.type('1234567890', 1500)
  const raw = JSON.parse(await c.ev(`JSON.stringify({ keys: __rec.keyEvents.filter(e => e[0] >= ${t}), resumes: __rec.resumes.filter(r => r >= ${t}) })`))
  const downs = raw.keys.filter(e => e[2]).length, ups = raw.keys.filter(e => !e[2]).length
  const groups = []
  for (const e of raw.keys) { const last = groups.at(-1); if (last && e[0] - last.at < 1) last.n++; else groups.push({ at: e[0], n: 1 }) }
  const gaps = groups.slice(1).map((g, i) => g.at - groups[i].at)
  check(downs === 10 && ups === 10, 'ten digits sent to a sleeping guest: ten presses and ten releases', `${downs} down, ${ups} up`)
  check(raw.resumes.length === 1 && raw.keys.length > 0 && raw.resumes[0] <= raw.keys[0][0], 'one resume, and before the first key event', `resume at +${raw.resumes[0] === undefined ? '-' : Math.round(raw.resumes[0] - t)} ms, first key at +${Math.round(raw.keys[0]?.[0] - t)} ms`)
  check(Math.max(...groups.map(g => g.n)) <= 14 && Math.min(...gaps) >= 9, 'never more than 14 events without a gap, and 10 ms between groups', `largest group ${Math.max(...groups.map(g => g.n))}, smallest gap ${Math.round(Math.min(...gaps))} ms`)
  check((await resumes()) - resumesBefore === 1, 'the whole string cost one resume', `${(await resumes()) - resumesBefore}`)
  const p = await L.power()
  check(p.stats.stalls === stalls0, 'nothing was learned as a stall: no frame came from a guest that was asleep', `${p.stats.stalls - stalls0}`)
  await L.setting(false)
  await L.restore()
}

// ------------------------------------------------------------------------------------------------ inert

/**
 * The saver sleeps the guest only on a definite "the save dialog is not up", and with auto-save off there is nobody to look: the look is
 * `null`. So the feature is inert, and the question is whether it stays out of the way without noise: no pause, the CPU where it was, and a
 * look that backs off (1, 2, 4, 8 s, then every 15 s) instead of asking, and logging, once a second.
 */
async function modeInert() {
  const L = await lab()
  const { c } = L
  await L.record()
  await c.ev(`__g.diagnostics.enable({ persist: false }).then(() => 1)`)
  await L.restore()
  await L.setting(false)
  await L.retune({ idleMs: 1500, inputQuietMs: 1500 })
  await c.ev(`__g.toggleDisableAutoSave({ detail: { checked: true } })`)
  await sleep(500)
  const t0 = await L.now()
  const sleeps0 = (await L.power()).stats.sleeps   // the counters live as long as the page does
  await L.setting(true)
  await sleep(48000)
  const p = await L.power()
  const looks = JSON.parse(await c.ev(`JSON.stringify(__g.diagnostics.entries.filter(e => e.cat === 'power' && e.msg === 'not sleeping' && e.t >= ${t0}).map(e => Math.round((e.t - ${t0}) / 100) / 10))`))
  console.log('looks that could not tell, seconds after the saver was switched on:', looks.join(' '))
  check(p.state === 'awake' && p.stats.sleeps === sleeps0, 'auto-save off: the guest was never put to sleep in 48 s', `${p.state}, ${p.stats.sleeps - sleeps0} sleeps`)
  check(looks.length >= 4 && looks.length <= 8, 'it asked a handful of times, not once a second', `${looks.length} looks`)
  const gaps = looks.slice(1).map((t, i) => round1(t - looks[i]))
  check(gaps.every((g, i) => i === 0 || g >= gaps[i - 1] - 0.4), 'each wait is at least the one before (1, 2, 4, 8 s, then the cap)', gaps.join(' '))
  const cpu = await L.cpu(10)
  check(cpu.rendererPct > 60, 'and the emulator was running as it does without the saver', `${cpu.rendererPct}%`)
  await c.ev(`__g.toggleDisableAutoSave({ detail: { checked: false } })`)
  const back = Date.now()
  let asleepAfter = null
  for (let i = 0; i < 120 && asleepAfter === null; i++) { if ((await L.power()).state === 'asleep') asleepAfter = (Date.now() - back) / 1000; else await sleep(500) }
  check(asleepAfter !== null && asleepAfter < 25, 'with auto-save back on it sleeps at the next look, at most one cap away', asleepAfter === null ? 'never' : `${round1(asleepAfter)} s`)
  await L.setting(false)
  await L.restore()
}

// ------------------------------------------------------------------------------------------------ ui

async function modeUi() {
  const tag = process.argv[3] || 'portrait'
  const { c } = await lab()
  const click = ({ css, text }) => c.ev(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(css)})].find(e => ${text ? `e.textContent.includes(${JSON.stringify(text)})` : 'true'}); if (!el) return false; el.click(); return true })()`)
  const centre = selector => c.ev(`JSON.stringify((() => { const b = document.querySelector(${JSON.stringify(selector)}); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })())`).then(JSON.parse)
  const toolbar = await centre('ion-header ion-buttons[slot="end"] ion-button')
  const menuButton = toolbar ?? await centre('.gutter-menu-btn')
  check(!!menuButton, 'the options button is on screen', toolbar ? 'toolbar' : 'gutter')
  await c.tap(menuButton.x, menuButton.y, 60)
  await sleep(900)
  const entry = await c.ev(`(() => { const label = [...document.querySelectorAll('ion-popover ion-item ion-label')].find(l => l.textContent.includes('Economizar bateria quando parado')); if (!label) return null; label.scrollIntoView({ block: 'center' }); const t = label.parentElement.querySelector('ion-toggle'); const r = t.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2, checked: t.checked, text: label.textContent.trim().replace(/\\s+/g, ' ') }) })()`)
  check(!!entry, 'the menu lists "Economizar bateria quando parado"', entry ? JSON.parse(entry).text.slice(0, 60) : '')
  if (!entry) return
  const before = JSON.parse(entry)
  await c.shot(path.join(OUT, 'shots', `idle-ui-${tag}-menu.png`))
  const fits = await c.ev(`(() => { const l = [...document.querySelectorAll('ion-popover ion-item')].find(e => e.textContent.includes('Economizar bateria quando parado')); const r = l.getBoundingClientRect(); const p = document.querySelector('ion-popover').shadowRoot.querySelector('.popover-content').getBoundingClientRect(); return JSON.stringify({ itemWidth: Math.round(r.width), popoverWidth: Math.round(p.width), itemHeight: Math.round(r.height), overflowsX: l.scrollWidth > l.clientWidth + 1 }) })()`).then(JSON.parse)
  check(!fits.overflowsX, 'the explanation wraps inside the item', JSON.stringify(fits))
  await c.tap(before.x, before.y, 60)
  await sleep(1200)
  const after = await c.ev(`JSON.stringify({ setting: __g.idlePause, running: __g.power.running, stored: await __g.storageService.get('idlePause') })`).then(JSON.parse)
  check(after.setting === !before.checked && after.running === after.setting && after.stored === after.setting, 'a real tap flips the setting, starts or stops the service and stores the choice', JSON.stringify(after))
  console.log('reload the page (boot.mjs with KEEP=1) to see it persist; "Apagar todos os dados" removes it (storage-keys.spec.ts proves the wipe)')
}

// ------------------------------------------------------------------------------------------------ season

async function modeSeason() {
  const MODE = process.env.MODE || 'off'
  const ROUNDS = +(process.env.ROUNDS || 4)
  const HUMAN = +(process.env.HUMAN_MS || 600)
  const NUDGE_S = +(process.env.NUDGE_S || 60)
  const MAX_MIN = +(process.env.MAX_MIN || 60)
  const LABEL = process.env.LABEL || MODE
  const s = await session()
  const L = await lab()
  await L.c.ev('(window.__rec = undefined, 1)')
  await L.record()
  await L.c.ev(`__g.diagnostics.enable({ persist: false }).then(() => 1)`)
  await L.restore()
  if (process.env.RETUNE) await L.retune(JSON.parse(process.env.RETUNE))

  await L.c.ev(`(() => {
    window.__sig = null
    window.__look = async () => {
      const im = await dosCI.screenshot()
      const px = (x, y) => { const i = (y * im.width + x) * 4; return [im.data[i], im.data[i+1], im.data[i+2]] }
      const blue = c => c[0] < 40 && c[1] < 40 && c[2] > 100, white = c => c[0] > 230 && c[1] > 230 && c[2] > 230
      const grey = c => Math.abs(c[0] - 192) < 12 && Math.abs(c[1] - 192) < 12 && Math.abs(c[2] - 192) < 12, yellow = c => c[0] > 230 && c[1] > 230 && c[2] < 40
      let cls = 'other'
      if (blue(px(10, 8)) && white(px(600, 31))) cls = 'main'
      else if (blue(px(320, 71)) && yellow(px(100, 300))) cls = 'auction'
      else if (blue(px(260, 145)) && blue(px(500, 145)) && grey(px(466, 284))) cls = 'injury'
      else if (blue(px(300, 81)) && blue(px(500, 81)) && grey(px(395, 345))) cls = 'penalty'
      const sample = new Uint8Array((im.width / 4) * (im.height / 4))
      let k = 0
      for (let y = 0; y < im.height; y += 4) for (let x = 0; x < im.width; x += 4) { const i = (y * im.width + x) * 4; sample[k++] = (im.data[i] + im.data[i+1] + im.data[i+2]) / 3 }
      let diff = 0
      if (window.__sig) for (let j = 0; j < sample.length; j++) if (Math.abs(sample[j] - window.__sig[j]) > 24) diff++
      const fraction = window.__sig ? diff / sample.length : 1
      window.__sig = sample
      return { cls, diff: fraction }
    }
    return 1
  })()`)
  const look = () => L.c.ev('__look()')
  // FIRST=off starts the alternation with the setting off, so the order of rounds (a game's later rounds differ from its first) is not always the same side's.
  // PATTERN=0110100110010110 gives the order outright (1 = on), for a design in which neither side is always the later round.
  const PATTERN = process.env.PATTERN
  const settingFor = n => MODE === 'on' ? true : MODE === 'off' ? false : PATTERN ? PATTERN[n % PATTERN.length] === '1' : (n % 2 === 0) === (process.env.FIRST !== 'off')

  const t0 = await L.now()
  const began = Date.now()
  const rounds = []
  let round = 0, cur = null, presses = 0, nudges = 0, stable = 0, sawOther = false, bigChange = true, lastPressAt = Date.now()
  const log = (...a) => console.log(((Date.now() - began) / 1000).toFixed(0).padStart(4) + 's', ...a)

  const startRound = async () => {
    const on = settingFor(round)
    const p = await L.setting(on)
    cur = { n: round, on, startedAt: Date.now(), t: await L.now(), mark: await L.mark(), stats0: p.stats, presses0: presses }
  }
  const endRound = async () => {
    const p = await L.power()
    const f = await L.frames(cur.t)
    const g = await L.gaps(cur.t)
    const d = k => round1(p.stats[k] - cur.stats0[k])
    const r = {
      round: cur.n, on: cur.on, wallS: round1((Date.now() - cur.startedAt) / 1000), presses: presses - cur.presses0, frames: f.n, maxGapMs: f.maxGapMs,
      gapsOver2s: g.map(x => `${x.gapMs}@in+${x.sinceInput}`), cpu: await L.sinceMark(cur.mark), sleeps: d('sleeps'), probes: d('probes'), wakes: d('wakes'), asleepS: round1(d('asleepMs') / 1000),
      soundCuts: await L.soundCuts(cur.t),
    }
    rounds.push(r)
    log('ROUND ' + JSON.stringify(r))
  }
  const press = async kind => {
    await sleep(HUMAN)
    if (kind === 'injury') { log('injury: a field player'); await s.tapG(180, 282, 500); await s.tapG(466, 284, 300); presses += 2 }   // the first row is a goalkeeper, which the game will not take
    else if (kind === 'penalty') { log('penalty: the last player, Chutar'); await s.tapG(180, 378, 500); await s.tapG(415, 365, 300); presses += 2 }
    else if (kind === 'auction') { log('auction: OK'); await s.tapG(475, 372, 300); presses++ }
    else { if (kind === 'main') { await s.key(65, 400); presses++ } await s.key(KEY.enter, 50); presses++ }
    bigChange = false; stable = 0; lastPressAt = Date.now()
  }

  while (rounds.length < ROUNDS && (Date.now() - began) / 60000 < MAX_MIN) {
    await sleep(700)
    const { cls, diff } = await look()
    if (diff >= 0.02) { bigChange = true; stable = 0 }
    else if (diff < 0.003) stable++
    else stable = 0
    if (bigChange && stable >= 3) {
      if (cls === 'main' && cur && !sawOther) { bigChange = false; continue }   // still the main window after Jogar: the round is starting
      if (cls === 'main') {
        if (cur) { await endRound(); if (rounds.length >= ROUNDS) break }
        await startRound(); round++; sawOther = false
      } else sawOther = true
      await press(cls)
    } else if (!bigChange && Date.now() - lastPressAt >= NUDGE_S * 1000) {
      nudges++
      log(`nudge #${nudges}: no new screen for ${NUDGE_S} s (${cls})`)
      await s.shot(`idle-nudge-${LABEL}-${nudges}`)
      await s.tapG(475, 372, 300); await s.key(KEY.enter, 50); presses += 2
      lastPressAt = Date.now()
    }
  }
  const all = await L.gaps(t0, 1000)
  const mean = values => values.length ? round1(values.reduce((a, b) => a + b, 0) / values.length) : null
  const summary = {
    label: LABEL, mode: MODE, retune: process.env.RETUNE || null, rounds: rounds.length, nudges,
    maxGapMs: Math.max(0, ...all.map(g => g.gapMs)), gapsOver5s: all.filter(g => g.gapMs > 5000).length,
    onWallS: rounds.filter(r => r.on).map(r => r.wallS), offWallS: rounds.filter(r => !r.on).map(r => r.wallS),
    onMeanWallS: mean(rounds.filter(r => r.on).map(r => r.wallS)), offMeanWallS: mean(rounds.filter(r => !r.on).map(r => r.wallS)),
    onCpu: mean(rounds.filter(r => r.on).map(r => r.cpu.rendererPct)), offCpu: mean(rounds.filter(r => !r.on).map(r => r.cpu.rendererPct)),
    sleeps: rounds.reduce((a, r) => a + r.sleeps, 0), soundCuts: rounds.reduce((a, r) => a + r.soundCuts, 0),
    loudSoundInsideGaps: all.filter(g => g.loudInside > 0).map(g => `${g.gapMs} ms gap: ${g.loudInside} loud chunks over ${g.loudSpanMs} ms`),
  }
  log('SUMMARY ' + JSON.stringify(summary))
  fs.writeFileSync(path.join(OUT, 'results', `idle-pause-season-${LABEL}.json`), JSON.stringify({ summary, rounds, gaps: all }, null, 1))
  await L.setting(false)
  await L.restore()
}

const modes = { static: modeStatic, hidden: modeHidden, save: modeSave, wake: modeWake, inert: modeInert, ui: modeUi, season: modeSeason }
const run = modes[process.argv[2]]
if (!run) { console.error(`usage: idle-pause.mjs ${Object.keys(modes).join('|')}`); process.exit(1) }
await run()
