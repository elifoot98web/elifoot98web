#!/usr/bin/env node
/**
 * An alert with a text field against the OS keyboard (CLAUDE.md, *Typing into the guest*; _win9x.scss, "An alert while the OS keyboard is up").
 * The first device pass found that on a landscape iPhone (Chrome on iOS) the compose dialog ("Input") showed its title bar and kept
 * its text field and buttons under the keyboard: iOS leaves the layout viewport at the full page, Ionic centres the alert in it and
 * sizes it from 100vh, so the dialog was placed for a screen that was not there.
 *
 *   node scripts/touch-harness/alert-keyboard.mjs [shots]
 *
 * It needs the page booted by boot.mjs (a dev build: it reads window.ng). The OS keyboard is simulated the way iOS reports it: the
 * LAYOUT viewport keeps its size and `visualViewport.height` shrinks (typebar.mjs and stage.mjs do the same); nothing writes
 * --kb-inset by hand, so it is AlertKeyboardService starting KeyboardInsetService that is under test. The geometry of the first case is
 * the user's screenshot: a 932 x 352 page of which 117 px were left above the keyboard and its autofill strip.
 *
 * A passing run cannot say the real keyboard behaves: iOS may also scroll the visual viewport (offsetTop) to reveal a field, which
 * this does not emulate. The device pass is where that is seen.
 */
import path from 'node:path'
import { connect, OUT, sleep } from './lib.mjs'

const c = await connect()
const SHOTS = process.argv[2] === 'shots'
const check = (ok, what, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? '  ' + detail : ''}`); if (!ok) process.exitCode = 1 }
await c.evBody(`window.__g = ng.getComponent(document.querySelector('app-game')); window.dosCI = window.__g.dosCI`)

const closeAll = async () => {
  await c.evBody(`for (const t of document.querySelectorAll('ion-toast')) await t.dismiss(); for (const a of document.querySelectorAll('ion-alert')) { try { await a.dismiss(undefined, 'cancel') } catch {} }`)
  await sleep(500)
}
/** iOS: the layout viewport keeps its size, the visual one shrinks; the page is told with a resize on visualViewport. */
const keyboard = px => c.evBody(`
  if (!window.__vvPatched) { window.__vvPatched = true; window.__kb = 0; Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => window.innerHeight - window.__kb }) }
  window.__kb = ${px}; window.visualViewport.dispatchEvent(new Event('resize')); await new Promise(r => setTimeout(r, 120))`)
const emulate = async (w, h, dpr = 3) => { await c.emulate(w, h, dpr, true); await sleep(900) }
const state = () => c.ev(`JSON.stringify({ inset: document.documentElement.style.getPropertyValue('--kb-inset'), open: document.documentElement.classList.contains('kb-open') })`).then(JSON.parse)
const rects = () => c.ev(`(() => {
  const r = v => Math.round(v * 10) / 10
  const q = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { top: r(b.top), bottom: r(b.bottom), left: r(b.left), right: r(b.right), height: r(b.height), width: r(b.width) } }
  return JSON.stringify({ inner: [innerWidth, innerHeight], wrapper: q('ion-alert .alert-wrapper'), head: q('ion-alert .alert-head'), message: q('ion-alert .alert-message'), textarea: q('ion-alert textarea, ion-alert input.alert-input'), button: q('ion-alert .alert-button'), tagged: !!document.querySelector('ion-alert.alert-text-field') })
})()`).then(JSON.parse)
const shot = async name => {
  if (!SHOTS) return
  await c.shot(path.join(OUT, 'shots', `${name}.png`))
}
const openCompose = async () => { await c.evBody(`window.__g.promptInputText()`); await sleep(900); await c.evBody(`document.querySelector('ion-alert textarea')?.focus()`); await sleep(250) }
const visible = (m, kb) => m.inner[1] - kb
const fits = (m, kb) => m.wrapper && m.wrapper.top >= -0.5 && m.wrapper.bottom <= visible(m, kb) + 0.5

await closeAll()

// 1. The reported case: iPhone 15 Pro Max, Chrome on iOS, landscape, keyboard + autofill strip up.
await emulate(932, 352)
await openCompose(); await keyboard(235); await sleep(500)
{
  const [m, s] = [await rects(), await state()]
  check(s.inset === '235px' && s.open, 'the alert started the inset measuring by itself', JSON.stringify(s))
  check(m.tagged, 'the compose dialog was tagged alert-text-field by the service (no call site passes it)')
  check(fits(m, 235), 'iPhone landscape: the whole dialog is above the keyboard', `${m.wrapper.top}..${m.wrapper.bottom} of ${visible(m, 235)}`)
  check(m.textarea.bottom <= 235 / 235 * visible(m, 235) && m.textarea.height >= 44, 'iPhone landscape: the text field is visible, two lines tall', `${m.textarea.height}px`)
  check(m.button.bottom <= visible(m, 235) && m.button.height >= 44, 'iPhone landscape: the buttons are visible and keep 44px', `${m.button.height}px`)
  check(m.message.height === 0, 'iPhone landscape: the instruction paragraph gives way (the placeholder remains)')
  await shot('alert-iphone-landscape-keyboard')
}
// 2. The same dialog without a keyboard is the stacked one it always was, centred.
await keyboard(0); await sleep(500)
{
  const [m, s] = [await rects(), await state()]
  check(s.inset === '0px' && !s.open, 'no keyboard: inset 0 and no kb-open class', JSON.stringify(s))
  check(m.message.height > 20 && m.textarea.height >= 88, 'no keyboard: the stacked dialog (instructions, 88px field)', `message ${m.message.height}, field ${m.textarea.height}`)
  check(Math.abs((m.wrapper.top + m.wrapper.bottom) / 2 - m.inner[1] / 2) < 1, 'no keyboard: still centred in the page')
}
// 3. Closing releases the measuring (twice over: a leak would leave a stale inset for every later alert).
await closeAll(); await sleep(300)
{
  const s = await state()
  check(s.inset === '0px' && !s.open, 'after the dialog closes the keyboard state is released', JSON.stringify(s))
  await openCompose(); await keyboard(235); await sleep(300); await keyboard(0); await closeAll(); await sleep(300)
  const t = await state()
  check(t.inset === '0px' && !t.open, 'a second open and close does not leak a hold', JSON.stringify(t))
}
// 4. Portrait iPhone: plenty of room above the keyboard, so the stacked dialog stays (compact is for short windows only).
await emulate(430, 932)
await openCompose(); await keyboard(340); await sleep(500)
{
  const m = await rects()
  check(fits(m, 340), 'iPhone portrait: the dialog is above the keyboard', `${m.wrapper.top}..${m.wrapper.bottom} of ${visible(m, 340)}`)
  check(m.message.height > 20 && m.textarea.height >= 88, 'iPhone portrait: still the stacked dialog', `message ${m.message.height}, field ${m.textarea.height}`)
  await shot('alert-iphone-portrait-keyboard')
}
await keyboard(0); await closeAll()
// 5. An Android-sized landscape window (the Galaxy A07 class), and a short iPhone SE-class one.
for (const [w, h, kb, label] of [[800, 360, 200, 'Android landscape 800x360'], [667, 320, 200, 'short landscape 667x320'], [568, 320, 190, 'iPhone SE landscape 568x320']]) {
  await emulate(w, h, 2.5)
  await openCompose(); await keyboard(kb); await sleep(500)
  const m = await rects()
  check(fits(m, kb) && m.textarea.bottom <= visible(m, kb) && m.button.bottom <= visible(m, kb), `${label}: dialog, field and buttons are above the keyboard`, `${m.wrapper.top}..${m.wrapper.bottom} of ${visible(m, kb)}`)
  check(m.textarea.height >= 44 && m.button.height >= 44, `${label}: field >= 44 and buttons >= 44`, `${m.textarea.height} / ${m.button.height}`)
  await shot(`alert-${w}x${h}-keyboard`)
  await keyboard(0); await closeAll()
}
// 6. A tablet in landscape is not a short window: keyboard up, the stacked dialog is kept and fits.
await emulate(1180, 820, 2)
await openCompose(); await keyboard(400); await sleep(500)
{
  const m = await rects()
  check(fits(m, 400) && m.message.height > 20, 'tablet landscape: stacked and above the keyboard', `${m.wrapper.top}..${m.wrapper.bottom} of ${visible(m, 400)}`)
}
await keyboard(0); await closeAll()
// 7. Another alert with a text field (the 'O Matic cheat name) is shrunk into the visible area too, whatever its layout.
await emulate(932, 352)
await c.evBody(`const a = await window.__g.alertController.create({ header: 'Salvar Cheat', message: 'Dê um nome para este cheat.', cssClass: 'win9x-alert alert-whitespace', inputs: [{ name: 'n', type: 'text', placeholder: 'Nome do Cheat' }], buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: 'Salvar' }] }); await a.present()`)
await sleep(800); await c.evBody(`document.querySelector('ion-alert input')?.focus()`); await keyboard(235); await sleep(500)
{
  const [m, s] = [await rects(), await state()]
  check(s.inset === '235px', 'a text alert that is not the compose dialog also starts the measuring', JSON.stringify(s))
  check(m.tagged, 'another text alert: tagged alert-text-field')
  check(m.wrapper.top >= -0.5 && m.wrapper.bottom <= visible(m, 235) + 0.5, 'another text alert: inside the visible area', `${m.wrapper.top}..${m.wrapper.bottom} of ${visible(m, 235)}`)
  check(m.textarea && m.textarea.bottom <= visible(m, 235) + 0.5 && m.textarea.height >= 30, 'another text alert: its field is above the keyboard and a usable height', JSON.stringify(m.textarea))
  check(m.button && m.button.bottom <= visible(m, 235) + 0.5 && m.button.height >= 44, 'another text alert: its buttons are above the keyboard and keep 44px (they ran off the bottom edge before)', JSON.stringify(m.button))
  check(m.message.height === 0, 'another text alert: the message gives way, the title and the field remain')
  await shot('alert-other-text-keyboard')
}
await keyboard(0); await closeAll()
// 8. An alert whose only input is a checkbox raises no keyboard and must not start anything.
await c.evBody(`window.__g.confirmWipeLastStep()`); await sleep(900)
{
  const s = await state()
  check(s.inset === '0px' && !s.open, 'a checkbox alert (the wipe\'s last step) does not start the measuring', JSON.stringify(s))
  check(!(await rects()).tagged, 'a checkbox alert is not tagged alert-text-field')
}
await closeAll()
await emulate(932, 352)
console.log(process.exitCode ? 'SOME CHECKS FAILED' : 'ALL CHECKS PASSED')
