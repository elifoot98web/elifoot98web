#!/usr/bin/env node
/**
 * The in-app camera (CameraService, "Zoom e movimento", CLAUDE.md *The camera*) against the real page: that the picture is never
 * resized, that the unzoomed path is the page it always was, that two real fingers pinch and pan, that a tap lands on the guest pixel it
 * was aimed at at every zoom (graded against the guest's RAM), that the host's cursor overlay and the stream the spectators get do not
 * care, and that the deck, the rails and the sheet still work while the picture is magnified.
 *
 *   node scripts/touch-harness/camera.mjs layout [sizes]   at twelve windows and the scales 1, 1.5, 2 and 3: the picture's box (offset*, the canvas) is identical to its 1x self, the rectangle is the camera's, the clip covers the view, the stage plan does not move, the taskbar is on screen; no transform at 1x
 *   node scripts/touch-harness/camera.mjs identical        the camera off and the camera on at the fit leave the page byte for byte the same (root attributes, computed transform, every rectangle)
 *   node scripts/touch-harness/camera.mjs pinch            real two-finger CDP touches: a spread, a pan, a second finger cancelling a drag with no stuck button, a two-finger tap, a third finger, one finger lifting, a cancelled touch, a quick double tap (a double click and NOT a zoom), fingers on the clip beside the picture
 *   node scripts/touch-harness/camera.mjs accuracy         taps at seeded places of the visible picture at 1x, 1.5x, 2x and 3x, graded against the RAM oracle (the buttons are swallowed: nothing is clicked), plus a real click on a 12 px radio at 2x
 *   node scripts/touch-harness/camera.mjs radio           a real click on a 12 px radio of the New / Continue dialog (from Acerca): a finger 5 css px to the LEFT of its centre misses it at the fit and hits it at 2x
 *   node scripts/touch-harness/camera.mjs overlay          hosting (no peer needed): a spectator's cursor lands on the canvas fraction it was sent at 1x, 1.5x, 2x and 3x; the captureStream is the whole 640x480 frame at every zoom, and its picture does not change with the zoom
 *   node scripts/touch-harness/camera.mjs deck             real taps on the Zoom tab and its keys in the band (and the sheet on a landscape phone): presets, + and -, the pad and its hold, the band's folding and coming back, the panel in the tall view
 *   node scripts/touch-harness/camera.mjs bar              the live type bar and the chat while zoomed: neither moves the camera, and the chat gives the band back to the 4:3 clip
 *   node scripts/touch-harness/camera.mjs chat             hosting, the chat docked while zoomed: in portrait it gives the band back (the clip is the stage again), on a landscape phone it takes the right rail and narrows the stage, and the camera stays valid and comes back
 *   node scripts/touch-harness/camera.mjs rotate           rotation while zoomed: one camera per orientation, stored and restored, across a reload too
 *   node scripts/touch-harness/camera.mjs power            the battery saver wakes on a pinch and on the buttons (straight after the boot: it needs the New / Continue dialog before its radio is chosen, which puts a blinking caret on the screen and keeps the guest awake)
 *
 * It needs the page booted by boot.mjs (a dev build: it reads window.ng). The camera is OFF as shipped; every mode switches it on through the
 * page's own handler first and leaves it on, with the camera at the fit. `accuracy`, `pinch` and `overlay` need the game on a screen where a
 * tap does no harm (Acerca, straight after the boot): they never press Enter or Esc, which on the first dialog quit the game (CLAUDE.md,
 * "Guest hazard"), and `accuracy` swallows the mouse button. Screenshots go to $TOUCH_HARNESS_OUT/shots (lib.mjs).
 */
import path from 'node:path'
import { OUT, sleep } from './lib.mjs'
import { swallowButtons } from './measure.mjs'
import { session } from './nav.mjs'

const [mode = 'layout', arg] = process.argv.slice(2)
const s = await session()
const { c } = s
const check = (ok, what, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? `  ${detail}` : ''}`); if (!ok) process.exitCode = 1 }
const settle = async (ms = 650) => { await c.evBody(`ng.applyChanges(document.querySelector('app-game'))`); await sleep(ms); await c.evBody(`ng.applyChanges(document.querySelector('app-game'))`); await sleep(250) }
const round = (v, n = 100) => Math.round(v * n) / n
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance
const shot = name => c.shot(path.join(OUT, 'shots', `camera-${name}.png`))

// ---------------------------------------------------------------------------------------------------------------- the page

/** Switches the camera on through the page's own handler, at the fit, and returns once the page has taken it. */
async function cameraOn() {
  // A fresh profile on a portrait phone gets the one-time "Gire o aparelho" toast (P14), which covers the toolbar and the top of the picture.
  await c.ev(`(async () => { for (const toast of document.querySelectorAll('ion-toast')) await toast.dismiss(); return 1 })()`)
  const on = await c.ev(`__g.cameraEnabled`)
  if (!on) await c.evBody(`await __g.toggleCamera({ detail: { checked: true } })`)
  await c.evBody(`__g.camera.fit()`)
  await settle(300)
}
const state = () => c.ev(`JSON.stringify({ ...__g.camera.current, tf: document.getElementById('game-container').style.transform, tall: __g.cameraTall, view: __g.cameraView, shown: __g.deckShown, kind: __g.layout.kind, shape: __g.layout.shape })`).then(JSON.parse)
const rectOf = selector => c.ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height] })()`)
const boxOf = () => c.ev(`(() => {
  const r = document.getElementById('game-container'), v = document.querySelector('.emulator-canvas')
  return [r.offsetWidth, r.offsetHeight, r.offsetLeft, r.offsetTop, v.offsetWidth, v.offsetHeight, v.offsetLeft, v.offsetTop, v.style.width, v.style.height, v.style.left, v.style.top, v.width, v.height].join('|')
})()`)
/** Both fingers of a gesture as CDP touch points. */
const two = (a, b) => [{ x: a[0], y: a[1], id: 1 }, { x: b[0], y: b[1], id: 2 }]
async function pinchOut(mid, from, to, steps = 12, hold = 25) {
  await c.touch('touchStart', [{ x: mid[0] - from, y: mid[1], id: 1 }]); await sleep(40)
  await c.touch('touchStart', two([mid[0] - from, mid[1]], [mid[0] + from, mid[1]])); await sleep(40)
  for (let i = 1; i <= steps; i++) {
    const d = from + (to - from) * i / steps
    await c.touch('touchMove', two([mid[0] - d, mid[1]], [mid[0] + d, mid[1]])); await sleep(hold)
  }
  await c.touch('touchEnd', []); await sleep(250)
}
async function panBy(start, dx, dy, steps = 10, gap = 80) {
  await c.touch('touchStart', two([start[0], start[1]], [start[0] + gap, start[1]])); await sleep(40)
  for (let i = 1; i <= steps; i++) { await c.touch('touchMove', two([start[0] + dx * i / steps, start[1] + dy * i / steps], [start[0] + gap + dx * i / steps, start[1] + dy * i / steps])); await sleep(25) }
  await c.touch('touchEnd', []); await sleep(250)
}

const MATRIX = [
  [360, 640, 0, 0, 0, 'A07-class portrait'], [393, 852, 0, 0, 0, 'iPhone 15 Pro portrait'], [430, 932, 0, 0, 0, 'iPhone 15 Pro Max portrait'], [375, 667, 0, 0, 0, 'iPhone SE portrait'],
  [844, 390, 47, 47, 21, 'iPhone 13/14 landscape (notch)'], [915, 412, 0, 0, 0, 'A07-class landscape'], [932, 430, 59, 59, 21, 'iPhone 15 Pro Max landscape'], [667, 375, 0, 0, 0, 'iPhone SE landscape'],
  [820, 1180, 0, 0, 0, 'iPad portrait'], [1180, 820, 0, 0, 0, 'iPad Air landscape'], [1024, 768, 0, 0, 0, 'iPad landscape'], [1280, 800, 0, 0, 0, 'laptop'],
]
const emulate = async (w, h, l = 0, r = 0, b = 0) => {
  await c.emulate(w, h, 2, true)
  await c.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, left: l, bottom: b, right: r } })
  await settle()
}

// ---------------------------------------------------------------------------------------------------------------- layout

if (mode === 'layout') {
  await cameraOn()
  const wanted = arg ? arg.split(',').map(x => x.split('x').map(Number)) : null
  const list = wanted ? MATRIX.filter(m => wanted.some(([w, h]) => w === m[0] && h === m[1])) : MATRIX
  const table = []
  for (const [w, h, l, r, b, what] of list) {
    await emulate(w, h, l, r, b)
    await c.evBody(`__g.applyDeckSetting('auto')`)
    await c.evBody(`__g.camera.fit()`); await settle(300)
    const label = `${w}x${h}${l || r ? ` (${l}/${r}/${b})` : ''}`
    const plan0 = await c.ev(`JSON.stringify(__g.stagePlan)`)
    const box0 = await boxOf()
    const clip0 = await rectOf('.game-stream-container')
    const container0 = await rectOf('#game-container')
    const base = await c.ev(`document.getElementById('game-container').getAttribute('style')`)
    check(await c.ev(`getComputedStyle(document.getElementById('game-container')).transform`) === 'none', `${label}: at the fit the picture has NO transform`)
    for (const scale of [1.5, 2, 3]) {
      await c.evBody(`__g.camera.fit(); __g.camera.zoomTo(${scale})`); await settle(350)
      const st = await state()
      const box = await boxOf()
      const container = await rectOf('#game-container')
      const clip = await rectOf('.game-stream-container')
      const dock = await rectOf('app-dock')
      const vp = await c.ev(`[innerWidth, innerHeight]`)
      check(box === box0, `${label} ${scale}x: the picture's box (offset*, the canvas's style) is what it was at the fit — js-dos is not asked to re-letterbox`, box === box0 ? '' : `${box0} -> ${box}`)
      check(await c.ev(`JSON.stringify(__g.stagePlan)`) === plan0, `${label} ${scale}x: the stage plan does not move`)
      // Against the rectangle at the fit, not offset*: 75vw is 294.75 px and offsetHeight says 295.
      check(near(container[2], container0[2] * scale, 0.02) && near(container[3], container0[3] * scale, 0.02), `${label} ${scale}x: the rectangle is the box times the scale`, `${round(container[2])}x${round(container[3])} for ${round(container0[2])}x${round(container0[3])}`)
      check(near(container[0], clip[0] + st.x, 1) && near(container[1], clip[1] + st.y, 1), `${label} ${scale}x: and where the camera puts it (the device grid)`, `${round(container[0])},${round(container[1])} vs ${round(clip[0] + st.x)},${round(clip[1] + st.y)}`)
      const covers = container[0] <= clip[0] + 0.51 && container[1] <= clip[1] + 0.51
        && container[0] + container[2] >= clip[0] + clip[2] - 0.51 - (container[2] < clip[2] ? clip[2] : 0)
        && (container[3] >= clip[3] - 0.51 || (st.shape === 'portrait' && st.tall))
      check(covers, `${label} ${scale}x: the magnified picture covers the clip (or, in the tall portrait view, is cut at the bottom edge of what it needs)`)
      check(clip[0] >= -0.5 && clip[0] + clip[2] <= vp[0] + 0.5 && clip[1] + clip[3] <= vp[1] + 0.5, `${label} ${scale}x: the clip is on the screen`, JSON.stringify(clip.map(v => round(v))))
      if (dock && st.kind === 'band') check(clip[1] + clip[3] <= dock[1] + 0.5, `${label} ${scale}x: the taskbar is below the clip, on the screen`, `clip bottom ${round(clip[1] + clip[3])}, dock top ${round(dock[1])}, dock bottom ${round(dock[1] + dock[3])}, window ${vp[1]}`)
      if (dock && st.kind === 'band') check(dock[1] + dock[3] <= vp[1] + 0.5, `${label} ${scale}x: the whole taskbar is on the screen`)
      if (st.shape === 'portrait' && st.kind === 'band') check(st.tall === true && clip[3] >= clip0[3] - 0.5, `${label} ${scale}x: in portrait with the band folded the clip grew into it`, `${round(clip0[3])} -> ${round(clip[3])}`)
      if (st.shape !== 'portrait') check(near(clip[2], clip0[2], 0.5) && near(clip[3], clip0[3], 0.5), `${label} ${scale}x: in landscape the clip is the stage and does not change`)
      if (scale === 2) await shot(`layout-${w}x${h}-2x`)
      table.push([label, scale, `${round(container[2])}x${round(container[3])}`, `${round(clip[2])}x${round(clip[3])}`, st.tall ? 'tall' : '-', `${round(st.x)},${round(st.y)}`])
    }
    await c.evBody(`__g.camera.fit()`); await settle(300)
    check(await c.ev(`document.getElementById('game-container').getAttribute('style')`) === base, `${label}: back at the fit the root has the style attribute it had`, `${base}`)
    check(await rectOf('.game-stream-container') && (await rectOf('.game-stream-container')).every((v, i) => near(v, clip0[i], 0.01)), `${label}: and the clip is the box it was`)
  }
  console.table(table.map(([window, scale, container, clip, tall, at]) => ({ window, scale, container, clip, tall, at })))
}

// ---------------------------------------------------------------------------------------------------------------- identical

if (mode === 'identical') {
  await emulate(393, 852)
  const snapshot = async () => c.ev(`JSON.stringify((() => {
    const root = document.getElementById('game-container'), canvas = document.querySelector('.emulator-canvas')
    const rect = e => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height] }
    return { attrs: [...root.attributes].map(a => a.name + '=' + a.value), computed: getComputedStyle(root).transform, origin: getComputedStyle(root).transformOrigin,
      unscale: root.style.getPropertyValue('--camera-unscale'), rects: ['#game-container', '.emulator-canvas', '.game-stream-container', 'app-dock', '.emulator-mouse-overlay'].map(s => rect(document.querySelector(s))),
      rootClass: root.className, rowClass: document.querySelector('.game-stream-flex-container').className }
  })())`).then(JSON.parse)
  await c.evBody(`await __g.toggleCamera({ detail: { checked: false } })`); await settle(300)
  const off = await snapshot()
  await c.evBody(`await __g.toggleCamera({ detail: { checked: true } })`); await settle(300)
  const onFit = await snapshot()
  const strip = snap => ({ ...snap, rowClass: snap.rowClass.replace(/\s*camera-on\b/, '') })
  check(JSON.stringify(strip(onFit).attrs) === JSON.stringify(off.attrs), 'the root\'s attributes are the same with the camera off and on at the fit', JSON.stringify(off.attrs))
  check(off.computed === 'none' && onFit.computed === 'none', 'no computed transform in either', `${off.computed} / ${onFit.computed}`)
  check(JSON.stringify(strip(onFit).rects) === JSON.stringify(off.rects), 'every rectangle (picture, canvas, clip, taskbar, js-dos\'s overlay) is identical to the last digit')
  check(strip(onFit).rowClass === off.rowClass && onFit.rootClass === off.rootClass, 'and so are the classes (only `camera-on` is added to the row)', `${onFit.rowClass}`)
  // zoom and come back: the same
  await c.evBody(`__g.camera.zoomTo(2)`); await settle(300)
  await c.evBody(`__g.camera.fit()`); await settle(300)
  const back = await snapshot()
  check(JSON.stringify(strip(back).attrs) === JSON.stringify(off.attrs) && JSON.stringify(back.rects) === JSON.stringify(off.rects), '2x and back to the fit leaves the same attributes and rectangles', JSON.stringify(back.attrs))
  check(back.unscale === '' && back.computed === 'none', 'and no leftover transform or custom property')
  // the setting off with a zoom stored: nothing applied
  await c.evBody(`__g.camera.zoomTo(2)`); await settle(300)
  await c.evBody(`await __g.toggleCamera({ detail: { checked: false } })`); await settle(300)
  const offAgain = await snapshot()
  check(JSON.stringify(strip(offAgain).attrs) === JSON.stringify(off.attrs) && JSON.stringify(offAgain.rects) === JSON.stringify(off.rects), 'switching the camera off while zoomed puts the page back exactly')
  await c.evBody(`await __g.toggleCamera({ detail: { checked: true } })`); await settle(300)
  check((await state()).scale === 2, 'and switching it on again brings the zoom that was left back')
  await c.evBody(`__g.camera.fit()`); await settle(300)
}

// ---------------------------------------------------------------------------------------------------------------- pinch

if (mode === 'pinch') {
  await emulate(393, 852)
  await cameraOn()
  await c.ev(`(() => { window.__bl = []; if (!dosCI.__realBtn2) { dosCI.__realBtn2 = dosCI.sendMouseButton; dosCI.sendMouseButton = function (b, p) { window.__bl.push(p ? 'down' : 'up'); return dosCI.__realBtn2.call(dosCI, b, p) } } return 1 })()`)
  const buttons = () => c.ev(`window.__bl.splice(0).join(',')`)
  const gestureNow = async () => c.ev(`JSON.stringify((() => { const i = __g.touchInputService.inspect(); return { g: i.gesture, down: i.buttonDown, pending: i.pending } })())`).then(JSON.parse)
  const centre = [196, 330]

  await buttons()
  await pinchOut(centre, 50, 130)
  let st = await state()
  check(st.scale > 2 && st.scale <= 3, 'a real spread of two fingers zooms', `${round(st.scale)}x`)
  check(st.tf !== '' && st.tf.includes('scale('), 'by a transform on the root', st.tf)
  check((await buttons()) === '', 'and clicks nothing')
  check((await gestureNow()).g === 'idle', 'and the touch layer is idle afterwards')
  await shot('pinch-out')

  // The content under the fingers' midpoint stays under it HORIZONTALLY, where the picture is always wider than the view. Vertically it
  // does not, and the harness does not grade it as if it did: each step of a pinch is the change since the last one and the camera owes
  // nothing for the distance it could not go, so while the picture is shorter than the view (the tall view of a portrait phone, until
  // about 2.5x) or only just taller than it (the Zoom panel open, 2.15x), the room for the move opens at the end of the gesture and the
  // picture has stayed near the top edge (CLAUDE.md, *The camera*, "Known"). What must hold is that the camera is valid: the picture's
  // top edge is inside what the clip allows, and at the clip's top edge itself when the picture is no taller than the view.
  await c.evBody(`__g.camera.fit()`); await settle(300)
  const before = await s.rect()
  const mid = [196, 150]
  const guestUnder = r => ({ x: (mid[0] - r.left) / r.width * 640, y: (mid[1] - r.top) / r.height * 480 })
  const g0 = guestUnder(before)
  await pinchOut(mid, 40, 90)
  const after = await s.rect()
  const g1 = guestUnder(after)
  const clipNow = await rectOf('.game-stream-container')
  check(near(g0.x, g1.x, 4), 'the guest pixel under the fingers\' midpoint is the same after the spread, horizontally', `${round(g0.x, 10)} -> ${round(g1.x, 10)}`)
  const room = Math.max(0, after.height - clipNow[3])
  check(after.top <= clipNow[1] + 1 && after.top >= clipNow[1] - room - 1 && (room > 0 || near(after.top, clipNow[1], 1)), 'and vertically the picture stays where the clip allows (at its top edge when the picture is no taller than the view)', `top ${round(after.top, 10)} in ${round(clipNow[1] - room, 10)}..${round(clipNow[1], 10)}; guest y ${round(g0.y, 10)} -> ${round(g1.y, 10)}, picture ${round(after.height)} px in a view of ${round(clipNow[3])}`)

  // pan: horizontally at any zoom, vertically once the picture is taller than the view (3x)
  await c.evBody(`__g.camera.zoomTo(3)`); await settle(400)
  const p0 = await state()
  await panBy([250, 300], -90, 40)
  const p1 = await state()
  check(near(p1.x - p0.x, -90, 3) && near(p1.y - p0.y, 40, 3) && p1.scale === p0.scale, 'two fingers moving together pan the picture by their travel and do not zoom', `dx ${round(p1.x - p0.x)} dy ${round(p1.y - p0.y)}`)

  // a pinch in, back to the fit
  const mid2 = [196, 330]
  await c.touch('touchStart', two([mid2[0] - 130, mid2[1]], [mid2[0] + 130, mid2[1]])); await sleep(40)
  for (let i = 1; i <= 16; i++) { const d = 130 - i * 8; await c.touch('touchMove', two([mid2[0] - d, mid2[1]], [mid2[0] + d, mid2[1]])); await sleep(25) }
  await c.touch('touchEnd', []); await sleep(250)
  st = await state()
  check(st.scale === 1 && st.tf === '', 'a pinch in all the way is the fit, and the transform is gone', `${st.scale} ${JSON.stringify(st.tf)}`)

  // a second finger cancels a one-finger drag: no stuck button
  await c.evBody(`__g.camera.zoomTo(2)`); await settle(300)
  await buttons()
  await c.touch('touchStart', [{ x: 120, y: 300, id: 1 }]); await sleep(60)
  for (let i = 1; i <= 5; i++) { await c.touch('touchMove', [{ x: 120 + i * 8, y: 300, id: 1 }]); await sleep(30) }
  await sleep(150)
  const dragging = await gestureNow()
  await c.touch('touchStart', two([160, 300], [260, 360])); await sleep(120)
  const afterSecond = await gestureNow()
  await c.touch('touchEnd', []); await sleep(500)
  const log = await buttons()
  check(dragging.g === 'drag' && dragging.down, 'the first finger is dragging with the button held', JSON.stringify(dragging))
  check(!afterSecond.down && afterSecond.pending === 0, 'the second finger releases it at once: no stuck button', JSON.stringify(afterSecond))
  check(log === 'down,up', 'one press, one release, no click', log)

  // a two-finger tap clicks nothing
  await c.touch('touchStart', two([150, 400], [250, 400])); await sleep(60); await c.touch('touchEnd', []); await sleep(600)
  check((await buttons()) === '', 'a two-finger tap clicks nothing')

  // a third finger changes nothing
  const t0 = await state()
  await c.touch('touchStart', two([150, 400], [250, 400])); await sleep(40)
  await c.touch('touchStart', [...two([150, 400], [250, 400]), { x: 200, y: 600, id: 3 }]); await sleep(40)
  for (let i = 1; i <= 6; i++) { await c.touch('touchMove', [...two([150 - i * 6, 400], [250 + i * 6, 400]), { x: 200 + i * 20, y: 600, id: 3 }]); await sleep(25) }
  await c.touch('touchEnd', []); await sleep(300)
  const t1 = await state()
  check(t1.scale > t0.scale, 'a third finger does not stop the pinch of the first two', `${round(t0.scale)} -> ${round(t1.scale)}`)
  check((await buttons()) === '', 'and clicks nothing')

  // one finger lifts: the other is dead, and a new finger does not pair with it
  const l0 = await state()
  await c.touch('touchStart', two([150, 400], [250, 400])); await sleep(60)
  await c.touch('touchEnd', [{ x: 250, y: 400, id: 2 }]); await sleep(80)
  const lifted = await gestureNow()
  await c.touch('touchStart', [{ x: 150, y: 400, id: 1 }, { x: 320, y: 500, id: 4 }]); await sleep(40)
  for (let i = 1; i <= 6; i++) { await c.touch('touchMove', [{ x: 150, y: 400, id: 1 }, { x: 320 + i * 12, y: 500, id: 4 }]); await sleep(25) }
  await c.touch('touchEnd', []); await sleep(400)
  const l1 = await state()
  check(l1.scale === l0.scale && l1.x === l0.x, 'one finger lifting ends the pinch; the finger that is left and the next one do not start another', `${JSON.stringify(lifted)}`)
  check((await buttons()) === '', 'and nothing is clicked by the finger that is left')

  // a cancelled touch in the middle of a pinch
  await c.touch('touchStart', two([150, 400], [250, 400])); await sleep(40)
  await c.touch('touchMove', two([140, 400], [260, 400])); await sleep(40)
  await c.touch('touchCancel', []); await sleep(300)
  check((await gestureNow()).g === 'idle' && (await buttons()) === '', 'a touch the browser cancels mid-pinch leaves the layer idle and clicks nothing')

  // two quick taps are a double CLICK, never a zoom
  await c.evBody(`__g.camera.fit()`); await settle(300)
  await buttons()
  await c.ev(`(() => { if (!dosCI.__keep) { dosCI.__keep = dosCI.sendMouseButton; dosCI.sendMouseButton = (b, p) => { window.__bl.push(p ? 'down' : 'up') } } return 1 })()`)
  await c.tap(120, 200, 40); await sleep(110); await c.tap(120, 200, 40); await sleep(700)
  const dbl = await buttons()
  check(dbl === 'down,up,down,up' && (await state()).scale === 1, 'two quick taps are a double click and do NOT zoom', `${dbl} ${(await state()).scale}x`)
  await c.ev(`(() => { if (dosCI.__keep) { dosCI.sendMouseButton = dosCI.__keep; delete dosCI.__keep } return 1 })()`)

  // the tall view: fingers on the part of the clip the picture does not cover still pinch
  await c.evBody(`__g.camera.zoomTo(1.25)`); await settle(400)
  const tall = await state()
  const clip = await rectOf('.game-stream-container')
  const pict = await rectOf('#game-container')
  const deadY = Math.round((pict[1] + pict[3] + clip[1] + clip[3]) / 2)
  check(tall.tall && deadY > pict[1] + pict[3], 'at 1.25x the tall view has a part below the picture', `picture ends ${round(pict[1] + pict[3])}, clip ends ${round(clip[1] + clip[3])}`)
  await buttons()
  const before125 = (await state()).scale
  await pinchOut([196, deadY], 30, 90)
  check((await state()).scale > before125, 'a pinch with both fingers there zooms (the clip is where the layer listens)', `${before125} -> ${round((await state()).scale)}`)
  check((await buttons()) === '', 'and clicks nothing')
  await c.evBody(`__g.camera.fit()`); await settle(300)
}

// ---------------------------------------------------------------------------------------------------------------- accuracy

if (mode === 'accuracy') {
  await emulate(393, 852)
  await cameraOn()
  await s.loadOracle()
  console.log('oracle ready', JSON.stringify(await s.frame()))
  await swallowButtons(c, true)
  const rng = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const taps = +(process.env.TAPS || 10)
  const worstOf = {}
  for (const scale of [1, 1.5, 2, 3]) {
    await c.evBody(`__g.camera.fit(); ${scale > 1 ? `__g.camera.zoomTo(${scale})` : ''}`); await settle(350)
    // Visit the corners of the picture as well as the middle: pan to a seeded place by the camera's own pad.
    const places = scale === 1 ? [[]] : [[], ['left', 'up'], ['right', 'down'], ['left', 'down']]
    const rows = []
    for (const nudges of places) {
      for (const direction of nudges) { for (let k = 0; k < 8; k++) await c.evBody(`__g.camera.nudge('${direction}')`) }
      await settle(250)
      const rnd = rng(11 + Math.round(scale * 10) + nudges.length)
      const visible = await c.ev(`(() => {
        const cv = document.querySelector('.emulator-canvas').getBoundingClientRect(), cl = document.querySelector('.game-stream-container').getBoundingClientRect()
        const left = Math.max(cv.left, cl.left), top = Math.max(cv.top, cl.top), right = Math.min(cv.right, cl.right), bottom = Math.min(cv.bottom, cl.bottom)
        return { left, top, right, bottom, cv: { left: cv.left, top: cv.top, width: cv.width, height: cv.height } }
      })()`)
      for (let i = 0; i < taps; i++) {
        // A finger place inside the visible part of the picture, 6 css px from every edge.
        const x = visible.left + 6 + rnd() * (visible.right - visible.left - 12)
        const y = visible.top + 6 + rnd() * (visible.bottom - visible.top - 12)
        const gx = Math.floor((x - visible.cv.left) / visible.cv.width * 640)
        const gy = Math.floor((y - visible.cv.top) / visible.cv.height * 480)
        await c.ev(`(window.__btn.length = 0, 1)`)
        await c.touch('touchStart', [{ x, y }]); await sleep(70); await c.touch('touchEnd', [])
        for (let k = 0; k < 150; k++) { if ((await c.ev(`__g.touchInputService.inspect().pending`)) === 0) break; await sleep(20) }
        await sleep(200)
        const truth = await c.ev('ORACLE.read()')
        rows.push({ gx, gy, ex: truth.x - gx, ey: truth.y - gy, buttons: (await c.ev('window.__btn')).length })
        await sleep(350)
        // The camera follows a click near an edge: the picture may have moved. Re-read the places for the next tap.
        visible.cv = await c.ev(`(() => { const b = document.querySelector('.emulator-canvas').getBoundingClientRect(); return { left: b.left, top: b.top, width: b.width, height: b.height } })()`)
        const cl = await rectOf('.game-stream-container')
        visible.left = Math.max(visible.cv.left, cl[0]); visible.top = Math.max(visible.cv.top, cl[1])
        visible.right = Math.min(visible.cv.left + visible.cv.width, cl[0] + cl[2]); visible.bottom = Math.min(visible.cv.top + visible.cv.height, cl[1] + cl[3])
      }
    }
    const errors = rows.flatMap(r => [Math.abs(r.ex), Math.abs(r.ey)])
    const worst = Math.max(...errors)
    worstOf[scale] = worst
    check(worst <= 3 && rows.every(r => r.buttons === 2), `${scale}x: ${rows.length} taps over the visible picture land within 3 px of the guest pixel under the finger`, `worst ${worst} px, median ${errors.sort((a, b) => a - b)[Math.floor(errors.length / 2)]} px, buttons ok ${rows.every(r => r.buttons === 2)}`)
  }
  await swallowButtons(c, false)
  await c.evBody(`__g.camera.fit()`); await settle(300)
}

// ---------------------------------------------------------------------------------------------------------------- radio

if (mode === 'radio') {
  await emulate(393, 852)
  await cameraOn()
  // Acerca's OK, then the New / Continue dialog: the "Quero começar" radio is 12 guest px across, a 7 css px target at the fit.
  await s.tapC(215, -90, 2400)
  const radioG = { x: 320 - 205, y: 240 - 117 }
  const region = () => c.evBody(`const im = await dosCI.screenshot(); const out = []; for (let y = ${radioG.y - 8}; y < ${radioG.y + 8}; y++) for (let x = ${radioG.x - 8}; x < ${radioG.x + 8}; x++) { const i = (y * im.width + x) * 4; out.push(im.data[i], im.data[i + 1], im.data[i + 2]) } return out.join(',')`)
  const differs = (a, b) => a.split(',').filter((v, i) => v !== b.split(',')[i]).length
  await shot('radio-dialog-fit')
  const base = await region()
  // To the LEFT: the radio's caption is part of the control (a click on the words selects it), so a miss to the right is not a miss.
  const offset = -5   // css px: a plausible miss for a fingertip, 8 guest px at the fit and 4 at 2x
  const fit = await s.toCss(radioG.x + 0.5 - 0.5, radioG.y)
  // The guest cursor is drawn into the frame, so it is parked on the dialog's backdrop (a tap that does nothing) before the look.
  const parkCursor = async () => { const away = await s.toCss(580, 430); await c.tap(away.x, away.y, 70); await sleep(900) }
  await c.tap(fit.x + offset, fit.y, 70); await sleep(700)
  await parkCursor()
  const afterFit = await region()
  check(differs(base, afterFit) === 0, 'at the fit a finger 5 css px left of the radio\'s centre misses it (nothing changes)', `${differs(base, afterFit)} values changed`)

  await c.evBody(`__g.camera.zoomTo(2); for (let i = 0; i < 6; i++) { __g.camera.nudge('left'); __g.camera.nudge('up') }`); await settle(400)
  await shot('radio-dialog-2x')
  const zoomed = await s.toCss(radioG.x + 0.5 - 0.5, radioG.y)
  const clip = await rectOf('.game-stream-container')
  check(zoomed.x > clip[0] + 10 && zoomed.x < clip[0] + clip[2] - 10 && zoomed.y > clip[1] + 10 && zoomed.y < clip[1] + clip[3] - 10, 'the radio is in view at 2x', `${round(zoomed.x)},${round(zoomed.y)}`)
  await c.tap(zoomed.x + offset, zoomed.y, 70); await sleep(700)
  await c.evBody(`__g.camera.fit()`); await settle(300)
  await parkCursor()
  const afterZoom = await region()
  check(differs(base, afterZoom) > 10, 'at 2x the same finger, 5 css px left, selects it', `${differs(base, afterZoom)} values changed`)
  await shot('radio-selected-2x')
  await c.evBody(`__g.camera.fit()`); await settle(300)
}

// ---------------------------------------------------------------------------------------------------------------- overlay

if (mode === 'overlay') {
  await emulate(393, 852)
  await cameraOn()
  const hosting = await c.ev(`__g.isStreaming`)
  if (!hosting) {
    const result = await c.evBody(`__g.hostRoomId = 'ELI-CAMT'; __g.hostName = 'Anfitriao'; __g.hostMaxSpectators = 6; try { await __g.startHosting() } catch (e) { return 'ERR ' + e.message } return 'streaming=' + __g.isStreaming`)
    console.log('hosting:', result)
  }
  await sleep(1500)
  await settle()
  check(await c.ev(`!!document.querySelector('#cursors-overlay')`), 'the host has the cursor overlay')

  const place = fractions => c.evBody(`__g.renderCursors(${JSON.stringify(Object.fromEntries(fractions.map(([x, y], i) => [`peer${i}`, { x, y, color: '#ff0000', name: `E${i}`, id: `peer${i}` }])))}); await new Promise(r => setTimeout(r, 120))`)
  const where = () => c.ev(`JSON.stringify((() => {
    const cv = document.querySelector('.emulator-canvas').getBoundingClientRect(), ov = document.querySelector('#cursors-overlay').getBoundingClientRect()
    const cursors = [...document.querySelectorAll('#cursors-overlay .cursor')].map(e => { const b = e.getBoundingClientRect(); return [b.left, b.top] })
    return { cv: [cv.left, cv.top, cv.width, cv.height], ov: [ov.left, ov.top, ov.width, ov.height], cursors }
  })())`).then(JSON.parse)
  const fractions = [[0.5, 0.5], [0.1, 0.9], [0.8, 0.2]]
  await place(fractions)
  for (const scale of [1, 1.5, 2, 3]) {
    await c.evBody(`__g.camera.fit(); ${scale > 1 ? `__g.camera.zoomTo(${scale})` : ''}`); await settle(400)
    await place(fractions)
    const w = await where()
    const edge = Math.max(...w.cv.map((v, i) => Math.abs(v - w.ov[i])))
    check(edge <= 0.5 * scale + 1, `${scale}x: the overlay is on the canvas`, `largest edge difference ${round(edge)} px (bound ${round(0.5 * scale + 1)})`)
    // The cursor's top-left is at the normalised point of the OVERLAY; the canvas fraction is what the spectator pointed at.
    const worst = Math.max(...w.cursors.flatMap(([x, y], i) => [Math.abs((x - w.cv[0]) / w.cv[2] - fractions[i][0]) * w.cv[2], Math.abs((y - w.cv[1]) / w.cv[3] - fractions[i][1]) * w.cv[3]]))
    check(worst <= 0.5 * scale + 1.5, `${scale}x: every remote cursor is where its spectator pointed, as a fraction of the canvas`, `worst ${round(worst)} px on the screen (1.25 px at 2.5x was measured by TOUCH-4)`)
    if (scale === 2) await shot('overlay-2x')
  }

  // The stream: the whole frame at every zoom.
  const streamAt = async scale => {
    await c.evBody(`__g.camera.fit(); ${scale > 1 ? `__g.camera.zoomTo(${scale})` : ''}`); await settle(400)
    return c.evBody(`
      const canvas = document.querySelector('.emulator-canvas')
      const stream = canvas.captureStream(30)
      const track = stream.getVideoTracks()[0]
      // In the page, off screen: a detached video decodes nothing in the headless shell and drawImage then paints a transparent frame.
      const video = document.createElement('video'); video.muted = true; video.playsInline = true; video.srcObject = stream
      video.style.cssText = 'position:fixed;left:-9999px;top:0;width:160px;height:120px'
      document.body.append(video)
      await video.play().catch(() => {})
      for (let i = 0; i < 80 && !(video.videoWidth > 0 && video.readyState >= 2); i++) await new Promise(r => setTimeout(r, 50))
      await new Promise(r => setTimeout(r, 600))
      // The video drawn at its own size, against the guest's framebuffer (dosCI.screenshot) at 600 places. Not against the canvas: its
      // WebGL buffer is not preserved, so drawing it back reads transparent outside the paint.
      const probe = document.createElement('canvas'); probe.width = video.videoWidth; probe.height = video.videoHeight
      const ctx = probe.getContext('2d'); ctx.drawImage(video, 0, 0)
      const seen = ctx.getImageData(0, 0, probe.width, probe.height)
      const frame = await dosCI.screenshot()
      let total = 0, n = 0, worst = 0
      for (let y = 6; y < frame.height; y += 16) for (let x = 6; x < frame.width; x += 16) {
        const i = (y * frame.width + x) * 4
        const d = (Math.abs(seen.data[i] - frame.data[i]) + Math.abs(seen.data[i + 1] - frame.data[i + 1]) + Math.abs(seen.data[i + 2] - frame.data[i + 2])) / 3
        total += d; n++; worst = Math.max(worst, d)
      }
      // a coarse signature too, for comparing one zoom to another
      const grid = []
      for (let y = 40; y < frame.height; y += 80) for (let x = 40; x < frame.width; x += 80) { const i = (y * probe.width + x) * 4; grid.push(seen.data[i], seen.data[i + 1], seen.data[i + 2]) }
      const result = { size: video.videoWidth + 'x' + video.videoHeight, canvas: canvas.width + 'x' + canvas.height, settings: JSON.stringify(track.getSettings()), meanDiff: total / n, share: seen.data.length, worst, grid }
      track.stop(); video.srcObject = null; video.remove()
      return JSON.stringify(result)`).then(JSON.parse)
  }
  const frames = {}
  for (const scale of [1, 1.5, 2, 3]) {
    frames[scale] = await streamAt(scale)
    console.log(`${scale}x stream`, frames[scale].size, 'canvas', frames[scale].canvas, frames[scale].settings)
  }
  check(Object.values(frames).every(f => f.size === '640x480' && f.canvas === '640x480'), 'the captureStream is the whole 640x480 frame at 1x, 1.5x, 2x and 3x')
  const diff = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])))
  check(Object.values(frames).every(f => f.meanDiff < 8), 'and what the stream carries is the guest\'s frame (the video against the framebuffer at 600 places), at every zoom', `mean difference ${Object.entries(frames).map(([z, f]) => `${z}x ${round(f.meanDiff)}`).join(', ')}`)
  check([1.5, 2, 3].every(z => diff(frames[1].grid, frames[z].grid) < 40), 'and it is not the zoomed view: the video\'s signature at 1x is its signature at 1.5x, 2x and 3x', `${[1.5, 2, 3].map(z => diff(frames[1].grid, frames[z].grid)).join(',')}`)

  // The same stream over a real WebRTC pair inside the page (an RTCPeerConnection to another one: the encoder, the packets and the
  // decoder are the ones a spectator's are, the relays and the network are not). The received picture is the guest's frame at every
  // zoom, to within the codec; a camera that leaked into the stream would show the crop.
  const received = async scale => {
    await c.evBody(`__g.camera.fit(); ${scale > 1 ? `__g.camera.zoomTo(${scale})` : ''}`); await settle(400)
    return c.evBody(`
      const canvas = document.querySelector('.emulator-canvas')
      const stream = canvas.captureStream(30)
      const a = new RTCPeerConnection(), b = new RTCPeerConnection()
      a.onicecandidate = e => e.candidate && b.addIceCandidate(e.candidate)
      b.onicecandidate = e => e.candidate && a.addIceCandidate(e.candidate)
      const arrival = new Promise(resolve => { b.ontrack = e => resolve(e.streams[0]) })
      stream.getTracks().forEach(t => a.addTrack(t, stream))
      await a.setLocalDescription(await a.createOffer())
      await b.setRemoteDescription(a.localDescription)
      await b.setLocalDescription(await b.createAnswer())
      await a.setRemoteDescription(b.localDescription)
      const remote = await Promise.race([arrival, new Promise((_, reject) => setTimeout(() => reject(new Error('no track in 8 s')), 8000))])
      const video = document.createElement('video'); video.muted = true; video.playsInline = true; video.srcObject = remote
      video.style.cssText = 'position:fixed;left:-9999px;top:0;width:160px;height:120px'; document.body.append(video)
      await video.play().catch(() => {})
      for (let i = 0; i < 100 && !(video.videoWidth > 0 && video.readyState >= 2); i++) await new Promise(r => setTimeout(r, 50))
      await new Promise(r => setTimeout(r, 2500))
      const probe = document.createElement('canvas'); probe.width = 640; probe.height = 480
      const ctx = probe.getContext('2d'); ctx.drawImage(video, 0, 0, 640, 480)
      const seen = ctx.getImageData(0, 0, 640, 480)
      const frame = await dosCI.screenshot()
      let total = 0, n = 0
      for (let y = 6; y < 480; y += 16) for (let x = 6; x < 640; x += 16) {
        const i = (y * 640 + x) * 4
        total += (Math.abs(seen.data[i] - frame.data[i]) + Math.abs(seen.data[i + 1] - frame.data[i + 1]) + Math.abs(seen.data[i + 2] - frame.data[i + 2])) / 3; n++
      }
      const result = { size: video.videoWidth + 'x' + video.videoHeight, meanDiff: total / n }
      video.remove(); a.close(); b.close(); stream.getTracks().forEach(t => t.stop())
      return JSON.stringify(result)`, 30000).then(JSON.parse)
  }
  const wire = {}
  for (const scale of [1, 3]) { wire[scale] = await received(scale); console.log(`${scale}x over WebRTC (loopback):`, JSON.stringify(wire[scale])) }
  check(wire[1].meanDiff < 25 && wire[3].meanDiff < 25, 'over a WebRTC pair the received picture is the guest\'s frame at 1x and at 3x (a crop would be far off)', `mean difference ${round(wire[1].meanDiff)} / ${round(wire[3].meanDiff)}`)
  check(Math.abs(wire[1].meanDiff - wire[3].meanDiff) < 8, 'and the zoom makes no difference to it', `${round(Math.abs(wire[1].meanDiff - wire[3].meanDiff))}`)
  await c.evBody(`__g.camera.fit()`); await settle(300)
}

// ---------------------------------------------------------------------------------------------------------------- deck

if (mode === 'deck') {
  await emulate(393, 852)
  await cameraOn()
  const tab = async pattern => c.ev(`(() => { const b = [...document.querySelectorAll('app-dock .deck-taskbar .deck-tab')].find(x => ${pattern}.test(x.textContent)); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 } })()`)
  const key = async label => c.ev(`(() => { const b = [...document.querySelectorAll('.camera-panel button')].find(x => x.getAttribute('aria-label') === ${JSON.stringify(label)}); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2, w: r.width, h: r.height, disabled: b.disabled, pressed: b.getAttribute('aria-pressed') } })()`)
  const tapAt = async p => { await c.tap(p.x, p.y, 70); await sleep(450) }

  // The run starts from the page's own start: the camera at the fit and Táticas open (a previous run may have left another panel up).
  await c.evBody(`__g.camera.fit()`); await settle(300)
  for (let i = 0; i < 3 && (await state()).shown !== 'tactics'; i++) await tapAt(await tab(/Táticas/))
  let st = await state()
  check(st.shown === 'tactics' && !st.tall, 'to begin: the band shows Táticas and the clip is the 4:3 stage', `${st.shown}`)
  const clip4x3 = await rectOf('.game-stream-container')
  await tapAt(await tab(/Zoom/))
  st = await state()
  check(st.shown === 'camera' && !st.tall, 'the Zoom tab opens its panel; at the fit the clip is still the stage', `${st.shown} tall ${st.tall}`)
  await shot('deck-panel-fit')
  const keys = ['Ajustar: ver a imagem inteira', 'Ampliar 1,5x', 'Ampliar 2x', 'Diminuir o zoom', 'Aumentar o zoom', 'Ver mais à esquerda', 'Ver mais acima', 'Ver mais abaixo', 'Ver mais à direita']
  const sizes = []
  for (const k of keys) sizes.push([k, await key(k)])
  check(sizes.every(([, p]) => p && p.w >= 43.5 && p.h >= 43.5), 'every key of the panel is 44x44 or more', JSON.stringify(sizes.filter(([, p]) => !p || p.w < 43.5 || p.h < 43.5).map(([k, p]) => [k, p && [round(p.w), round(p.h)]])))
  const panel = await rectOf('.camera-panel')
  check(panel[1] + panel[3] <= 852 && panel[0] >= 0, 'the panel is on the screen', JSON.stringify(panel.map(v => round(v))))

  await tapAt(await key('Ampliar 2x'))
  st = await state()
  check(st.scale === 2 && st.tall && st.shown === 'camera', 'a tap on 2x zooms, and the clip takes the band the panel leaves (tall) with the panel still up', `${st.scale}x tall ${st.tall}`)
  const tallClip = await rectOf('.game-stream-container')
  const panelTop = (await rectOf('.camera-panel'))[1]
  check(tallClip[1] + tallClip[3] <= panelTop + 0.5 && tallClip[3] > clip4x3[3] + 50, 'the tall clip ends above the panel and is taller than the stage', `${round(clip4x3[3])} -> ${round(tallClip[3])}`)
  check((await key('Ampliar 2x')).pressed === 'true', 'the preset in force is the lit key')
  await shot('deck-panel-2x')

  const x0 = (await state()).x
  await tapAt(await key('Ver mais à direita'))
  const x1 = (await state()).x
  check(x1 < x0, 'the pad looks to the right: the picture goes left', `${round(x0)} -> ${round(x1)}`)
  // hold
  const pad = await key('Ver mais à esquerda')
  await c.touch('touchStart', [{ x: pad.x, y: pad.y }]); await sleep(1300)
  await c.touch('touchEnd', []); await sleep(200)
  const x2 = (await state()).x
  check(x2 > x1 && x2 === 0, 'holding a pad key repeats until the edge', `${round(x1)} -> ${round(x2)}`)
  const rest = (await state()).x
  await sleep(500)
  check((await state()).x === rest, 'and stops on the lift')

  await tapAt(await key('Aumentar o zoom'))
  check((await state()).scale === 2.5, '+ is one rung of the ladder', `${(await state()).scale}`)
  await tapAt(await key('Diminuir o zoom'))
  await tapAt(await key('Diminuir o zoom'))
  check((await state()).scale === 1.75, 'and - another way', `${(await state()).scale}`)
  await tapAt(await key('Ampliar 1,5x'))
  check((await state()).scale === 1.5, '1,5x', '')
  await tapAt(await key('Ajustar: ver a imagem inteira'))
  st = await state()
  check(st.scale === 1 && st.tf === '' && !st.tall, 'Ajustar is the fit: no transform, the clip is the stage again', JSON.stringify(st.tf))
  check((await rectOf('.game-stream-container')).every((v, i) => near(v, clip4x3[i], 0.01)), 'and the clip is exactly the box it was')

  // the band folds when the picture is magnified and comes back at the fit
  await tapAt(await tab(/Táticas/))
  check((await state()).shown === 'tactics', 'Táticas open')
  await c.evBody(`__g.camera.zoomTo(2)`); await settle(400)
  st = await state()
  check(st.shown === null && st.tall, 'magnifying the picture folds the panel and the camera takes the band', `${st.shown} tall ${st.tall}`)
  check(await c.ev(`!!document.querySelector('app-dock .deck-taskbar')`) && (await rectOf('app-dock .deck-taskbar'))[1] + (await rectOf('app-dock .deck-taskbar'))[3] <= 852, 'the taskbar stays on the screen')
  await shot('deck-folded-tall')
  await c.evBody(`__g.camera.fit()`); await settle(400)
  check((await state()).shown === 'tactics', 'and back at the fit the panel that was folded comes back')
  // a choice made while magnified is kept
  await c.evBody(`__g.camera.zoomTo(2)`); await settle(300)
  await tapAt(await tab(/Setas/))
  await c.evBody(`__g.camera.fit()`); await settle(300)
  check((await state()).shown === 'arrows', 'a panel chosen while magnified stays chosen at the fit', `${(await state()).shown}`)

  // a keycap of the deck still sends its key while the picture is magnified
  await c.evBody(`__g.camera.zoomTo(2)`); await settle(300)
  await tapAt(await tab(/Setas/))
  await c.ev(`(() => { window.__keys = []; if (!window.__keyHook) { window.__keyHook = true; const o = dosCI.sendKeyEvent.bind(dosCI); dosCI.sendKeyEvent = (k, d) => { window.__keys.push([k, d ? 1 : 0]); return o(k, d) } } return 1 })()`)
  const arrow = await c.ev(`(() => { const b = [...document.querySelectorAll('app-dock .deck-panel button')].find(x => x.getAttribute('aria-label') === 'Seta para baixo'); const r = b.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 } })()`)
  await tapAt(arrow)
  const sent = await c.ev(`JSON.stringify(window.__keys.splice(0))`)
  check(sent === '[[264,1],[264,0]]', 'the deck\'s Down arrow is one key down and one up while the picture is magnified', sent)
  await tapAt(await tab(/2x|Zoom/))
  await c.evBody(`__g.camera.fit()`); await settle(300)

  // The switch is in "Dados e avançado" (Recursos experimentais); the menu's Exibição section has the Zoom row while it is on.
  await s.openMenu()
  const zoomRow = await c.ev(`(() => { const r = [...document.querySelectorAll('app-options-menu ion-item.options-zoom')][0]; return r ? r.innerText.replace(/\\s+/g, ' ') : null })()`)
  check(!!zoomRow && /Ajustar/.test(zoomRow), 'with the camera on, the menu\'s Exibição section has the Zoom row (Ajustar, - and +), reachable with the key panel off', zoomRow ?? '')
  const plus = async () => {
    const at = await c.ev(`(() => { const r = document.querySelector('app-options-menu ion-item.options-zoom'); r?.scrollIntoView({ block: 'center' }); const b = [...(r?.querySelectorAll('ion-button') ?? [])].find(x => x.innerText.trim() === '+'); if (!b) return null; const q = b.getBoundingClientRect(); return JSON.stringify({ x: q.x + q.width / 2, y: q.y + q.height / 2 }) })()`)
    return at ? JSON.parse(at) : null
  }
  if (await plus()) {
    await sleep(300)
    const before = await state()
    const { x, y } = await plus()
    await c.tap(x, y, 60); await sleep(600)
    const after = await state()
    check(after.scale > before.scale, 'a real tap on "+" in the menu zooms in one rung and leaves the menu open', `${round(before.scale)} -> ${round(after.scale)}`)
    check(await c.ev(`!!document.querySelector('app-options-menu')`), 'the menu is still open after it')
  }
  await c.evBody(`__g.isPopoverOpen = false; __g.isSheetOpen = false`); await settle(500)
  await s.openAdvanced()
  const entry = await s.advancedSwitch('Zoom e movimento')
  check(entry.checked === true, 'with the toggle on', entry.text.slice(0, 160))
  await shot('menu-entry')
  await c.tap(entry.x, entry.y, 60); await sleep(600)
  check((await c.ev(`__g.cameraEnabled`)) === false && (await c.ev(`!![...document.querySelectorAll('app-dock .deck-taskbar .deck-tab')].find(x => /Zoom/.test(x.textContent))`)) === false, 'a real tap on the switch in "Dados e avançado" turns it off: the camera and the Zoom tab are gone')
  await s.closeAdvanced(); await settle(300)
  await c.evBody(`await __g.toggleCamera({ detail: { checked: true } })`); await settle(300)
  await c.evBody(`__g.camera.fit()`)
}

// ---------------------------------------------------------------------------------------------------------------- bar

if (mode === 'bar') {
  await emulate(393, 852)
  await cameraOn()
  // The OS keyboard, simulated as stage.mjs does (visualViewport shrunk, --kb-inset written): the type bar lifts itself by it.
  const keyboard = px => c.evBody(`
    if (!window.__vvPatched) { window.__vvPatched = true; window.__kb = 0; Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => window.innerHeight - window.__kb }) }
    window.__kb = ${px}; window.visualViewport.dispatchEvent(new Event('resize'))`)
  await c.evBody(`await __g.toggleLiveKeyboard({ detail: { checked: true } })`); await settle(400)
  await c.evBody(`__g.camera.zoomTo(3)`); await settle(400)
  const before = await state()
  const clipBefore = await rectOf('.game-stream-container')
  const pictureBefore = await rectOf('#game-container')
  const texto = await c.ev(`(() => { const b = [...document.querySelectorAll('app-dock .deck-taskbar .deck-tab')].find(x => /Texto/.test(x.textContent)); const r = b.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 } })()`)
  await c.tap(texto.x, texto.y, 70); await sleep(900)
  await keyboard(300); await settle(500)
  const open = await c.ev(`!!document.querySelector('.type-bar')`)
  check(open, 'the live type bar is open over the deck')
  const during = await state()
  check(during.scale === before.scale && during.x === before.x && during.y === before.y, 'it did not move the camera', `${round(before.x)},${round(before.y)} -> ${round(during.x)},${round(during.y)}`)
  const clipDuring = await rectOf('.game-stream-container')
  const pictureDuring = await rectOf('#game-container')
  check(clipDuring.every((v, i) => near(v, clipBefore[i], 0.01)) && pictureDuring.every((v, i) => near(v, pictureBefore[i], 0.01)), 'nor the clip or the picture', JSON.stringify([clipBefore, clipDuring].map(r => r.map(v => round(v)))))
  await shot('bar-open-zoomed')
  await keyboard(0); await settle(400)
  await c.evBody(`document.querySelector('app-type-bar') && ng.getComponent(document.querySelector('app-type-bar')).close()`); await settle(400)
  const after = await state()
  check(after.x === before.x && after.y === before.y, 'closing it puts nothing back either')
  await c.evBody(`await __g.toggleLiveKeyboard({ detail: { checked: false } })`)
  await c.evBody(`__g.camera.fit()`); await settle(300)
}

// ---------------------------------------------------------------------------------------------------------------- chat

if (mode === 'chat') {
  await emulate(393, 852)
  await cameraOn()
  if (!(await c.ev(`__g.isStreaming`))) {
    const result = await c.evBody(`__g.hostRoomId = 'ELI-CAMC'; __g.hostName = 'Anfitriao'; __g.hostMaxSpectators = 6; try { await __g.startHosting() } catch (e) { return 'ERR ' + e.message } return 'streaming=' + __g.isStreaming`)
    console.log('hosting:', result)
  }
  await sleep(1200)
  await c.ev(`(async () => { for (const toast of document.querySelectorAll('ion-toast')) await toast.dismiss(); return 1 })()`)
  await settle()

  // portrait: the chat is a panel in the band
  await c.evBody(`__g.camera.zoomTo(2)`); await settle(400)
  let st = await state()
  const tallClip = await rectOf('.game-stream-container')
  check(st.tall, 'hosting, zoomed, the band folded: the clip is tall', `${round(tallClip[3])}`)
  await c.evBody(`__g.toggleChat(true)`); await settle(600)
  st = await state()
  const chatClip = await rectOf('.game-stream-container')
  check(!st.tall && chatClip[3] < tallClip[3] && near(chatClip[3], 294.75, 1), 'the chat open gives the band to the chat: the clip is the 4:3 stage again', `${round(chatClip[3])}`)
  check((await state()).scale === 2, 'and the camera is still at 2x, clamped to the smaller view', `${round(st.x)},${round(st.y)}`)
  const picture = await rectOf('#game-container')
  check(picture[1] <= chatClip[1] + 0.5 && picture[1] + picture[3] >= chatClip[1] + chatClip[3] - 0.5, 'and the picture still covers the clip')
  await shot('chat-open-portrait-2x')
  await c.evBody(`__g.toggleChat(false)`); await settle(600)
  check((await state()).tall, 'closing the chat gives the tall view back')

  // landscape phone: the chat replaces the right rail, the stage narrows
  await emulate(844, 390, 47, 47, 21)
  await c.evBody(`__g.camera.fit(); __g.camera.zoomTo(1.5)`); await settle(400)
  const stage0 = await c.ev(`JSON.stringify(__g.stagePlan.stage)`)
  const clip0 = await rectOf('.game-stream-container')
  await c.evBody(`__g.toggleChat(true)`); await settle(900)
  const stage1 = await c.ev(`JSON.stringify(__g.stagePlan.stage)`)
  const clip1 = await rectOf('.game-stream-container')
  const pic1 = await rectOf('#game-container')
  check(stage1 !== stage0 && near(clip1[2], JSON.parse(stage1).width, 0.5), 'the chat docked narrows the stage (the documented input) and the clip follows it', `${stage0} -> ${stage1}`)
  const st1 = await state()
  check(st1.scale === 1.5 && pic1[0] <= clip1[0] + 0.5 && pic1[0] + pic1[2] >= clip1[0] + clip1[2] - 0.5 && pic1[1] <= clip1[1] + 0.5 && pic1[1] + pic1[3] >= clip1[1] + clip1[3] - 0.5, 'and the camera is re-clamped to it: still 1.5x, the picture covers the clip', `${round(st1.x)},${round(st1.y)}`)
  await shot('chat-open-landscape-1_5')
  await c.evBody(`__g.toggleChat(false)`); await settle(900)
  const clip2 = await rectOf('.game-stream-container')
  check(clip2.every((v, i) => near(v, clip0[i], 0.5)), 'closing it gives the clip its box back', JSON.stringify(clip2.map(v => round(v))))
  await c.evBody(`__g.camera.fit()`); await settle(300)
  await emulate(393, 852)
}

// ---------------------------------------------------------------------------------------------------------------- rotate

if (mode === 'rotate') {
  await emulate(393, 852)
  await cameraOn()
  await c.evBody(`__g.camera.zoomTo(2)`); await settle(400)
  const portrait = await state()
  await emulate(844, 390, 47, 47, 21)
  let st = await state()
  check(st.scale === 1 && st.tf === '', 'turned to landscape: that orientation has its own camera, which is the fit', `${st.scale}`)
  await c.evBody(`__g.camera.zoomTo(1.5)`); await settle(400)
  const landscape = await state()
  check(landscape.scale === 1.5, 'zoom in landscape')
  await shot('rotate-landscape-1_5')
  // the stage plan and the picture's box in landscape are what they were without the camera
  const plan = await c.ev(`JSON.stringify(__g.stagePlan.stage)`)
  await c.evBody(`__g.camera.fit()`); await settle(300)
  check(await c.ev(`JSON.stringify(__g.stagePlan.stage)`) === plan, 'and the plan did not move for it')
  await c.evBody(`__g.camera.zoomTo(1.5)`); await settle(300)
  await emulate(393, 852)
  st = await state()
  check(st.scale === 2 && near(st.x, portrait.x, 1.5) && near(st.y, portrait.y, 1.5), 'back to portrait: the camera that was left there is where it was', `${round(st.scale)}x at ${round(st.x)},${round(st.y)} (was ${round(portrait.x)},${round(portrait.y)})`)
  await emulate(844, 390, 47, 47, 21)
  st = await state()
  check(st.scale === 1.5, 'and landscape remembered its own', `${st.scale}`)
  // across a reload
  const stored = await c.ev(`JSON.stringify(await __g.storageService.get('cameraViews'))`)
  check(/portrait/.test(stored) && /landscape/.test(stored), 'both are in storage', stored)
  await emulate(393, 852)
  await c.evBody(`__g.camera.fit()`); await settle(300)
}

// ---------------------------------------------------------------------------------------------------------------- power

if (mode === 'power') {
  await emulate(393, 852)
  await cameraOn()
  // The saver needs a screen that does not move, and Acerca's credits scroll: from Acerca, OK leads to the (still) New / Continue dialog.
  const moving = () => c.evBody(`const a = await dosCI.screenshot(); await new Promise(r => setTimeout(r, 400)); const b = await dosCI.screenshot(); let n = 0; for (let i = 0; i < a.data.length; i += 4 * 97) if (a.data[i] !== b.data[i]) n++; return n > 0`)
  if (await moving()) { await s.tapC(215, -90, 2400); console.log('left Acerca for a still screen:', !(await moving())) }
  await c.evBody(`__g.power.retune({ idleMs: 1500, inputQuietMs: 1500 })`)
  await c.evBody(`await __g.toggleIdlePause({ detail: { checked: false } }); await __g.toggleIdlePause({ detail: { checked: true } })`)
  const power = () => c.ev(`JSON.stringify({ state: __g.power.state, stats: __g.power.stats })`).then(JSON.parse)
  const asleep = async () => { for (let i = 0; i < 30; i++) { await sleep(500); if ((await power()).state !== 'awake') return true } return false }
  const sleepOnce = async what => {
    const ok = await asleep()
    check(ok, `the saver put the guest to sleep (${what})`, JSON.stringify((await power()).state))
    return ok
  }
  if (await sleepOnce('before a pinch')) {
    const wakes = (await power()).stats.wakes
    await pinchOut([196, 330], 50, 120)
    const p = await power()
    check(p.state === 'awake' && p.stats.wakes > wakes, 'two fingers on the picture wake it', JSON.stringify(p.state))
  }
  if (await sleepOnce('before a button')) {
    const tabs = await c.ev(`(() => { const b = [...document.querySelectorAll('app-dock .deck-taskbar .deck-tab')].find(x => /Zoom|[0-9]x/.test(x.textContent)); const r = b.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 } })()`)
    await c.tap(tabs.x, tabs.y, 70); await sleep(500)
    await sleepOnce('before a camera button')
    const w1 = (await power()).stats.wakes
    await c.evBody(`__g.camera.zoomTo(1.5)`)
    const p = await power()
    check(p.state === 'awake' && p.stats.wakes > w1, 'a camera button wakes it (CameraOptions.activity)', JSON.stringify(p.state))
  }
  await c.evBody(`await __g.toggleIdlePause({ detail: { checked: false } }); __g.power.retune(__g.power.constructor.defaults())`)
  await c.evBody(`__g.camera.fit()`)
}

if (!['layout', 'identical', 'pinch', 'accuracy', 'radio', 'overlay', 'deck', 'bar', 'chat', 'rotate', 'power'].includes(mode)) {
  console.error(`unknown mode ${mode}`)
  process.exit(1)
}
// The page is left with the camera on and at the fit.
