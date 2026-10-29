#!/usr/bin/env node
// The Macintosh-UA iPad matrix. iPadOS reports a Mac, so js-dos takes the desktop (pointer lock) path and gives a finger no input
// at all. Checks that the touch layer fixes that, that a real mouse still reaches js-dos, that the "Modo de toque" choice is not
// offered (classic would be a dead screen here), that a stored "classic" is ignored, and, as the CONTROL, that without the layer
// a tap really does send the guest nothing. Chromium emulation only: real iPad Safari is on the device checklist.
//
//   node scripts/touch-harness/boot.mjs ipad mac 820 1180 2 && node scripts/touch-harness/ipad.mjs
import { session } from './nav.mjs'
import { sleep } from './lib.mjs'

const s = await session()
const { c } = s
const check = (ok, what, detail = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? `  ${detail}` : ''}`)

const bind = JSON.parse(await c.ev('JSON.stringify(emulatorsUi.dom.pointers.bind)'))
console.log('UA:', await c.ev('navigator.userAgent.slice(0, 70)'), '| coarse pointer:', await c.ev(`matchMedia('(pointer: coarse)').matches`), '| frame', JSON.stringify(await s.frame()))
check(bind.mobile === false && bind.canLock === true && bind.starters[0] === 'mousedown', 'js-dos classifies this user agent as a desktop (pointer lock, mousedown)', JSON.stringify(bind))

// Spies: what reaches js-dos's handlers, what the guest is sent, whether pointer lock is requested.
await c.ev(`(() => {
  const overlay = document.querySelector('.emulator-mouse-overlay'); window.__reach = []; window.__lock = 0; window.__bl = []
  for (const t of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart']) overlay.addEventListener(t, e => window.__reach.push(t + ':' + (e.pointerType || '')))
  const request = overlay.requestPointerLock
  overlay.requestPointerLock = function () { window.__lock++; try { return request.apply(this, arguments) } catch (e) { /* the iPad's own failure */ } }
  if (!dosCI.__realBtn2) { dosCI.__realBtn2 = dosCI.sendMouseButton; dosCI.sendMouseButton = function (b, p) { window.__bl.push(p ? 'down' : 'up'); return dosCI.__realBtn2.call(dosCI, b, p) } }
  return 1 })()`)
const spy = async () => JSON.parse(await c.ev('JSON.stringify({ reach: window.__reach.splice(0), lock: window.__lock, buttons: window.__bl.splice(0) })'))
const ok = await s.toCssC(215, -90)      // Acerca's OK button

check(await c.ev('__g.touchInputService.attached'), 'direct touch is attached by default on this iPad')
await c.tap(ok.x, ok.y, 70); await sleep(2200)
let r = await spy()
check(r.buttons.join() === 'down,up' && r.lock === 0, 'a tap on OK clicks (down, up) and requests no pointer lock', JSON.stringify(r))
check(!r.reach.some(e => e.startsWith('mouse')) && !r.reach.some(e => e.endsWith(':touch')), 'js-dos never saw the touch, nor the browser\'s mouse copy of it', JSON.stringify(r.reach))

// A real mouse (pointerType mouse) is left alone: js-dos asks for pointer lock as on a desktop.
const rect = await s.rect()
await c.mouse('mouseMoved', rect.left + 300, rect.top + 200)
await c.mouse('mousePressed', rect.left + 300, rect.top + 200, { button: 'left', clickCount: 1, buttons: 1 }); await sleep(100)
await c.mouse('mouseReleased', rect.left + 300, rect.top + 200, { button: 'left', clickCount: 1, buttons: 0 }); await sleep(400)
r = await spy()
check(r.lock >= 1 && r.reach.includes('pointerdown:mouse'), 'a real mouse click still reaches js-dos, which requests pointer lock', JSON.stringify(r))
await c.ev(`document.exitPointerLock && document.exitPointerLock()`)

const offered = await c.ev(`new Promise(resolve => __g.touchModeChoice$.subscribe(value => resolve(value)))`)
check(offered === false, 'the "Modo de toque" choice is NOT offered here', `offered=${offered}`)
await c.ev(`(() => { __g.touchMode = 'classic'; __g.applyTouchMode(); return 1 })()`)
check(await c.ev('__g.touchInputService.attached'), 'a stored "classic" is ignored on this device: direct stays attached', `menu would say: ${await c.ev('__g.touchModeSummary')}`)

// CONTROL: the layer off is what stock js-dos does with a finger on this user agent.
await c.ev(`__g.touchInputService.detach('harness control')`)
await spy()
await c.tap(ok.x, ok.y, 70); await sleep(1500)
r = await spy()
check(r.buttons.length === 0, 'CONTROL, layer off: a tap sends the guest no click at all (stock js-dos gives this iPad no touch input)', JSON.stringify(r))
await c.ev(`(() => { __g.touchMode = 'direct'; __g.applyTouchMode(); return 1 })()`)
