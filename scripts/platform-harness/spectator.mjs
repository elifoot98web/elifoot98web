// The spectator page holds the screen while the room exists, lets go when it is gone (also on the HOST_LEFT path, where the page drops
// the room itself) and when the page is left. The room is faked on MultiplayerService; the wake lock API is faked.
//   node scripts/platform-harness/spectator.mjs
import { connect, sleep } from '../touch-harness/lib.mjs'
import { ORIGIN, check, USER_AGENTS, PLATFORMS } from './lib.mjs'
import { FAKE_WAKELOCK } from './fakes.mjs'
const c = await connect()
await c.send('Page.navigate', { url: 'about:blank' })
await c.send('Emulation.setUserAgentOverride', { userAgent: USER_AGENTS.android, platform: PLATFORMS.android })
await c.emulate(393, 852, 3, true)
const id = (await c.send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_WAKELOCK })).identifier
await c.send('Page.navigate', { url: `${ORIGIN}#/join-game` })
await sleep(1500)
await c.send('Page.reload', { ignoreCache: true })
for (let i = 0; i < 30; i++) { await sleep(500); if (await c.ev(`!!(window.ng && document.querySelector('app-join-game'))`).catch(() => false)) break }
await sleep(1500)
await c.evBody(`window.__j = ng.getComponent(document.querySelector('app-join-game')); window.__m = __j.multiplayerService; sessionStorage.setItem('__wl_log', '[]');`)
const live = () => c.ev('__wl.live')
check('not in a room: the screen is not held', await live() === 0 && await c.ev('__wl.requests') === 0)
// the room exists a moment before IN_ROOM is announced
await c.evBody(`__m.room = {}; __m.gameStateSubject.next(2 /* WAITING_STREAM */)`)
await sleep(300)
check('in a room: the spectator\'s screen is held', await live() === 1)
await c.evBody(`__m.room = undefined; __m.gameStateSubject.next(0 /* NOT_IN_ROOM */)`)
await sleep(300)
check('the room is gone: the lock is let go', await live() === 0)

// the HOST_LEFT path: the page drops the room itself and announces nothing more
await c.evBody(`__m.room = {}; __m.gameStateSubject.next(3 /* IN_ROOM */)`)
await sleep(300)
check('back in a room: held again', await live() === 1)
await c.evBody(`__m.leaveRoom = (next) => { __m.room = undefined; if (__m.gameStateSubject.value !== next) __m.gameStateSubject.next(next) }; __m.gameStateSubject.next(4 /* HOST_LEFT */)`)
await sleep(400)
check('host left (the page leaves the room inside its own handler): the lock is let go', await live() === 0, String(await live()))

await c.evBody(`__m.room = {}; __m.gameStateSubject.next(3)`)
await sleep(300)
check('held once more', await live() === 1)
await c.send('Page.navigate', { url: `${ORIGIN}#/main` })
await sleep(1500)
check('leaving the page lets go of the lock', await live() === 0)
await c.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: id })
