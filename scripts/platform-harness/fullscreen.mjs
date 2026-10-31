// "Tela cheia" through a real tap: the DOCUMENT element goes fullscreen, the orientation is locked to landscape (and let go on exit), and the
// picture, the container and the cursor overlay of a live room follow a viewport change (the shell keeps its emulated size, so the rotation is
// emulated after the fullscreen). Also prints the diagnostics lines.
//   node scripts/platform-harness/fullscreen.mjs
import { boot, shot, check, sleep } from './lib.mjs'
import { FAKE_WAKELOCK } from './fakes.mjs'

const c = await boot({})
await c.ev(`document.querySelector('ion-toast')?.dismiss()`)
await sleep(500)
await c.evBody(`await __g.diagnostics.enable({ persist: false })`)
const info = () => c.ev(`JSON.stringify((() => { const r = el => { const b = el?.getBoundingClientRect(); return b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } : null };
  return { fs: !!document.fullscreenElement, fsEl: document.fullscreenElement?.tagName ?? null, vw: innerWidth, vh: innerHeight, container: r(document.querySelector('#game-container')), canvas: r(document.querySelector('.emulator-canvas')), overlay: r(document.querySelector('#cursors-overlay')),
    orientation: screen.orientation?.type, active: __g.fullscreenActive, summary: __g.fullscreenSummary }; })())`).then(JSON.parse)

// host first, so the cursor overlay exists and is being kept in step
await c.evBody(`__g.hostName = 'Anfitrião'; __g.hostRoomId = 'p14fs' + Math.floor(Math.random()*1e6); __g.hostPassword = ''; __g.startHosting()`)
for (let i = 0; i < 30; i++) { await sleep(500); if (await c.ev('__g.isStreaming')) break }
await c.ev(`document.querySelector('ion-toast')?.dismiss()`)
await sleep(800)
const before = await info()
console.log('before', JSON.stringify(before))
check('overlay exists and covers the canvas before', before.overlay && Math.abs(before.overlay.w - before.canvas.w) <= 1 && Math.abs(before.overlay.h - before.canvas.h) <= 1, JSON.stringify({ o: before.overlay, c: before.canvas }))

// a real tap on the menu entry (a real gesture)
const menu = await c.ev(`(() => { const b = [...document.querySelectorAll('ion-header ion-buttons[slot=end] ion-button')].pop(); const r = b.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2} })()`)
await c.tap(menu.x, menu.y); await sleep(1000)
await c.ev(`document.querySelector('ion-modal.menu-sheet')?.setCurrentBreakpoint?.(1)`); await sleep(600)   // a sheet opens at 60% on a phone; its lower rows are only reachable once it is expanded
await c.ev(`[...document.querySelectorAll('app-options-menu ion-item')].find(i => /Tela cheia/.test(i.innerText)).scrollIntoView({block:'center'})`); await sleep(400)
const item = await c.ev(`(() => { const i = [...document.querySelectorAll('app-options-menu ion-item')].find(i => /Tela cheia/.test(i.innerText)); const r = i.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2, text: i.innerText.replace(/\\n+/g,' | ') } })()`)
console.log('entry:', item.text)
await c.tap(item.x, item.y)
await sleep(1500)
const during = await info()
console.log('during', JSON.stringify(during))
check('the document element is fullscreen (not the game container)', during.fs && during.fsEl === 'HTML', during.fsEl)
check('the page state follows', during.active === true && /Ligada/.test(during.summary), during.summary)
const log = await c.ev(`(() => __g.diagnostics.entries.filter(e => e.cat === 'platform').map(e => e.msg + ' ' + (e.data ?? '')).join('\\n'))()`)
console.log(log)
await shot(c, 'fs-during')

// the relayout must follow the viewport: simulate the size fullscreen gives (the headless shell keeps the emulated size)
await c.send('Emulation.setDeviceMetricsOverride', { width: 852, height: 393, deviceScaleFactor: 3, mobile: true })
await sleep(1200)
const rotated = await info()
console.log('rotated', JSON.stringify(rotated))
check('the container and the canvas followed the new viewport', rotated.vw === 852 && rotated.canvas.h <= 393 && rotated.canvas.w !== during.canvas.w, JSON.stringify(rotated.canvas))
check('the overlay still covers the canvas exactly after the resize', rotated.overlay && Math.abs(rotated.overlay.x - rotated.canvas.x) <= 1 && Math.abs(rotated.overlay.y - rotated.canvas.y) <= 1 && Math.abs(rotated.overlay.w - rotated.canvas.w) <= 1 && Math.abs(rotated.overlay.h - rotated.canvas.h) <= 1, JSON.stringify({ o: rotated.overlay, c: rotated.canvas }))
await shot(c, 'fs-landscape')

// leave fullscreen through the entry
await c.send('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 3, mobile: true })
await sleep(800)
await c.evBody(`await __g.fullscreen.exit()`)
await sleep(800)
const after = await info()
check('fullscreen ended and the state followed', !after.fs && after.active === false, JSON.stringify({ fs: after.fs, active: after.active }))
check('the picture is back where it was', Math.abs(after.canvas.w - before.canvas.w) <= 1 && Math.abs(after.canvas.h - before.canvas.h) <= 1 && Math.abs(after.overlay.w - after.canvas.w) <= 1, JSON.stringify({ a: after.canvas, b: before.canvas }))
console.log((await c.ev(`(() => __g.diagnostics.entries.filter(e => e.cat === 'platform').map(e => e.msg).join(' | '))()`)))
await c.evBody(`__g.stopHosting()`)
