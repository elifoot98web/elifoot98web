// The iOS how-to dialog on a landscape phone (932x430): inside the viewport, buttons reachable.
//   node scripts/platform-harness/howto-landscape.mjs
import { boot, shot, check, sleep } from './lib.mjs'
const INIT = `window.addEventListener('beforeinstallprompt', e => e.stopImmediatePropagation());`
const c = await boot({ ua: 'ios', width: 932, height: 430, init: INIT })
await c.evBody(`__g.promptInstall()`)
await sleep(1500)
await shot(c, 'howto-landscape')
const m = await c.ev(`(() => { const w = document.querySelector('ion-alert .alert-wrapper'); const r = w.getBoundingClientRect(); const btns = [...document.querySelectorAll('ion-alert button.alert-button')].map(b => { const x = b.getBoundingClientRect(); return { t: b.innerText.trim(), top: Math.round(x.top), bottom: Math.round(x.bottom) } }); const msg = document.querySelector('ion-alert .alert-message'); return { wrapper: { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) }, btns, msgScrolls: msg.scrollHeight > msg.clientHeight, vh: innerHeight } })()`)
console.log(JSON.stringify(m))
check('landscape iPhone: the dialog is inside the viewport and its buttons are reachable', m.wrapper.top >= 0 && m.wrapper.bottom <= m.vh && m.btns.every(b => b.top >= m.wrapper.top && b.bottom <= m.wrapper.bottom), JSON.stringify(m.wrapper))
