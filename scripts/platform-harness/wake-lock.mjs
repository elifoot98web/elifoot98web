// WakeLockService on the real page with a FAKE navigator.wakeLock (the headless shell refuses the real one with NotAllowedError):
// asked when the game starts, let go by the menu switch, asked again by the switch and by the page returning, a lock the system
// takes back is asked for once more, a refusal is not retried in a loop and a tap right after one does not ask again.
//   node scripts/platform-harness/wake-lock.mjs
import { boot, shot, check, sleep } from './lib.mjs'
import { FAKE_WAKELOCK, SETTABLE_VISIBILITY } from './fakes.mjs'

const c = await boot({ init: FAKE_WAKELOCK + SETTABLE_VISIBILITY })
await c.ev(`document.querySelector('ion-toast')?.dismiss()`)
await sleep(500)
const wl = () => c.ev(`JSON.stringify({ requests: __wl.requests, live: __wl.live, holding: __g.wakeLock.holding, summary: __g.wakeLock.summary })`).then(JSON.parse)

let s = await wl()
check('requests the screen when the game starts', s.requests === 1 && s.live === 1 && s.holding, JSON.stringify(s))

// the real menu toggle
const openMenu = async () => {
  const rect = await c.ev(`(() => { const b = [...document.querySelectorAll('ion-header ion-buttons[slot=end] ion-button')].pop(); const r = b.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2} })()`)
  await c.tap(rect.x, rect.y); await sleep(1000)
}
const toggleRect = () => c.ev(`(() => { const t = [...document.querySelectorAll('ion-popover.menu-popover ion-toggle')].find(t => t.getAttribute('aria-label') === 'Manter a tela ligada'); t.scrollIntoView({block:'center'}); const r = t.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2, checked: t.checked} })()`)
await openMenu()
let t = await toggleRect(); await sleep(300); t = await toggleRect()
await c.tap(t.x, t.y); await sleep(700)
s = await wl()
check('the menu switch off lets the lock go', s.live === 0 && !s.holding && /Desligada/.test(s.summary), JSON.stringify(s))
const stored = await c.ev(`(async () => await __g.storageService.get('keepAwake'))()`)
check('and the choice is stored as an explicit false', stored === false, String(stored))
await shot(c, 'wl-menu-off')
t = await toggleRect(); await c.tap(t.x, t.y); await sleep(700)
s = await wl()
check('switching it on asks again', s.live === 1 && s.requests === 2 && s.holding, JSON.stringify(s))

// close the menu
await c.evBody(`__g.hidePopover()`); await sleep(500)

// page hidden: the browser takes the lock back; the page returns: asked again
await c.evBody(`__setVisibility('hidden')`); await sleep(200)
await c.evBody(`__wl.sentinels.filter(x => !x.released).forEach(x => x.release())`); await sleep(200)
s = await wl()
check('a hidden page is not asked (and the browser released the lock)', s.live === 0 && s.requests === 2, JSON.stringify(s))
await c.evBody(`__setVisibility('visible')`); await sleep(500)
s = await wl()
check('the page coming back asks again', s.live === 1 && s.requests === 3, JSON.stringify(s))

// the battery saver says no
await c.evBody(`__wl.mode = 'deny'; __wl.sentinels.filter(x => !x.released).forEach(x => x.release())`); await sleep(600)
s = await wl()
check('a lock taken back by the system is asked for once more, and a refusal is not retried in a loop', s.live === 0 && s.requests >= 4 && s.requests <= 5, JSON.stringify(s))
const before = s.requests
await sleep(3000)
s = await wl()
check('no request loop after the refusal', s.requests === before, JSON.stringify(s))
check('summary says the device refused', /não deixou/.test(s.summary), s.summary)
await c.evBody(`__wl.mode = 'grant'`)
await c.tap(200, 300); await sleep(500)   // a tap, too soon after the refusal
s = await wl()
check('a tap right after a refusal does not ask again', s.requests === before, JSON.stringify(s))

// the page returns -> asked again and granted
await c.evBody(`__setVisibility('hidden')`); await c.evBody(`__setVisibility('visible')`); await sleep(500)
s = await wl()
check('page return after refusal asks and is granted', s.live === 1, JSON.stringify(s))

// diagnostics line sample
await c.evBody(`await __g.diagnostics.enable({ persist: false })`)
console.log(await c.ev(`(() => __g.diagnostics.entries.filter(e => e.cat === 'platform').map(e => e.msg).join(' | '))()`))
