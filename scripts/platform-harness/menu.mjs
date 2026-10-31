// The options menu with the platform entries, as screenshots: the volume group, and the "Armazenamento" line in the "Dados e avançado" window.
//   node scripts/platform-harness/menu.mjs
import { boot, shot, check, sleep } from './lib.mjs'
const openMenu = async c => {
  const rect = await c.ev(`(() => { const b = [...document.querySelectorAll('ion-header ion-buttons[slot=end] ion-button')].pop(); const r = b.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2} })()`)
  await c.tap(rect.x, rect.y); await sleep(1000)
  await c.ev(`document.querySelector('ion-modal.menu-sheet')?.setCurrentBreakpoint?.(1)`); await sleep(600)   // a sheet opens at 60% on a phone; its lower rows are only reachable once it is expanded
}
let c

// ---- the menu: volume and the storage line ----
c = await boot({})
await c.ev(`document.querySelector('ion-toast')?.dismiss()`); await sleep(600)
await openMenu(c)
await c.evBody(`[...document.querySelectorAll('app-options-menu ion-item')].find(i => /Volume do jogo/.test(i.innerText)).scrollIntoView({block:'start'})`)
await sleep(500)
await shot(c, 'menu-volume')
// Outside Angular's zone the binding is only applied by a change-detection pass: ask for it, or the sheet stays up over the toolbar.
await c.evBody(`__g.closeMenu(); ng.applyChanges(document.querySelector('app-game'))`); await sleep(1000)
// Dados e avançado: the row that opens the window, then the storage line it reads from the browser.
await openMenu(c)
await c.evBody(`[...document.querySelectorAll('app-options-menu ion-item')].find(i => /Dados e avançado/.test(i.innerText)).scrollIntoView({block:'center'})`)
await sleep(400)
const r = await c.ev(`(() => { const b = [...document.querySelectorAll('app-options-menu ion-item')].find(i => /Dados e avançado/.test(i.innerText)).getBoundingClientRect(); return { x: b.x + b.width/2, y: b.y + b.height/2 } })()`)
await c.tap(r.x, r.y); await sleep(1800)
await shot(c, 'menu-storage')
console.log('storage line:', await c.ev(`(() => [...document.querySelectorAll('app-advanced-modal .win9x-row')].filter(i => /Armazenamento/.test(i.innerText)).map(i => i.innerText.replace(/\\n+/g,' | ')))()`))
