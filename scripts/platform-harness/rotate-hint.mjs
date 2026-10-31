// "Gire o aparelho": shown once on a phone held upright, gone by itself when the phone is turned, never again after it was on screen,
// and not shown on a landscape phone or a tablet. Needs the driver and a dev server (see README.md).
//   node scripts/platform-harness/rotate-hint.mjs
import { boot, shot, check, sleep } from './lib.mjs'
const openMenu = async c => {
  const rect = await c.ev(`(() => { const b = [...document.querySelectorAll('ion-header ion-buttons[slot=end] ion-button')].pop(); const r = b.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2} })()`)
  await c.tap(rect.x, rect.y); await sleep(1000)
  await c.ev(`document.querySelector('ion-modal.menu-sheet')?.setCurrentBreakpoint?.(1)`); await sleep(600)   // a sheet opens at 60% on a phone; its lower rows are only reachable once it is expanded
}

// ---- the rotate hint goes away by itself when the phone is turned, and is not shown again ----
let c = await boot({})
await sleep(500)
const toast = () => c.ev(`(() => { const t = document.querySelector('ion-toast'); return t ? t.message : null })()`)
check('portrait phone, first visit: the hint is up', /Gire o aparelho/.test(await toast() ?? ''))
await shot(c, 'rotate-toast')
await c.send('Emulation.setDeviceMetricsOverride', { width: 852, height: 393, deviceScaleFactor: 3, mobile: true })
await sleep(1500)
check('turning the phone dismisses it', (await toast()) === null)
check('and that counts as shown', await c.ev(`(async () => await __g.storageService.get('rotateHintShown'))()`) === true)
c = await boot({ wipe: false, welcome: false })
await sleep(2500)
check('the next portrait visit does not repeat it', !/Gire o aparelho/.test(await toast() ?? ''))

// ---- landscape phone: nothing is said ----
c = await boot({ width: 852, height: 393 })
await sleep(1000)
check('a landscape phone gets no rotate hint', (await toast()) === null)

// ---- tablet in portrait: nothing is said ----
c = await boot({ width: 820, height: 1180, dpr: 2 })
await sleep(1000)
check('a tablet in portrait gets no rotate hint', (await toast()) === null)
