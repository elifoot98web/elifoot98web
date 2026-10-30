#!/usr/bin/env node
// The "Modo de toque" setting through the real UI: offered on a phone, switches the layer live, persists across a reload, is wiped
// with the data. Run it in portrait and in landscape: the dialog has to fit a phone that is 390 px tall.
//
//   node scripts/touch-harness/boot.mjs ui android 390 844 && node scripts/touch-harness/setting-ui.mjs portrait
//   node scripts/touch-harness/boot.mjs ui android 844 390 && node scripts/touch-harness/setting-ui.mjs landscape
import { session } from './nav.mjs'
import { sleep, OUT } from './lib.mjs'
import path from 'node:path'

const tag = process.argv[2] || 'portrait'
const s = await session()
const { c } = s
const check = (ok, what, detail = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? `  ${detail}` : ''}`)
const click = ({ css, text }) => c.ev(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(css)})].find(e => ${text ? `e.textContent.includes(${JSON.stringify(text)})` : 'true'}); if (!el) return false; el.click(); return true })()`)
const centre = selector => c.ev(`JSON.stringify((() => { const b = document.querySelector(${JSON.stringify(selector)}); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })())`).then(JSON.parse)

check(await c.ev('__g.touchInputService.attached'), 'direct touch is attached after boot (the default)')
// A fresh profile on a portrait phone gets the one-time "Gire o aparelho" toast (P14), which covers the toolbar until it goes: a tap
// on the options button right after boot lands on it. Dismissed, like a person would.
await c.ev(`(async () => { for (const toast of document.querySelectorAll('ion-toast')) await toast.dismiss(); return 1 })()`)
await sleep(400)

// A real tap on the options button: the toolbar in portrait; on a landscape phone the toolbar is gone and the round button at the top of
// the left rail (.rail-menu-btn) opens the same menu.
// The slot's own button (a direct child): the save chip (P5) and the sound chip (P14) hold ion-buttons too, and a tap on the first of those saves the game.
const toolbar = await centre('ion-header ion-buttons[slot="end"] > ion-button')
const rail = toolbar ? null : await centre('.rail-menu-btn')
const menuButton = toolbar ?? rail
check(!!menuButton, 'the options button is on screen', toolbar ? 'toolbar' : 'rail')
await c.tap(menuButton.x, menuButton.y, 60)
await sleep(1500)   // the menu has twenty-odd entries now; 900 ms was not always enough for the popover to render them
await c.shot(path.join(OUT, 'shots', `ui-${tag}-menu.png`))
const items = await c.ev(`[...document.querySelectorAll('ion-popover ion-item ion-label')].map(l => l.textContent.trim().replace(/\\s+/g, ' '))`)
check(items.some(t => t.startsWith('Modo de toque')), 'the menu lists "Modo de toque" with its subtitle', JSON.stringify(items.find(t => t.startsWith('Modo de toque'))))

await click({ css: 'ion-popover ion-item', text: 'Modo de toque' }); await sleep(900)
await c.shot(path.join(OUT, 'shots', `ui-${tag}-dialog.png`))
const dialog = await c.ev(`(() => { const a = document.querySelector('ion-alert'); return a ? { radios: [...a.querySelectorAll('.alert-radio-label')].map(x => x.textContent.trim()), checked: [...a.querySelectorAll('button.alert-radio-button[aria-checked=true] .alert-radio-label')].map(x => x.textContent.trim()), cls: a.className } : null })()`)
check(!!dialog && dialog.cls.includes('win9x-alert') && dialog.radios.length === 2 && dialog.checked[0] === 'Direto (padrão)', 'the dialog is a win9x alert with the two modes, Direto checked', JSON.stringify(dialog))
const fit = await c.ev(`(() => { const w = document.querySelector('ion-alert .alert-wrapper').getBoundingClientRect(); const bs = [...document.querySelectorAll('ion-alert .alert-button')].map(b => b.getBoundingClientRect()); return { top: Math.round(w.top), bottom: Math.round(w.bottom), viewport: innerHeight, buttonsInside: bs.every(b => b.bottom <= innerHeight && b.top >= 0) } })()`)
check(fit.buttonsInside, 'the radios and buttons are inside the viewport', JSON.stringify(fit))

await click({ css: 'ion-alert button.alert-radio-button', text: 'Touchpad' }); await sleep(300)
await click({ css: 'ion-alert .alert-button', text: 'Aplicar' }); await sleep(1500)
check((await c.ev('__g.touchInputService.attached')) === false, 'choosing Touchpad (clássico) detaches the layer at once, with no reload')
check((await c.ev(`__g.storageService.get('touchMode')`)) === 'classic', 'the choice is stored under STORAGE_KEY.TOUCH_MODE')

// Stock js-dos is in charge again: a tap clicks at the OLD cursor position, with no motion, and no ring is drawn.
await c.ev(`(() => { window.__m = 0; window.__bl = []; if (!dosCI.__relHook) { dosCI.__relHook = dosCI.sendMouseRelativeMotion; dosCI.sendMouseRelativeMotion = function (x, y) { window.__m++; return dosCI.__relHook.call(dosCI, x, y) } } if (!dosCI.__realBtn2) { dosCI.__realBtn2 = dosCI.sendMouseButton; dosCI.sendMouseButton = function (b, p) { window.__bl.push(p ? 'down' : 'up'); return dosCI.__realBtn2.call(dosCI, b, p) } } return 1 })()`)
const ok = await s.toCssC(215, -90)
await c.tap(ok.x, ok.y, 70); await sleep(900)
const stock = await c.ev('({ motions: window.__m, buttons: window.__bl.splice(0), rings: document.querySelectorAll(".touch-feedback").length })')
check(stock.motions === 0 && stock.buttons.join() === 'down,up' && stock.rings === 0, 'CLASSIC: stock js-dos clicks at the old cursor position (no motion) and no ring is drawn', JSON.stringify(stock))

// It survives a reload: the next boot reads the choice.
await c.send('Page.reload', { ignoreCache: true })
for (let i = 0; i < 90; i++) {
  await sleep(1000)
  if (await c.ev(`(() => { const el = document.querySelector('app-game'); const g = el && window.ng && ng.getComponent(el); return !!(g && g.dosCI && !g.isHidden) })()`).catch(() => false)) break
}
await sleep(1500)
await c.ev(`(() => { const b = [...document.querySelectorAll('ion-alert button')].find(x => /Entendi/.test(x.textContent)); b && b.click(); return 1 })()`)
await sleep(800)
await c.ev(`(() => { window.__g = ng.getComponent(document.querySelector('app-game')); window.dosCI = __g.dosCI; return 1 })()`)
check((await c.ev('__g.touchInputService.attached')) === false && (await c.ev('__g.touchMode')) === 'classic', 'after a reload the game boots in classic and the layer stays off', `menu says: ${await c.ev('__g.touchModeSummary')}`)

await c.ev(`(() => { __g.touchMode = 'direct'; __g.applyTouchMode(); return __g.storageService.set('touchMode', 'direct') })()`)
check(await c.ev('__g.touchInputService.attached'), 'switching back attaches the layer again')
await c.ev(`__g.storageService.set('touchMode', 'classic')`)
await c.ev(`__g.storageService.clearAllData()`)
check((await c.ev(`__g.storageService.get('touchMode')`)) == null, '"Apagar todos os dados" removes the stored choice (back to the default)')
