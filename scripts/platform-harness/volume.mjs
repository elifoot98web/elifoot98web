// "Volume do jogo" / "Silenciar o jogo" through the real menu: js-dos's gain follows the slider (AudioParam writes are logged), the choice is
// stored and comes back after a reload, a mute is a gain of 0 and the slider unmutes, the wipe removes js-dos's own copy
// (emulators.ui.volume), and capture() connects the script processor itself (before the gain) to the spectators' stream. The level of that
// stream is NOT measured: this shell has no audio device, so the context's clock does not advance.
//   node scripts/platform-harness/volume.mjs
import { boot, shot, check, sleep } from './lib.mjs'

const INIT = `(() => {
  const d = Object.getOwnPropertyDescriptor(AudioParam.prototype, 'value');
  window.__gain = [];
  Object.defineProperty(AudioParam.prototype, 'value', { configurable: true, get: d.get, set(v) { window.__gain.push(v); d.set.call(this, v); } });
})();`
const openMenu = async c => {
  const rect = await c.ev(`(() => { const b = [...document.querySelectorAll('ion-header ion-buttons[slot=end] ion-button')].pop(); const r = b.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2} })()`)
  await c.tap(rect.x, rect.y); await sleep(1000)
}
const stored = (c, key) => c.ev(`(async () => await __g.storageService.get(${JSON.stringify(key)}))()`)
const lastGain = c => c.ev('__gain[__gain.length - 1]')

let c = await boot({ init: INIT })
await c.ev(`document.querySelector('ion-toast')?.dismiss()`); await sleep(500)
check('js-dos has a gain of 1 at the start', (await lastGain(c)) === 1, String(await lastGain(c)))

await openMenu(c)
await c.evBody(`[...document.querySelectorAll('ion-popover.menu-popover ion-range')][0].scrollIntoView({block:'center'})`); await sleep(400)
const range = await c.ev(`(() => { const r = document.querySelector('ion-popover.menu-popover ion-range').getBoundingClientRect(); return { x: r.x, y: r.y + r.height/2, w: r.width } })()`)
await shot(c, 'vol-menu')
await c.tap(range.x + range.w * 0.5, range.y)
await sleep(800)
const pct = await c.ev('__g.volumePercent')
check('a tap in the middle of the slider sets about half', pct >= 35 && pct <= 65, String(pct))
check('and js-dos\'s gain follows', Math.abs((await lastGain(c)) - pct / 100) < 0.011, String(await lastGain(c)))
check('the choice is stored by the app', Math.abs((await stored(c, 'gameVolume')) - pct / 100) < 0.011, String(await stored(c, 'gameVolume')))
console.log('js-dos own copy:', await c.ev(`localStorage.getItem('emulators.ui.volume')`))

// mute through the real toggle
const mute = await c.ev(`(() => { const t = [...document.querySelectorAll('ion-popover.menu-popover ion-toggle')].find(t => /Silenciar/.test(t.innerText)); t.scrollIntoView({block:'center'}); return true })()`)
await sleep(300)
const mr = await c.ev(`(() => { const t = [...document.querySelectorAll('ion-popover.menu-popover ion-toggle')].find(t => /Silenciar/.test(t.innerText)); const b = t.getBoundingClientRect(); return { x: b.x + b.width/2, y: b.y + b.height/2 } })()`)
await c.tap(mr.x, mr.y); await sleep(700)
check('Silenciar sets the gain to 0', (await lastGain(c)) === 0, String(await lastGain(c)))
check('the slider keeps its place', await c.ev('__g.volumePercent') === pct)
check('mute is stored, apart from the volume', (await stored(c, 'gameMuted')) === true && Math.abs((await stored(c, 'gameVolume')) - pct / 100) < 0.011)
console.log('status while muted:', await c.ev('JSON.stringify(__g.audioHealth.status)'))
check('a muted game is a context that RUNS (not mistaken for a blocked one)', (await c.ev('__g.audioHealth.status.blocked')) === false)
console.log(await c.ev('__g.volumeSummary'))

// Spectators: not measured here. This headless shell has no audio output, so the context's clock does not advance
// (currentTime stays at 0.0058) and nothing is pulled through the graph; the claim rests on reading MultiplayerAudioService.
// What can be shown: only js-dos's gain parameter was written, and capture() taps the script processor itself.
const topology = await c.evBody(`
  const node = getDosAudioNode(); const ctx = node.context;
  const calls = []; const orig = node.connect; node.connect = function (...a) { calls.push(a[0]?.constructor?.name); return orig.apply(this, a); };
  const track = __g.multiplayerAudioService.capture(true);
  node.connect = orig;
  __g.multiplayerAudioService.clear();
  return JSON.stringify({ connectedTo: calls, hasTrack: !!track, gainWrites: __gain.length });
`)
console.log('capture() connects the script processor to:', topology)
check('capture() connects the script processor itself to the stream destination (before js-dos\'s gain node)', JSON.parse(topology).connectedTo.join() === 'MediaStreamAudioDestinationNode')

// the slider unmutes
await c.evBody(`await __g.audioHealth.applyVolume(0, true)`)
// restore state to muted via the page then move the slider
await c.evBody(`__g.gameMuted = true`)
await c.evBody(`__g.onVolumeInput({ detail: { value: 30 } })`)
check('moving the slider above zero unmutes', await c.ev('__g.gameMuted') === false && (await lastGain(c)) === 0.3, String(await lastGain(c)))
await c.evBody(`await __g.onVolumeChange({ detail: { value: 30 } })`)
await c.evBody(`await __g.toggleGameMuted({ detail: { checked: true } })`)

// reload: the volume and the mute come back
c = await boot({ wipe: false, welcome: false, init: INIT })
await sleep(500)
check('after a reload the page is muted and the slider is where it was', await c.ev('__g.gameMuted') === true && await c.ev('__g.volumePercent') === 30)
check('and js-dos got the gain 0 again', (await lastGain(c)) === 0, String(await lastGain(c)))

// the wipe
await c.evBody(`await __g.storageService.clearAllData()`)
check('the wipe removes js-dos\'s own copy of the volume', await c.ev(`localStorage.getItem('emulators.ui.volume')`) === null)
check('and the app\'s', (await stored(c, 'gameVolume')) == null && (await stored(c, 'gameMuted')) == null)
