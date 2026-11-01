#!/usr/bin/env node
/**
 * A room between two headless browsers, for the checks that need a spectator (stage.mjs guest, room, leave).
 *
 *   node scripts/touch-harness/room.mjs host [CODE]                 on the host page booted by boot.mjs (driver on CDP_PORT, 9444): start a room. No peer is needed to host.
 *   node scripts/touch-harness/room.mjs join <port> [CODE] [w h]    on a SECOND driver (see below), on <port>: open the app as a spectator, fill the dialog in and join
 *
 * The second browser is another driver.mjs with its own profile and port, and BOTH drivers need the switch that lets two browsers on one
 * machine find each other (Chrome hides the host candidates behind .local names, and a sandbox that cannot resolve them never connects the pair):
 *
 *   CHROME_FLAGS='--disable-features=WebRtcHideLocalIpsWithMdns' node scripts/touch-harness/driver.mjs "$TMPDIR/host" 9444 &
 *   CHROME_FLAGS='--disable-features=WebRtcHideLocalIpsWithMdns' node scripts/touch-harness/driver.mjs "$TMPDIR/guest" 9445 &
 *   node scripts/touch-harness/boot.mjs host android 393 852        # the host's game
 *   node scripts/touch-harness/room.mjs host ELI-TSTA
 *   node scripts/touch-harness/room.mjs join 9445 ELI-TSTA           # about 10 s to a live picture; the first join after a reload sometimes fails (see the multiplayer harness's trap 7): run it again
 *
 * The join happens in a 393x852 window: the room dialog's button is below the fold of a landscape phone. Rotate afterwards. The signalling relays
 * are public nostr servers, so the sandbox must be able to reach them (it was in the phases that used this). **Use a new CODE for each run:** the same
 * code, reused within minutes by a fresh host, failed to join five times in a row (`state 6`, "Multiplayer join error reported by trystero" on the
 * host) and joined at once under a new one. The relays seem to keep the last host's offers for a while; it is not understood, only avoided.
 */
import fs from 'node:fs'
import { connect, sleep } from './lib.mjs'

const [command, ...rest] = process.argv.slice(2)

if (command === 'host') {
  const code = rest[0] ?? 'ELI-TSTA'
  const c = await connect()
  const result = await c.evBody(`const g = ng.getComponent(document.querySelector('app-game')); g.hostRoomId = ${JSON.stringify(code)}; g.hostName = 'Anfitriao'; g.hostMaxSpectators = 6; try { await g.startHosting() } catch (e) { return 'ERR ' + e.message } return 'streaming=' + g.isStreaming`)
  console.log(result, code)
} else if (command === 'join') {
  const [port = '9445', code = 'ELI-TSTA', w = '393', h = '852'] = rest
  const origin = process.env.APP ? new URL(process.env.APP).origin : 'http://localhost:4200'
  const base = `http://127.0.0.1:${port}`
  const { sid } = await (await fetch(`${base}/session`)).json()
  const send = async (method, params = {}) => { const m = await (await fetch(`${base}/send`, { method: 'POST', body: JSON.stringify({ method, params, sessionId: sid }) })).json(); if (m.error) throw new Error(`${method} ${JSON.stringify(m.error)}`); return m.result }
  const ev = async expression => { const r = await send('Runtime.evaluate', { expression: `(async()=>(${expression}))()`, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value }
  await send('Page.navigate', { url: 'about:blank' })
  await send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' })
  await send('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: 2, mobile: true })
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await send('Page.navigate', { url: `${origin}/#/join-game?room=${code}` })
  await sleep(1500)
  await send('Page.reload', { ignoreCache: true })
  for (let i = 0; i < 40; i++) { await sleep(500); if (await ev(`!!document.querySelector('app-room-setup-modal input[name=playerName]')`).catch(() => false)) break }
  await sleep(800)
  // Angular only sees a field when it hears an input event; the dialog's button needs a real click (the multiplayer harness's trap 3).
  await ev(`(() => { const modal = document.querySelector('app-room-setup-modal'); const set = (sel, value) => { const el = modal.querySelector(sel); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('blur', { bubbles: true })) }; set('input[name=playerName]', 'Espectador1'); set('input[name=roomCode]', ${JSON.stringify(code)}) })()`)
  await sleep(600)
  const pt = await ev(`(() => { const b = document.querySelector('app-room-setup-modal button[type=submit]'); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 })
  for (let i = 1; i <= 40; i++) {
    await sleep(1000)
    const state = await ev(`ng.getComponent(document.querySelector('app-join-game')).gameState`).catch(() => -1)
    const video = await ev(`(() => { const v = document.querySelector('#stream-target'); return v ? v.videoWidth + 'x' + v.videoHeight : 'no video' })()`).catch(() => '?')
    if (video !== '0x0' && video !== 'no video' && video !== '?') { console.log(`joined after ${i} s: state ${state}, video ${video}`); break }
    if (i === 40) console.log(`not joined after 40 s: state ${state} (a failed first join needs one retry)`)
  }
  if (process.env.GUEST_SHOT) fs.writeFileSync(process.env.GUEST_SHOT, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
} else {
  console.error('usage: room.mjs host [CODE] | room.mjs join <port> [CODE] [w h]')
  process.exit(1)
}
