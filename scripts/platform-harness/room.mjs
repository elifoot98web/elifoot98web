// A room holds the screen whatever the switch says (a real host: startHosting needs no peer), lets go when the room closes, and
// leaving to the menu lets go (the fake API's log is kept in sessionStorage across the reload that follows).
//   node scripts/platform-harness/room.mjs
import { boot, shot, check, sleep } from './lib.mjs'
import { FAKE_WAKELOCK, SETTABLE_VISIBILITY } from './fakes.mjs'

const c = await boot({ init: FAKE_WAKELOCK + SETTABLE_VISIBILITY })
await c.ev(`document.querySelector('ion-toast')?.dismiss()`)
const wl = () => c.ev(`JSON.stringify({ requests: __wl.requests, live: __wl.live, holding: __g.wakeLock.holding, summary: __g.wakeLock.summary, inRoom: __g.multiplayerService.isInRoom })`).then(JSON.parse)

// switch off first: a room must hold the screen anyway
await c.evBody(`await __g.toggleKeepAwake({ detail: { checked: false } })`)
await sleep(300)
let s = await wl()
check('switch off, no room: nothing held', s.live === 0 && !s.inRoom, JSON.stringify(s))

await c.evBody(`__g.hostName = 'Anfitrião'; __g.hostRoomId = 'p14test' + Math.floor(Math.random()*1e6); __g.hostPassword = ''; __g.startHosting()`)
for (let i = 0; i < 30; i++) { await sleep(500); s = await wl(); if (s.inRoom) break }
console.log(JSON.stringify(s), await c.ev('__g.isStreaming'))
check('hosting: the room holds the screen although the switch is off', s.inRoom && s.live === 1 && s.holding, JSON.stringify(s))
console.log('summary while hosting:', s.summary)
await shot(c, 'host-room')

await c.evBody(`__g.stopHosting()`)
await sleep(800)
s = await wl()
check('the room closed: the lock is let go (the switch is off)', s.live === 0 && !s.inRoom, JSON.stringify(s))

// leaving to the menu lets go too (switch back on first)
await c.evBody(`await __g.toggleKeepAwake({ detail: { checked: true } })`)
await sleep(500)
s = await wl()
check('switch back on: held', s.live === 1, JSON.stringify(s))
await c.evBody(`sessionStorage.setItem('__wl_log', '[]'); __wl.log.length = 0; __g.leaveGameToMenu()`)
await sleep(6000)
const log = await c.ev(`sessionStorage.getItem('__wl_log')`).catch(() => null)
console.log('wake lock log across leave+reload:', log)
