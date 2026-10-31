// Helpers of the platform harness: a fresh load of /#/game with a device emulated, and PASS/FAIL lines. It drives the touch
// harness's driver (scripts/touch-harness/driver.mjs, on CDP_PORT, default 9444) over plain fetch.
import { connect, sleep } from '../touch-harness/lib.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export { sleep }
export const ORIGIN = process.env.APP || 'http://localhost:4200/'
export const OUT = process.env.PLATFORM_HARNESS_OUT ?? path.join(os.tmpdir(), 'elifoot-platform-harness')
fs.mkdirSync(OUT, { recursive: true })

export const USER_AGENTS = {
  android: 'Mozilla/5.0 (Linux; Android 14; SM-A075M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Mobile Safari/537.36',
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
}
export const PLATFORMS = { android: 'Linux armv8l', ios: 'iPhone', mac: 'MacIntel' }

/**
 * Fresh load of /#/game with a device emulated. `init` is a script run BEFORE any page script (to fake navigator members);
 * `wipe` clears the site data first; `welcome` dismisses the first-run coach.
 */
export async function boot({ ua = 'android', width = 393, height = 852, dpr = 3, init = '', wipe = true, welcome = true, hash = '#/game', media = null } = {}) {
  const c = await connect()
  await c.send('Page.navigate', { url: 'about:blank' })
  if (wipe) await c.send('Storage.clearDataForOrigin', { origin: new URL(ORIGIN).origin, storageTypes: 'all' })
  if (ua !== 'default') await c.send('Emulation.setUserAgentOverride', { userAgent: USER_AGENTS[ua], platform: PLATFORMS[ua] })
  else await c.send('Emulation.setUserAgentOverride', { userAgent: '' }).catch(() => undefined)
  await c.emulate(width, height, dpr, true)
  await c.send('Emulation.setEmulatedMedia', media ?? { media: '', features: [] })
  // The page target outlives this process, and so do its init scripts: forget every one an earlier run registered.
  const registry = path.join(OUT, 'init-scripts.json')
  const old = fs.existsSync(registry) ? JSON.parse(fs.readFileSync(registry, 'utf8')) : []
  for (const identifier of old) await c.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }).catch(() => undefined)
  fs.writeFileSync(registry, '[]')
  if (init) {
    const identifier = (await c.send('Page.addScriptToEvaluateOnNewDocument', { source: init })).identifier
    fs.writeFileSync(registry, JSON.stringify([identifier]))
  }
  await c.send('Page.navigate', { url: `${ORIGIN}${hash}` })
  await sleep(1500)
  await c.send('Page.reload', { ignoreCache: true })
  let up = false
  const began = Date.now()
  for (let i = 0; i < 120 && !up; i++) {
    await sleep(1000)
    up = await c.ev(`(() => { if (!window.ng) return false; const el = document.querySelector('app-game'); const g = el && ng.getComponent(el); return !!(g && g.dosCI && !g.isHidden) })()`).catch(() => false)
  }
  console.log(`game page up after ${Date.now() - began} ms: ${up}`)
  await sleep(1000)
  if (welcome) {
    // The first-run coach (P13) replaced the welcome alert: "Pular" answers it for good, like "Entendi" did.
    await c.ev(`(() => { const b = [...document.querySelectorAll('app-first-run-coach .coach-actions button')].find(x => /Pular/.test(x.textContent)); b && b.click(); return !!b })()`)
    await sleep(800)
  }
  await c.ev(`(() => { window.__g = ng.getComponent(document.querySelector('app-game')); window.dosCI = __g.dosCI; return !!window.dosCI })()`)
  return c
}

export const shot = (c, name) => c.shot(path.join(OUT, `${name}.png`))

export function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -- ' + detail : ''}`)
  if (!ok) process.exitCode = 1
  return ok
}
