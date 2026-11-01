// AudioHealthService + the "Ativar som" chip on the real page. The context's state is FORCED (the headless shell has no audio device and
// suspends the context by itself, see README.md): interrupted after a call and refusing a resume without a gesture -> resume tried when the
// page returns, chip after the grace period, a tap on the chip resumes it, so does the first tap on the game; a hidden page shows nothing.
//   node scripts/platform-harness/audio.mjs
import { boot, shot, check, sleep } from './lib.mjs'
import { FAKE_AUDIO_STATE, SETTABLE_VISIBILITY } from './fakes.mjs'

const c = await boot({ init: FAKE_AUDIO_STATE + SETTABLE_VISIBILITY })
await c.ev(`document.querySelector('ion-toast')?.dismiss()`)
await sleep(500)
const st = () => c.ev(`JSON.stringify({ status: __g.audioHealth.status, resumes: __audio.resumes, chip: !!document.querySelector('.sound-chip') })`).then(JSON.parse)

let s = await st()
check('a running context shows no chip', s.status.state === 'running' && !s.chip, JSON.stringify(s))

// WebKit after a phone call: interrupted, and refuses a resume without a gesture
await c.evBody(`__audio.allowResume = false; __setVisibility('hidden'); __forceAudio('interrupted'); __setVisibility('visible')`)
await sleep(400)
s = await st()
check('the page tried to resume when it came back', s.resumes >= 1, JSON.stringify(s))
check('no chip yet: the page still has its grace', !s.chip, JSON.stringify(s))
await sleep(1200)
s = await st()
check('after the grace the chip is there', s.chip && s.status.blocked && s.status.state === 'interrupted', JSON.stringify(s))
await shot(c, 'audio-chip-portrait')
const chipRect = await c.ev(`(() => { const r = document.querySelector('.sound-chip').getBoundingClientRect(); const t = document.querySelector('.sound-chip-text'); return { x: r.x, y: r.y, w: r.width, h: r.height, textShown: getComputedStyle(t).display !== 'none', label: document.querySelector('.sound-chip').getAttribute('aria-label') } })()`)
console.log(JSON.stringify(chipRect))
check('under 600px the chip is the speaker alone, and its name is the words', !chipRect.textShown && chipRect.label === 'Ativar som')
check('hit area is at least 44px tall', chipRect.h >= 43.5, String(chipRect.h))

// a tap on the chip resumes inside the gesture
await c.evBody(`__audio.allowResume = true`)
const before = (await st()).resumes
await c.tap(chipRect.x + chipRect.w / 2, chipRect.y + chipRect.h / 2)
await sleep(500)
s = await st()
check('tapping the chip resumes the context and the chip goes', !s.chip && s.status.state === 'running' && s.resumes > before, JSON.stringify(s))

// the gesture path: blocked again, then a tap ANYWHERE (on the game) wakes it
await c.evBody(`__audio.allowResume = false; __forceAudio('suspended')`)
await sleep(1600)
s = await st()
check('suspended and refused: chip again', s.chip, JSON.stringify(s))
await c.evBody(`__audio.allowResume = true`)
const r2 = await c.ev(`(() => { const r = document.querySelector('#game-container').getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 } })()`)
await c.tap(r2.x, r2.y)
await sleep(500)
s = await st()
check('the first tap on the game wakes it by the page\'s own gesture listener', !s.chip && s.status.state === 'running', JSON.stringify(s))

// hidden page: no chip, no resume
const r0 = (await st()).resumes
await c.evBody(`__audio.allowResume = false; __setVisibility('hidden'); __forceAudio('interrupted')`)
await sleep(2000)
s = await st()
check('a hidden page shows no chip and asks for nothing', !s.chip && s.resumes === r0, JSON.stringify(s))
await c.evBody(`__setVisibility('visible')`)
await sleep(300)
await c.evBody(`__audio.allowResume = true; __forceAudio(null)`)
await sleep(500)
s = await st()
check('and when it runs again, clean', !s.chip && s.status.state === 'running', JSON.stringify(s))
