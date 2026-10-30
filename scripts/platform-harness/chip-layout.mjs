// Where the "Ativar som" chip goes: in the toolbar at 360 and 402 px WITH a live room (the room pill must not be clipped), and as a round
// button in the gutter of a landscape phone (no toolbar).
//   node scripts/platform-harness/chip-layout.mjs
import { boot, shot, check, sleep } from './lib.mjs'
import { FAKE_AUDIO_STATE, SETTABLE_VISIBILITY } from './fakes.mjs'

for (const [w, h] of [[360, 740], [402, 874]]) {
  const c = await boot({ width: w, height: h, init: FAKE_AUDIO_STATE + SETTABLE_VISIBILITY })
  await c.ev(`document.querySelector('ion-toast')?.dismiss()`)
  await c.evBody(`__g.hostName = 'Anfitrião'; __g.hostRoomId = 'p14lay' + Math.floor(Math.random()*1e6); __g.hostPassword = 'x'; __g.startHosting()`)
  for (let i = 0; i < 30; i++) { await sleep(500); if (await c.ev('__g.isStreaming')) break }
  await c.evBody(`__audio.allowResume = false; __forceAudio('suspended')`)
  await sleep(1800)
  const m = await c.ev(`(() => {
    const rect = el => { const r = el?.getBoundingClientRect(); return r ? { x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height) } : null };
    const pill = document.querySelector('.mp-status-pill');
    const code = pill?.querySelector('.mp-status-code');
    return JSON.stringify({ pill: rect(pill), chip: rect(document.querySelector('.sound-chip')), save: rect(document.querySelector('.save-chip')), menu: rect([...document.querySelectorAll('ion-header ion-buttons[slot=end] ion-button')].pop()),
      pillClipped: pill ? pill.scrollWidth > pill.clientWidth + 1 : null, codeClipped: code ? code.scrollWidth > code.clientWidth + 1 : null, saveDisplay: getComputedStyle(document.querySelector('.save-chip')).display, blocked: __g.audioHealth.status.blocked }) })()`)
  console.log(w + 'x' + h, m)
  const j = JSON.parse(m)
  check(`${w}px hosting: the chip is there`, j.chip && j.chip.w > 0)
  check(`${w}px hosting: the room pill is not clipped`, j.pill && !j.pillClipped && !j.codeClipped, JSON.stringify(j.pill))
  await shot(c, `chip-host-${w}`)
  await c.evBody(`__g.stopHosting()`)
}

// landscape phone: no toolbar, the chip goes in the gutter
const c = await boot({ width: 844, height: 390, init: FAKE_AUDIO_STATE + SETTABLE_VISIBILITY })
await c.ev(`document.querySelector('ion-toast')?.dismiss()`)
await c.evBody(`__audio.allowResume = false; __forceAudio('suspended')`)
await sleep(1800)
const g = await c.ev(`JSON.stringify((() => { const rect = el => { const r = el?.getBoundingClientRect(); return r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null }; return { header: !!document.querySelector('ion-header'), chip: rect(document.querySelector('.sound-chip')), menu: rect(document.querySelector('.gutter-menu-btn')), canvas: rect(document.querySelector('.emulator-canvas')), radius: getComputedStyle(document.querySelector('.sound-chip')).borderRadius } })())`)
console.log('landscape', g)
const j = JSON.parse(g)
check('landscape-compact: no toolbar, the chip is a 44px round button in the gutter', !j.header && j.chip && j.chip.w === 44 && j.chip.h === 44, JSON.stringify(j.chip))
check('landscape-compact: it is beside the picture, not over it', j.chip.x + j.chip.w <= j.canvas.x, JSON.stringify({ chip: j.chip, canvas: j.canvas }))
await shot(c, 'chip-landscape')
