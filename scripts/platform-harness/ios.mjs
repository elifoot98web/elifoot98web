// An iPhone user agent: no Fullscreen API (faked), the audioSession switch, the how-to dialog (a win9x-alert with the storage warning and a
// button to the backup), the banner that says "Como instalar", and an installed app (navigator.standalone) that is offered nothing.
// The real beforeinstallprompt of the headless Chrome is swallowed, because Safari has none.
//   node scripts/platform-harness/ios.mjs
import { boot, shot, check, sleep } from './lib.mjs'

const IOS_INIT = `(() => {
  // Safari has no beforeinstallprompt; the headless Chrome does fire a real one, so it is swallowed here.
  window.addEventListener('beforeinstallprompt', e => e.stopImmediatePropagation());
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => false });
  Object.defineProperty(Document.prototype, 'webkitFullscreenEnabled', { configurable: true, get: () => false });
  Object.defineProperty(navigator, 'audioSession', { configurable: true, value: { type: 'auto' } });
})();`
const toastInfo = c => c.ev(`(() => { const t = document.querySelector('ion-toast'); if (!t) return null; return { message: t.message, layout: t.layout, buttons: [...t.shadowRoot.querySelectorAll('button.toast-button')].map(b => b.textContent.trim()) } })()`)
const clickToast = (c, label) => c.ev(`(() => { const t = document.querySelector('ion-toast'); const b = [...t.shadowRoot.querySelectorAll('button.toast-button')].find(b => b.textContent.trim() === ${JSON.stringify(label)}); b.click(); return !!b })()`)
const stored = (c, key) => c.ev(`(async () => await __g.storageService.get(${JSON.stringify(key)}))()`)
const openMenu = async c => {
  const rect = await c.ev(`(() => { const b = [...document.querySelectorAll('ion-header ion-buttons[slot=end] ion-button')].pop(); const r = b.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2} })()`)
  await c.tap(rect.x, rect.y); await sleep(1000)
}
const tapItem = async (c, re) => {
  const it = await c.ev(`(() => { const i = [...document.querySelectorAll('ion-popover.menu-popover ion-item')].find(i => ${re}.test(i.innerText)); if (!i) return null; i.scrollIntoView({block:'center'}); return true })()`)
  if (!it) return false
  await sleep(300)
  const r = await c.ev(`(() => { const i = [...document.querySelectorAll('ion-popover.menu-popover ion-item')].find(i => ${re}.test(i.innerText)); const b = i.getBoundingClientRect(); return { x: b.x + b.width/2, y: b.y + b.height/2 } })()`)
  await c.tap(r.x, r.y); await sleep(900)
  return true
}
const labels = c => c.ev(`(() => [...document.querySelectorAll('ion-popover.menu-popover ion-item')].map(i => (i.querySelector('ion-label')?.innerText ?? '').replace(/\\n+/g, ' | ')))()`)

// ---- iPhone in Safari ----
let c = await boot({ ua: 'ios', width: 430, height: 932, init: IOS_INIT })
await sleep(800)
check('iPhone: no Fullscreen API, so no entry', await c.ev('__g.fullscreenSupported') === false)
check('iPhone: install mode is the how-to', await c.ev('__g.installMode') === 'ios')
check('iPhone: audioSession is offered', await c.ev('__g.audioPlaybackSupported') === true)
await c.ev(`document.querySelector('ion-toast')?.dismiss()`); await sleep(600)
await openMenu(c)
let l = await labels(c)
check('menu: no "Tela cheia"', !l.some(x => /Tela cheia/.test(x)))
check('menu: "Instalar o app | Adicionar à Tela de Início"', l.some(x => x === 'Instalar o app | Adicionar à Tela de Início'), l.filter(x => /Instalar/.test(x)).join())
check('menu: "Som no modo silencioso"', l.some(x => /^Som no modo silencioso/.test(x)))
// the audioSession switch
const sw = await c.ev(`(() => { const t = [...document.querySelectorAll('ion-popover.menu-popover ion-toggle')].find(t => t.getAttribute('aria-label') === 'Som no modo silencioso'); t.scrollIntoView({block:'center'}); return true })()`)
await sleep(300)
const r = await c.ev(`(() => { const t = [...document.querySelectorAll('ion-popover.menu-popover ion-toggle')].find(t => t.getAttribute('aria-label') === 'Som no modo silencioso'); const b = t.getBoundingClientRect(); return { x: b.x + b.width/2, y: b.y + b.height/2 } })()`)
await c.tap(r.x, r.y); await sleep(700)
check('turning it on sets audioSession.type = playback', await c.ev('navigator.audioSession.type') === 'playback')
check('and stores the choice', await stored(c, 'audioPlayback') === true)
await shot(c, 'ios-menu-silent')
await tapItem(c, '/Instalar o app/')
const alert = await c.ev(`(() => { const a = document.querySelector('ion-alert'); return a ? { header: a.header, message: a.message, cssClass: a.cssClass, buttons: [...a.querySelectorAll('button.alert-button')].map(b => b.innerText.trim()) } : null })()`)
console.log(JSON.stringify(alert, null, 1))
check('how-to dialog is a win9x-alert, first in the class string', alert && /^win9x-alert/.test(String(alert.cssClass)))
check('it carries the storage warning', alert && /separado do navegador/.test(alert.message))
check('it offers the backup in one tap', alert && alert.buttons.join() === 'Fechar,Exportar jogos salvos', alert?.buttons?.join())
await shot(c, 'ios-howto')
await c.ev(`(() => { [...document.querySelectorAll('ion-alert button.alert-button')].find(b => /Fechar/.test(b.innerText)).click(); return true })()`)
await sleep(600)

// second visit -> the banner says "Como instalar" and opens the same dialog
await c.evBody(`__g.saveStatus.persistSucceeded(__g.saveStatus.persistStarted())`); await sleep(1500)
c = await boot({ ua: 'ios', width: 430, height: 932, init: IOS_INIT, wipe: false, welcome: false })
await sleep(2500)
let t = await toastInfo(c)
check('second visit on iOS: the banner offers "Como instalar"', t && t.buttons.join() === 'Agora não,Como instalar' && /Tela de Início/.test(t.message), JSON.stringify(t))
await shot(c, 'ios-banner')
await clickToast(c, 'Como instalar'); await sleep(1200)
check('its button opens the how-to', await c.ev(`!!document.querySelector('ion-alert') && /Tela de Início/.test(document.querySelector('ion-alert').header)`))
await c.ev(`document.querySelector('ion-alert')?.dismiss()`)

// ---- installed (standalone): nothing is offered ----
// CDP cannot emulate display-mode in this shell, so the iOS flag stands in for it (the media query is covered by the spec).
c = await boot({ ua: 'ios', width: 430, height: 932, init: IOS_INIT + `Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });`, wipe: false, welcome: false })
await sleep(2500)
check('standalone: mode is installed', await c.ev('__g.installMode') === 'installed')
check('standalone: no banner', (await toastInfo(c)) === null, JSON.stringify(await toastInfo(c)))
await openMenu(c)
l = await labels(c)
check('standalone: no install entry', !l.some(x => /Instalar/.test(x)))
await c.send('Emulation.setEmulatedMedia', { features: [] })
