// The install entry and the one-time banner with a FAKE beforeinstallprompt: first visit shows the rotate hint and no banner, the entry
// calls the prompt once, a second visit (after a session that saved) shows the stacked banner whose button calls the prompt from the tap, and
// it is never shown again.
//   node scripts/platform-harness/install.mjs
import { boot, shot, check, sleep } from './lib.mjs'
import { FAKE_INSTALL_PROMPT_AFTER } from './fakes.mjs'

const toastInfo = c => c.ev(`(() => { const t = document.querySelector('ion-toast'); if (!t) return null; return { message: t.message, layout: t.layout, position: t.position, buttons: [...t.shadowRoot.querySelectorAll('button.toast-button')].map(b => b.textContent.trim()) } })()`)
const clickToast = (c, label) => c.ev(`(() => { const t = document.querySelector('ion-toast'); const b = [...t.shadowRoot.querySelectorAll('button.toast-button')].find(b => b.textContent.trim() === ${JSON.stringify(label)}); b.click(); return !!b })()`)
const stored = (c, key) => c.ev(`(async () => await __g.storageService.get(${JSON.stringify(key)}))()`)
const openMenu = async c => {
  const rect = await c.ev(`(() => { const b = [...document.querySelectorAll('ion-header ion-buttons[slot=end] ion-button')].pop(); const r = b.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2} })()`)
  await c.tap(rect.x, rect.y); await sleep(1000)
}
const entries = c => c.ev(`(() => [...document.querySelectorAll('ion-popover.menu-popover ion-item')].map(i => (i.querySelector('ion-label')?.innerText ?? '').replace(/\\n+/g, ' | ')).filter(t => /Instalar|Tela cheia|silencioso|Armazenamento/.test(t)))()`)

// ---- 1: Android, first visit: no install banner, the rotate hint; menu entry; prompt through the menu ----
let c = await boot({ init: FAKE_INSTALL_PROMPT_AFTER(1500) })
await sleep(1000)
check('Chromium made the prompt available', await c.ev('__g.installMode') === 'prompt')
let t = await toastInfo(c)
check('first visit: the rotate hint, not the install banner', t && /Gire o aparelho/.test(t.message), JSON.stringify(t))
check('the hint has one button, "Entendi"', t.buttons.length === 1 && t.buttons[0].toLowerCase() === 'entendi', JSON.stringify(t.buttons))
await clickToast(c, t.buttons[0]); await sleep(900)
check('answering the hint stores it', await stored(c, 'rotateHintShown') === true)
check('the toast is gone', (await toastInfo(c)) === null)

await openMenu(c)
const list = await entries(c)
console.log(list.join('\n'))
check('menu has "Instalar o app"', list.some(e => /Instalar o app \| Abre em tela cheia/.test(e)))
check('menu has "Armazenamento" in Dados e Backups only after opening it (not here)', !list.some(e => /Armazenamento/.test(e)))
await shot(c, 'install-menu')
const item = await c.ev(`(() => { const i = [...document.querySelectorAll('ion-popover.menu-popover ion-item')].find(i => /Instalar o app/.test(i.innerText)); i.scrollIntoView({block:'center'}); const r = i.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 } })()`)
await sleep(300)
const it2 = await c.ev(`(() => { const i = [...document.querySelectorAll('ion-popover.menu-popover ion-item')].find(i => /Instalar o app/.test(i.innerText)); const r = i.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 } })()`)
await c.tap(it2.x, it2.y); await sleep(1000)
check('tapping the entry shows the browser prompt once', await c.ev('window.__installPrompts') === 1)
check('and the spent prompt takes the entry away', await c.ev('__g.installMode') === 'none')

// ---- 2: second visit, after a session that saved: the banner, with its button calling the prompt ----
await c.evBody(`__g.saveStatus.persistSucceeded(__g.saveStatus.persistStarted())`)
await sleep(1500)
check('a persist is stored (first session done)', typeof await stored(c, 'firstPersistedAt') === 'number')
c = await boot({ wipe: false, init: FAKE_INSTALL_PROMPT_AFTER(1500), welcome: false })
await sleep(2500)
t = await toastInfo(c)
console.log('second visit toast', JSON.stringify(t))
check('second visit: the install banner, stacked, with two buttons', t && /instalar/i.test(t.message) && t.layout === 'stacked' && t.buttons.join() === 'Agora não,Instalar', JSON.stringify(t))
await shot(c, 'install-banner')
await clickToast(c, 'Instalar'); await sleep(1200)
check('its "Instalar" button calls the browser prompt from the tap', await c.ev('window.__installPrompts') === 1)
check('and it is answered for good', await stored(c, 'installNudgeDismissed') === true)

// ---- 3: third visit: never again ----
c = await boot({ wipe: false, init: FAKE_INSTALL_PROMPT_AFTER(1500), welcome: false })
await sleep(3000)
check('third visit: no banner and no hint, nothing at all', (await toastInfo(c)) === null, JSON.stringify(await toastInfo(c)))
check('the menu entry is still the permanent way', await c.ev('__g.installMode') === 'prompt')

// ---- 4: "Agora não" answers it too ----
await c.evBody(`await __g.storageService.set('installNudgeDismissed', false)`)
c = await boot({ wipe: false, init: FAKE_INSTALL_PROMPT_AFTER(1500), welcome: false })
await sleep(2500)
t = await toastInfo(c)
check('banner again once the flag is cleared (test setup)', t && t.buttons.join() === 'Agora não,Instalar')
await clickToast(c, 'Agora não'); await sleep(900)
check('"Agora não" answers it', await stored(c, 'installNudgeDismissed') === true && await c.ev('window.__installPrompts') === 0)

// ---- 5: a tab opened from another app (Chrome gives it an android-app:// referrer) is a tab, not an installed app ----
const FAKE_APP_REFERRER = `Object.defineProperty(Document.prototype, 'referrer', { configurable: true, get() { return 'android-app://com.google.android.googlequicksearchbox/' } });`
c = await boot({ init: FAKE_APP_REFERRER + FAKE_INSTALL_PROMPT_AFTER(1500) })
await sleep(2000)
check('opened from the Google app: still offered the install (mode "prompt", not "installed")', await c.ev('__g.installMode') === 'prompt', await c.ev('__g.installMode'))
