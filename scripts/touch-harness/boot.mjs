#!/usr/bin/env node
// Fresh load of the app at /#/game with a device emulated: wait for the game page, dismiss the welcome dialog, expose dosCI.
//
//   node scripts/touch-harness/boot.mjs [label] [ua] [width] [height] [dpr]
//     ua: android (default; js-dos gives it its touchpad) | ios | mac (an iPad's default user agent) | default
//   APP=http://localhost:4291/ node ...        which dev server (default http://localhost:4200/)
//   KEEP=1 node ...                            keep the profile's saved data (it is wiped by default)
//
// The site data is wiped first because a layer the app persisted in an earlier run can leave the guest at the DOS prompt (see the
// README), and a harness that starts from an unknown disk measures nothing.
//
// js-dos reads the user agent once, when its script loads, so the override is set BEFORE the page is.
import { connect, OUT, sleep } from './lib.mjs'
import path from 'node:path'

const [label = 'boot', ua = 'android', width = '390', height = '844', dpr = '2'] = process.argv.slice(2)
const origin = process.env.APP || 'http://localhost:4200/'
const USER_AGENTS = {
  android: 'Mozilla/5.0 (Linux; Android 14; SM-A075M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Mobile Safari/537.36',
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
}
const PLATFORMS = { android: 'Linux armv8l', ios: 'iPhone', mac: 'MacIntel' }

const c = await connect()
await c.send('Page.navigate', { url: 'about:blank' })
if (!process.env.KEEP) await c.send('Storage.clearDataForOrigin', { origin: new URL(origin).origin, storageTypes: 'all' })
if (ua !== 'default') await c.send('Emulation.setUserAgentOverride', { userAgent: USER_AGENTS[ua], platform: PLATFORMS[ua] })
else await c.send('Emulation.setUserAgentOverride', { userAgent: '' }).catch(() => undefined)
await c.emulate(+width, +height, +dpr, true)
// Up to three tries: now and then the guest stays at the DOS prompt (see the README), and a run on a guest that never reached
// Windows measures nothing. "Up" is the app's page being ready; the guest is up when its frame is a graphics mode.
let up = false
let graphics = false
for (let attempt = 1; attempt <= 3 && !graphics; attempt++) {
  await c.send('Page.navigate', { url: `${origin}#/game` })
  await sleep(1500)
  await c.send('Page.reload', { ignoreCache: true })
  const began = Date.now()
  up = false
  for (let i = 0; i < 120 && !up; i++) {
    await sleep(1000)
    up = await c.ev(`(() => { if (!window.ng) return false; const el = document.querySelector('app-game'); const g = el && ng.getComponent(el); return !!(g && g.dosCI && !g.isHidden) })()`).catch(() => false)
  }
  console.log(`game page up after ${Date.now() - began} ms`, up, attempt > 1 ? `(attempt ${attempt})` : '')
  await sleep(800)
  graphics = up && await c.ev(`(() => { const g = ng.getComponent(document.querySelector('app-game')); return g.dosCI.height() >= 480 })()`).catch(() => false)
  if (!graphics) console.log('the guest is not in a graphics mode (still at the DOS prompt?)', attempt < 3 ? '- loading again' : '- giving up')
}
await sleep(800)
await c.ev(`(() => { const b = [...document.querySelectorAll('ion-alert button')].find(x => /Entendi/.test(x.textContent)); b && b.click(); return !!b })()`)
await sleep(800)
await c.ev(`(() => { window.__g = ng.getComponent(document.querySelector('app-game')); window.dosCI = __g.dosCI; return !!window.dosCI })()`)
console.log('frame', await c.ev('dosCI.width() + "x" + dosCI.height()'), '| coarse pointer:', await c.ev(`matchMedia('(pointer: coarse)').matches`))
console.log('js-dos pointer binding:', await c.ev(`JSON.stringify(emulatorsUi.dom.pointers.bind)`))
console.log('touch layer attached:', await c.ev('__g.touchInputService.attached'))
console.log('guest frame:', await c.dosShot(path.join(OUT, 'shots', `${label}.png`)))
