#!/usr/bin/env node
/**
 * The options menu, "Dados e avançado", the first-run coach, the boot screen, the quick host and the spectator's waiting card (phase P13)
 * against the real page, with real taps.
 *
 *   node scripts/touch-harness/menu.mjs layout [sizes]   at eight windows (the phones, both tablets, a laptop with a MOUSE): the sheet where a finger is the pointer and the popover where it is not;
 *                                                       the picture's rectangle IDENTICAL with the menu closed and open; every row at least 44 px tall under a finger; the sheet inside the window and
 *                                                       its last row reachable once expanded; the "?" of each section is 44x44 under a finger
 *   node scripts/touch-harness/menu.mjs data            "Dados e avançado": the groups in order and the wipe alone in the last; the two save switches and the smoothing read the OLD stored keys (an
 *                                                       upgrade keeps its choice), flip them and store the OFF flag; the wipe up to its last question WITHOUT confirming it
 *   node scripts/touch-harness/menu.mjs wipe             the wipe all the way: "Baixar backup agora" leaves the question up, the box has to be ticked, and then the data is really gone after the reload (it wipes the profile: that is the point)
 *   node scripts/touch-harness/menu.mjs back             Back closes the coach, then the sheet, then "Dados e avançado", and only then asks about leaving: the address and history.length stay put;
 *                                                       and on ?host=1 it closes the room dialog that is up while the game boots (it used to leave the page and strand the dialog over the landing page)
 *   node scripts/touch-harness/menu.mjs coach [desktop]  the three cards (a finger's or a mouse's), "Saiba mais" opens the guide at the topic and brings the card back, "Entendi" stores the answer
 *   node scripts/touch-harness/menu.mjs boot             the boot screen with its stage text and steps, taking no room, and "Voltar ao menu" on it
 *   node scripts/touch-harness/menu.mjs host             ?host=1: the room dialog is up while the game boots (first time: the name only), the room goes on the air when the game is up, the coach does not follow;
 *                                                       a returning host sees who they are and a summary line; cancelling the dialog leaves an ordinary boot
 *   node scripts/touch-harness/menu.mjs join            a spectator's wait: a card with "Cancelar" and no loader, the hints at 8 s and 15 s, and "Cancelar" returns to the dialog with the code filled in
 *
 * Unlike the other scripts here it loads the page itself (a fresh profile each time, except where a mode says otherwise), because what it checks
 * starts at the boot. It needs a dev build (`window.ng`): APP=http://localhost:4291/ node scripts/touch-harness/menu.mjs layout
 */
import path from 'node:path'
import { connect, OUT, sleep } from './lib.mjs'

const [mode = 'layout', arg] = process.argv.slice(2)
const ORIGIN = process.env.APP || 'http://localhost:4200/'
const SHOTS = path.join(OUT, 'shots')
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-A075M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Mobile Safari/537.36'
const check = (ok, what, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? `  ${detail}` : ''}`); if (!ok) process.exitCode = 1 }

const c = await connect()
// The driver keeps every console line since it started: read past the ones earlier scripts left, so the final check is about THIS run.
await c.logs()
const shot = name => c.shot(path.join(SHOTS, `menu-${name}.png`))

/** A fresh load of the app at `hash` with a device emulated: a phone with a finger, or a laptop with a mouse. */
async function load({ width = 393, height = 852, touch = true, hash = '#/game', wipe = true } = {}) {
  await c.send('Page.navigate', { url: 'about:blank' })
  if (wipe) await c.send('Storage.clearDataForOrigin', { origin: new URL(ORIGIN).origin, storageTypes: 'all' })
  if (touch) await c.send('Emulation.setUserAgentOverride', { userAgent: ANDROID, platform: 'Linux armv8l' })
  else await c.send('Emulation.setUserAgentOverride', { userAgent: '' }).catch(() => undefined)
  await c.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: touch ? 2 : 1, mobile: touch })
  await c.send('Emulation.setTouchEmulationEnabled', touch ? { enabled: true, maxTouchPoints: 5 } : { enabled: false })
  await c.send('Page.navigate', { url: `${ORIGIN}${hash}` })
}
/** Resolves with the time the game page took to be up and shown (boot screen gone), or -1. */
async function waitGame(ms = 90000) {
  const began = Date.now()
  while (Date.now() - began < ms) {
    const up = await c.ev(`(() => { if (!window.ng) return false; const el = document.querySelector('app-game'); const g = el && ng.getComponent(el); return !!(g && g.dosCI && !g.isHidden && !g.booting) })()`).catch(() => false)
    if (up) { await c.ev(`(window.__g = ng.getComponent(document.querySelector('app-game'))) && 1`); return Date.now() - began }
    await sleep(400)
  }
  return -1
}
/** Pular on the coach and the one-time toast that covers the toolbar, as a person would. */
async function clear() {
  await sleep(900)
  await c.ev(`(() => { const b = [...document.querySelectorAll('app-first-run-coach .coach-actions button')].find(x => /Pular/.test(x.textContent)); b && b.click(); return 1 })()`)
  await sleep(700)
  await c.ev(`(async () => { for (const t of document.querySelectorAll('ion-toast')) await t.dismiss(); return 1 })()`)
  await sleep(500)
}
const centre = (css, text) => c.ev(`(() => { const re = ${text ? JSON.stringify(text) : 'null'}; const e = [...document.querySelectorAll(${JSON.stringify(css)})].filter(e => (!re || new RegExp(re, 'i').test(e.innerText || e.textContent || '')) && e.getClientRects().length)[0]; if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }) })()`).then(v => v && JSON.parse(v))
async function press(css, text, wait = 700) {
  await centre(css, text)
  await sleep(250)
  const at = await centre(css, text)
  if (!at) throw new Error(`nothing to press: ${css} ${text ?? ''}`)
  await c.tap(at.x, at.y, 60)
  await sleep(wait)
  return at
}
const rectOf = css => c.ev(`(() => { const e = document.querySelector(${JSON.stringify(css)}); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(v => Math.round(v * 100) / 100).join(',') })()`)
const openMenuButton = () => centre('ion-header ion-buttons[slot="end"] > ion-button').then(at => at ?? centre('.rail-menu-btn'))
const expand = async () => { await c.ev(`document.querySelector('ion-modal.menu-sheet')?.setCurrentBreakpoint?.(1)`); await sleep(600) }
const stored = key => c.ev(`__g.storageService.get(${JSON.stringify(key)})`)
const text = css => c.ev(`document.querySelector(${JSON.stringify(css)})?.innerText.replace(/\\n+/g, ' | ') ?? null`)

// ------------------------------------------------------------------------------------------------------------------ layout

async function modeLayout() {
  const table = arg
    ? arg.split(',').map(s => { const [w, h, t] = s.split('x'); return { w: +w, h: +h, touch: t !== 'mouse' } })
    : [
      { w: 393, h: 852, touch: true }, { w: 360, h: 640, touch: true }, { w: 430, h: 932, touch: true }, { w: 844, h: 390, touch: true },
      { w: 932, h: 430, touch: true }, { w: 820, h: 1180, touch: true }, { w: 1180, h: 820, touch: true }, { w: 1280, h: 800, touch: false },
    ]
  for (const { w, h, touch } of table) {
    const label = `${w}x${h}${touch ? '' : ' mouse'}`
    await load({ width: w, height: h, touch })
    if ((await waitGame()) < 0) { check(false, `${label}: the game came up`); continue }
    await clear()
    const closed = await rectOf('#game-container')
    const button = await openMenuButton()
    if (touch) await c.tap(button.x, button.y, 60)
    else { await c.mouse('mouseMoved', button.x, button.y); await c.mouse('mousePressed', button.x, button.y, { button: 'left', clickCount: 1 }); await c.mouse('mouseReleased', button.x, button.y, { button: 'left', clickCount: 1 }) }
    await sleep(1400)
    const kind = await c.ev(`document.querySelector('ion-modal.menu-sheet.show-modal') ? 'sheet' : (document.querySelector('ion-popover.menu-popover app-options-menu') ? 'popover' : 'none')`)
    check(kind === (touch ? 'sheet' : 'popover'), `${label}: ${touch ? 'a finger gets the sheet' : 'a mouse gets the popover'}`, kind)
    check((await rectOf('#game-container')) === closed, `${label}: the picture's rectangle is identical with the menu open`, closed)
    await shot(`layout-${w}x${h}${touch ? '' : '-mouse'}`)
    const sections = await c.ev(`[...document.querySelectorAll('app-options-menu ion-list-header')].map(h => h.innerText.trim().split('\\n')[0]).join(',')`)
    check(sections === 'Jogo,Multiplayer,Entrada,Exibição,Ajuda', `${label}: five sections in order`, sections)
    if (touch) {
      await expand()
      const rows = await c.ev(`JSON.stringify([...document.querySelectorAll('app-options-menu ion-item')].map(i => Math.round(i.getBoundingClientRect().height)))`).then(JSON.parse)
      check(rows.every(height => height >= 44), `${label}: every row is at least 44 px tall`, `min ${Math.min(...rows)}`)
      const helpKeys = await c.ev(`JSON.stringify([...document.querySelectorAll('app-options-menu .options-help')].map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)] }))`).then(JSON.parse)
      check(helpKeys.length === 4 && helpKeys.every(([hw, hh]) => hw >= 44 && hh >= 44), `${label}: the "?" of each section is 44x44`, JSON.stringify(helpKeys))
      const sheet = await c.ev(`JSON.stringify(document.querySelector('ion-modal.menu-sheet').shadowRoot.querySelector('.modal-wrapper').getBoundingClientRect())`).then(JSON.parse)
      check(sheet.left >= -1 && sheet.right <= w + 1 && sheet.bottom <= h + 1, `${label}: the sheet is inside the window`, `${Math.round(sheet.left)}..${Math.round(sheet.right)} x ${Math.round(sheet.top)}..${Math.round(sheet.bottom)}`)
      const last = await c.ev(`(async () => { const content = document.querySelector('ion-modal.menu-sheet ion-content'); const scroller = await content.getScrollElement(); scroller.scrollTop = scroller.scrollHeight; await new Promise(r => setTimeout(r, 300)); const item = [...document.querySelectorAll('app-options-menu ion-item')].pop(); const r = item.getBoundingClientRect(); const view = content.getBoundingClientRect(); return JSON.stringify({ text: item.innerText.trim(), inside: r.bottom <= view.bottom + 1 && r.top >= view.top - 1 }) })()`).then(JSON.parse)
      check(last.inside && /Sobre/.test(last.text), `${label}: the last row ("${last.text}") is reachable by scrolling`)
      await press('ion-modal.menu-sheet ion-header ion-button', null, 1200)
      check(!(await c.ev(`!!document.querySelector('ion-modal.menu-sheet.show-modal')`)), `${label}: the X closes the sheet`)
    }
    check((await rectOf('#game-container')) === closed, `${label}: and the picture's rectangle is the same afterwards`)
    await c.logs()
  }
}

// ------------------------------------------------------------------------------------------------------------------ data

async function modeData() {
  await load({ width: 393, height: 852 })
  check((await waitGame()) >= 0, 'the game came up')
  // What an upgrading player has: both old switches ticked ("Desativar Suavização" and "Desativar Sync Save"), and the old welcome answered.
  await c.ev(`(async () => { await __g.storageService.set('disableSmoothFilter', true); await __g.storageService.set('disableAutoSave', true); await __g.storageService.set('hideTutorial', true); return 1 })()`)
  await load({ width: 393, height: 852, wipe: false })
  check((await waitGame()) >= 0, 'and again after a reload, on the same profile')
  await sleep(1200)
  check(await c.ev(`!document.querySelector('app-first-run-coach')`), 'the coach does not greet a player who answered the old welcome')
  const state = await c.ev(`JSON.stringify({ smoothing: __g.smoothing, autoSaveOnGame: __g.autoSaveOnGame, canvasSmooth: document.querySelector('.emulator-canvas').classList.contains('smooth-canvas'), saver: __g.autoSaverService.running })`).then(JSON.parse)
  check(!state.smoothing && !state.autoSaveOnGame && !state.canvasSmooth && !state.saver, 'the old stored OFF flags read as "Suavizar a imagem" and "Salvar ao gravar o jogo" both off: an upgrade keeps its choice', JSON.stringify(state))
  await clear()
  const button = await openMenuButton(); await c.tap(button.x, button.y, 60); await sleep(1300); await expand()
  const smoothing = () => c.ev(`[...document.querySelectorAll('app-options-menu ion-item')].find(i => /Suavizar a imagem/.test(i.innerText)).querySelector('ion-toggle').checked`)
  check((await smoothing()) === false, 'the row says off')
  await press('app-options-menu ion-item', 'Suavizar a imagem', 800)
  check((await smoothing()) === true && (await stored('disableSmoothFilter')) === false && await c.ev(`document.querySelector('.emulator-canvas').classList.contains('smooth-canvas')`), 'a real tap turns it on: the canvas smooths and the OFF flag is stored false')
  await press('app-options-menu ion-item', 'Suavizar a imagem', 800)
  check((await smoothing()) === false && (await stored('disableSmoothFilter')) === true, 'and off again: the flag is back to true')
  check(await c.ev(`document.querySelector('ion-modal.menu-sheet.show-modal') != null`), 'a switch leaves the sheet open')

  await press('app-options-menu ion-item', 'Dados e avançado', 1600)
  check(await c.ev(`!!document.querySelector('app-advanced-modal')`) && !(await c.ev(`!!document.querySelector('ion-modal.menu-sheet.show-modal')`)), '"Dados e avançado" opens, and the sheet is gone')
  await shot('data-top')
  const groups = await c.ev(`[...document.querySelectorAll('app-advanced-modal .win9x-legend')].map(l => l.innerText.replace(/\\s*\\?\\s*$/, '').trim()).join(',')`)
  check(groups === 'Backup,Salvamento automático,Patches,Ferramentas,Recursos experimentais,Zona de perigo', 'six groups, from the safe to the dangerous', groups)
  const dangerous = await c.ev(`JSON.stringify([...document.querySelectorAll('app-advanced-modal .win9x-action--danger')].map(b => b.innerText))`).then(JSON.parse)
  const last = await c.ev(`document.querySelector('app-advanced-modal fieldset:last-of-type').classList.contains('win9x-group--danger')`)
  check(dangerous.length === 1 && last && /Apagar todos os dados/.test(dangerous[0]), 'the wipe is the only danger in the window, alone in the last box', JSON.stringify(dangerous))
  const heights = await c.ev(`JSON.stringify([...document.querySelectorAll('app-advanced-modal .win9x-action, app-advanced-modal .win9x-switch')].map(e => Math.round(e.getBoundingClientRect().height)))`).then(JSON.parse)
  check(heights.every(h => h >= 44), 'every button and switch row is at least 44 px tall', `min ${Math.min(...heights)}`)
  const gameSave = () => c.ev(`[...document.querySelectorAll('app-advanced-modal label.win9x-switch')].find(l => l.innerText.includes('Salvar ao gravar o jogo')).querySelector('input').checked`)
  check((await gameSave()) === false, '"Salvar ao gravar o jogo" shows the old flag as off')
  await press('app-advanced-modal label.win9x-switch', 'Salvar ao gravar o jogo', 800)
  check((await gameSave()) === true && (await stored('disableAutoSave')) === false && await c.ev('__g.autoSaverService.running'), 'a real tap turns it on: the auto-saver starts and the OFF flag is stored false')
  await press('app-advanced-modal label.win9x-switch', 'Salvar a cada 5 min', 800)
  check((await stored('autoSave')) === true && await c.ev('__g.periodicSave'), '"Salvar a cada 5 min" stores autoSave true (that key was never inverted)')
  await press('app-advanced-modal label.win9x-switch', 'Salvar a cada 5 min', 600)

  // The wipe, up to its last question, without confirming it.
  await press('app-advanced-modal button', 'Apagar todos os dados', 1000)
  const first = await c.ev(`JSON.stringify({ header: document.querySelector('ion-alert .alert-title')?.textContent, cls: document.querySelector('ion-alert').className, buttons: [...document.querySelectorAll('ion-alert .alert-button')].map(b => b.innerText.trim()) })`).then(JSON.parse)
  check(/win9x-alert/.test(first.cls) && first.header === 'Antes de apagar' && first.buttons.join() === 'Cancelar,Baixar backup agora,Continuar', 'step one is a win9x alert that offers the backup before it lets you go on', JSON.stringify(first.buttons))
  await shot('wipe-1')
  await press('ion-alert .alert-button', '^Continuar', 900)
  const second = await c.ev(`JSON.stringify({ header: document.querySelector('ion-alert .alert-title')?.textContent, checkbox: document.querySelector('ion-alert .alert-checkbox-label')?.textContent.trim(), danger: !!document.querySelector('ion-alert .alert-button.alert-danger'), box: document.querySelector('ion-alert [aria-checked]')?.getAttribute('aria-checked') })`).then(JSON.parse)
  check(second.header === 'Apagar tudo?' && second.danger && second.box === 'false' && /Entendo que vou perder/.test(second.checkbox), 'step two has an alert-danger button and an unchecked box', JSON.stringify(second))
  await press('ion-alert .alert-button', '^Apagar tudo', 700)
  const still = await c.ev(`JSON.stringify({ open: !!document.querySelector('ion-alert'), message: document.querySelector('ion-alert .alert-message')?.innerText.trim(), dbs: (await indexedDB.databases()).map(d => d.name) })`).then(JSON.parse)
  check(still.open && /Marque a caixa/.test(still.message) && still.dbs.some(n => /js-dos-cache/.test(n)), 'pressing it with the box empty does nothing but say so: nothing was wiped', JSON.stringify(still))
  await shot('wipe-2')
  await press('ion-alert .alert-button', '^Cancelar', 700)
  check(await c.ev(`!document.querySelector('ion-alert')`) && await c.ev(`!!document.querySelector('app-advanced-modal')`), 'Cancelar closes the question and leaves the window')
}

// ------------------------------------------------------------------------------------------------------------------ wipe

async function modeWipe() {
  await load({ width: 393, height: 852 })
  check((await waitGame()) >= 0, 'the game came up')
  await clear()
  check((await stored('hideTutorial')) === true, 'the coach was answered, so there is something for the wipe to take away')
  const button = await openMenuButton(); await c.tap(button.x, button.y, 60); await sleep(1300); await expand()
  await press('app-options-menu ion-item', 'Dados e avançado', 1600)
  await press('app-advanced-modal button', 'Apagar todos os dados', 1000)
  // "Baixar backup agora" is one thing done on the way: it leaves the question up (this profile has no saves, so it says so on top).
  await press('ion-alert .alert-button', 'Baixar backup agora', 1500)
  const alerts = await c.ev(`JSON.stringify([...document.querySelectorAll('ion-alert')].map(a => a.querySelector('.alert-title')?.textContent))`).then(JSON.parse)
  check(alerts[0] === 'Antes de apagar' && alerts.length >= 1, 'the backup button leaves the first question up', JSON.stringify(alerts))
  await c.ev(`(async () => { for (const a of [...document.querySelectorAll('ion-alert')].slice(1)) await a.dismiss(); return 1 })()`); await sleep(800)
  await press('ion-alert .alert-button', '^Continuar', 900)
  await press('ion-alert [role="checkbox"], ion-alert .alert-checkbox-button', null, 400)
  check(await c.ev(`document.querySelector('ion-alert [aria-checked]')?.getAttribute('aria-checked')`) === 'true', 'the box is ticked')
  await shot('wipe-3')
  await press('ion-alert .alert-button', '^Apagar tudo', 100)
  // The page reloads itself: wait for the game to come back up on a clean profile.
  await sleep(2500)
  check((await waitGame(90000)) >= 0, 'the page reloaded and the game came back')
  await sleep(1500)
  const after = await c.ev(`JSON.stringify({ coach: !!document.querySelector('app-first-run-coach'), hide: await __g.storageService.get('hideTutorial'), fail: await __g.storageService.get('failCount') })`).then(JSON.parse)
  check(after.coach && after.hide == null, 'the data is gone: the coach greets a new player again', JSON.stringify(after))
}

// ------------------------------------------------------------------------------------------------------------------ back

async function modeBack() {
  // The router keeps the history pointer only for navigations it made itself: arrive through the landing page's own link.
  await load({ hash: '#/main' })
  await sleep(2500)
  await press('ion-card.home-main-card', null, 300)
  check((await waitGame()) >= 0, 'the game came up through the landing page')
  const snapshot = () => c.ev(`JSON.stringify({ hash: location.hash, len: history.length, sheet: !!document.querySelector('ion-modal.menu-sheet.show-modal'), advanced: !!document.querySelector('app-advanced-modal'), coach: !!document.querySelector('app-first-run-coach'), alerts: [...document.querySelectorAll('ion-alert')].map(a => a.querySelector('.alert-title')?.textContent) })`).then(JSON.parse)
  const back = async () => { await c.ev('history.back()'); await sleep(1500); return snapshot() }
  await sleep(800)
  const start = await snapshot()
  check(start.coach, 'the coach is up on a fresh profile')
  let s = await back()
  check(!s.coach && s.hash === '#/game' && s.len === start.len && s.alerts.length === 0, 'Back closes the coach and stays on the game', JSON.stringify(s))
  check((await stored('hideTutorial')) === true, 'and that answers it for good')
  await c.ev(`(async () => { for (const t of document.querySelectorAll('ion-toast')) await t.dismiss(); return 1 })()`); await sleep(400)
  const button = await openMenuButton(); await c.tap(button.x, button.y, 60); await sleep(1300)
  check((await snapshot()).sheet, 'the sheet is open')
  s = await back()
  check(!s.sheet && s.hash === '#/game' && s.len === start.len && s.alerts.length === 0, 'Back closes the sheet, with no leave dialog', JSON.stringify(s))
  await c.tap(button.x, button.y, 60); await sleep(1300); await expand()
  await press('app-options-menu ion-item', 'Dados e avançado', 1500)
  check((await snapshot()).advanced, '"Dados e avançado" is open')
  s = await back()
  check(!s.advanced && s.hash === '#/game' && s.len === start.len && s.alerts.length === 0, 'Back closes it as well', JSON.stringify(s))
  s = await back()
  check(s.alerts.join() === 'Voltar ao menu?' && s.hash === '#/game' && s.len === start.len, 'with nothing open, Back asks about leaving, once', JSON.stringify(s))
  s = await back()
  check(s.alerts.length === 1 && s.len === start.len, 'a second Back with the question open does not stack another', JSON.stringify(s))

  // ?host=1 has the room dialog up while the emulator is still starting: there is no emulator to lose, but there is a window to close. A Back
  // that left the page here stranded the dialog over the landing page (it had nothing to start there).
  await load({ hash: '#/main' })
  await sleep(2500)
  await press('ion-button.host-action', null, 300)
  let dialog = false
  for (let i = 0; i < 40 && !dialog; i++) { await sleep(250); dialog = await c.ev(`!!document.querySelector('app-room-setup-modal')`) }
  check(dialog, '?host=1: the room dialog is up while the game boots')
  const during = await c.ev(`JSON.stringify({ hash: location.hash, booting: ng.getComponent(document.querySelector('app-game')).booting })`).then(JSON.parse)
  check(during.booting && during.hash === '#/game', 'and the emulator is still starting', JSON.stringify(during))
  await c.ev('history.back()'); await sleep(1500)
  s = await c.ev(`JSON.stringify({ hash: location.hash, dialog: !!document.querySelector('app-room-setup-modal'), booting: ng.getComponent(document.querySelector('app-game'))?.booting })`).then(JSON.parse)
  check(!s.dialog && s.hash === '#/game' && s.booting, 'Back closes the dialog and the game goes on booting: it is not left over the landing page', JSON.stringify(s))
  check((await waitGame()) >= 0, 'and the game comes up as an ordinary visit')
}

// ------------------------------------------------------------------------------------------------------------------ coach

async function modeCoach() {
  const desktop = arg === 'desktop'
  await load(desktop ? { width: 1280, height: 800, touch: false } : { width: 393, height: 852 })
  check((await waitGame()) >= 0, 'the game came up')
  await sleep(1200)
  const title = () => c.ev(`document.querySelector('app-first-run-coach .coach-title')?.textContent`)
  const actions = () => c.ev(`JSON.stringify([...document.querySelectorAll('app-first-run-coach .coach-actions button')].filter(b => b.getClientRects().length).map(b => b.innerText.trim()))`).then(JSON.parse)
  check(await c.ev(`!document.querySelector('ion-alert')`), 'the 643-character welcome alert is gone')
  check((await title()) === (desktop ? 'Clique para jogar' : 'Toque para clicar'), 'card one speaks to this device', await title())
  check((await actions()).join() === 'Pular,Voltar,Próximo', 'Pular, Voltar and Próximo are on screen', (await actions()).join())
  const fits = await c.ev(`JSON.stringify((() => { const w = document.querySelector('app-first-run-coach').getBoundingClientRect(); return [w.top >= 0, w.bottom <= innerHeight] })())`).then(JSON.parse)
  check(fits[0] && fits[1], 'the dialog is inside the window')
  await shot(`coach-${desktop ? 'desktop' : 'phone'}-1`)
  await press('app-first-run-coach .coach-actions button', '^Próximo', 500)
  await shot(`coach-${desktop ? 'desktop' : 'phone'}-2`)
  check((await title()) === (desktop ? 'Escreva com acentos pelo menu' : 'Digite pela aba Texto'), 'card two is about typing', await title())
  await press('app-first-run-coach .coach-actions button', '^Próximo', 500)
  check((await title()) === 'Salve e faça backup' && (await actions()).join() === 'Voltar,Entendi', 'card three is about saving and backing up, and its button is "Entendi"', (await actions()).join())
  await shot(`coach-${desktop ? 'desktop' : 'phone'}-3`)
  await press('app-first-run-coach .coach-more', null, 1800)
  const guide = await c.ev(`JSON.stringify({ guide: !!document.querySelector('app-user-guide'), coach: !!document.querySelector('app-first-run-coach'), open: [...document.querySelectorAll('app-user-guide ion-accordion')].filter(a => a.classList.contains('accordion-expanded')).map(a => a.id), segment: document.querySelector('app-user-guide ion-segment')?.value })`).then(JSON.parse)
  check(guide.guide && guide.coach && guide.segment === 'faq' && guide.open.includes('guide-faq-save-info'), '"Saiba mais" opens the guide over the coach at the FAQ entry about saving', JSON.stringify(guide))
  await shot(`coach-${desktop ? 'desktop' : 'phone'}-guide`)
  await press('app-user-guide ion-header ion-button', null, 1000)
  check((await title()) === 'Salve e faça backup', 'closing the guide brings the card back')
  // A "?" that points into the MANUAL, opened twice in one page load: ion-segment-view pans once, while the window is still display:none (width 0), so from the
  // second open on the Manual button used to be lit over the FAQ's text until a timer happened to rescue it.
  for (const n of [1, 2]) {
    await c.ev(`void __g.openGuide('menu-game')`)
    await sleep(2000)
    const manual = await c.ev(`JSON.stringify((() => { const view = document.querySelector('app-user-guide ion-segment-view'); const a = document.getElementById('guide-manual-menu-game'); const r = a && a.getBoundingClientRect(); return { segment: document.querySelector('app-user-guide ion-segment')?.value, panned: Math.round(view.scrollLeft), width: view.offsetWidth, open: !!a && a.classList.contains('accordion-expanded'), inView: !!r && r.top >= 0 && r.top < innerHeight } })())`).then(JSON.parse)
    check(manual.segment === 'manual' && manual.panned === manual.width && manual.width > 0 && manual.open && manual.inView, `a "?" into the manual shows the manual's text, at its accordion (open ${n} of 2)`, JSON.stringify(manual))
    if (n === 1) await shot(`coach-${desktop ? 'desktop' : 'phone'}-manual`)
    await press('app-user-guide ion-header ion-button', null, 1000)
  }
  check((await stored('hideTutorial')) !== true, 'nothing is stored until the coach is answered')
  await press('app-first-run-coach .coach-actions button', '^Entendi', 800)
  check((await stored('hideTutorial')) === true && await c.ev(`!document.querySelector('app-first-run-coach')`), '"Entendi" stores the answer (the old flag) and closes it')
  // reachable again from the menu
  await c.ev(`(async () => { for (const t of document.querySelectorAll('ion-toast')) await t.dismiss(); return 1 })()`); await sleep(400)
  const button = await openMenuButton()
  if (desktop) { await c.mouse('mouseMoved', button.x, button.y); await c.mouse('mousePressed', button.x, button.y, { button: 'left', clickCount: 1 }); await c.mouse('mouseReleased', button.x, button.y, { button: 'left', clickCount: 1 }); await sleep(1000) }
  else { await c.tap(button.x, button.y, 60); await sleep(1300); await expand() }
  await centre('app-options-menu ion-item', 'Primeiros passos'); await sleep(300)
  const at = await centre('app-options-menu ion-item', 'Primeiros passos')
  if (desktop) { await c.mouse('mouseMoved', at.x, at.y); await c.mouse('mousePressed', at.x, at.y, { button: 'left', clickCount: 1 }); await c.mouse('mouseReleased', at.x, at.y, { button: 'left', clickCount: 1 }) } else await c.tap(at.x, at.y, 60)
  await sleep(1200)
  check(await c.ev(`!!document.querySelector('app-first-run-coach')`), '"Primeiros passos" in the menu brings it back')
}

// ------------------------------------------------------------------------------------------------------------------ boot

async function modeBoot() {
  await load({ width: 393, height: 852 })
  await sleep(500)
  const seen = []
  const began = Date.now()
  const before = await rectOf('#game-container')
  let during = null
  while (Date.now() - began < 20000) {
    const view = await c.ev(`(() => { const b = document.querySelector('app-boot-screen'); if (!b) return null; return JSON.stringify({ message: b.querySelector('.boot-message').textContent.trim(), steps: [...b.querySelectorAll('.boot-step')].map(s => s.dataset.state[0]).join(''), moving: b.querySelector('.boot-bar').classList.contains('boot-bar--moving'), rect: JSON.stringify(b.querySelector('.boot-screen').getBoundingClientRect()) }) })()`).then(v => v && JSON.parse(v)).catch(() => null)
    if (!view) { if (seen.length) break; await sleep(50); continue }
    if (!seen.length || seen[seen.length - 1].message !== view.message) { seen.push(view); if (seen.length === 1) { await shot('boot-first'); during = await rectOf('#game-container') } }
    await sleep(100)
  }
  console.log('stages seen:', seen.map(v => `${v.message} [${v.steps}${v.moving ? ' moving' : ''}]`).join('  ->  '))
  check(seen.length > 0, 'the boot screen was up while the game started')
  check(seen.some(v => /DOS|Windows|Elifoot|Baixando|Descompactando/.test(v.message)), 'it says where the boot is, in Portuguese', seen[0]?.message)
  check(seen.every(v => /^[dat]{4}$/.test(v.steps)), 'its four steps are always marked done, active or todo')
  const fixed = JSON.parse(seen[0].rect)
  check(fixed.width >= 393 && fixed.height >= 852, 'it covers the window', `${fixed.width}x${fixed.height}`)
  // The container has no box until the game is up (no `.full` while `isHidden`): the same as behind the ion-loading this replaced.
  check(during === before, 'the boot screen takes no room: the picture\'s container is as it was before the boot began', `${before}`)
  check((await waitGame()) >= 0 && await c.ev(`!document.querySelector('app-boot-screen')`), 'and it is gone once the game is up')
  await clear()
  // Voltar ao menu: from a second boot
  await load({ width: 393, height: 852 })
  await sleep(700)
  await press('app-boot-screen .boot-leave', null, 2500)
  check((await c.ev('location.hash')) === '#/main', '"Voltar ao menu" on the boot screen goes to the landing page', await c.ev('location.hash'))
}

// ------------------------------------------------------------------------------------------------------------------ host

async function modeHost() {
  await load({ hash: '#/game?host=1' })
  await sleep(1500)
  const dialog = await text('app-room-setup-modal')
  check(!!dialog && /Criar Sala Multiplayer/.test(dialog), 'the room dialog is up while the game boots', dialog?.slice(0, 120))
  check(await c.ev(`!!document.querySelector('app-boot-screen')`), 'and the boot screen is behind it')
  check(!/Código da sala|Cor do seu cursor/.test(dialog ?? ''), 'a first-time host sees the name and the summary only, not the whole form')
  check(/ELI-[A-Z0-9]{4} · sem senha · até 6 espectadores/.test(dialog ?? ''), 'with a line that says what Transmitir agora will do')
  check((await c.ev('location.search + location.hash')).indexOf('host=1') < 0, '?host=1 is off the address')
  await shot('host-1')
  await c.ev(`document.querySelector('app-room-setup-modal input[name=playerName]').focus()`)
  await c.send('Input.insertText', { text: 'Leu' })
  await sleep(300)
  await press('app-room-setup-modal .win9x-expander', null, 500)
  const full = await text('app-room-setup-modal')
  check(/Código da sala/.test(full) && /Limite de espectadores/.test(full) && /Cor do seu cursor/.test(full), '"Alterar" opens the whole form')
  await shot('host-2')
  await press('app-room-setup-modal button[type=submit]', null, 800)
  check(await c.ev(`!document.querySelector('app-room-setup-modal')`), 'Transmitir agora closes the dialog')
  const waiting = await text('app-boot-screen')
  if (waiting) check(/Sua sala entra no ar assim que o jogo carregar/.test(waiting), 'the boot screen says the room is waiting for the game')
  check((await waitGame(60000)) >= 0, 'the game came up')
  await sleep(2500)
  const on = await c.ev(`JSON.stringify({ streaming: __g.isStreaming, room: __g.hostRoomId, coach: !!document.querySelector('app-first-run-coach') })`).then(JSON.parse)
  check(on.streaming && /^ELI-/.test(on.room), 'the room went on the air once the game was up, with no reload', JSON.stringify(on))
  check(!on.coach, 'and the first-run coach did not follow it')
  // A returning host
  await load({ hash: '#/game?host=1', wipe: false })
  await sleep(1500)
  const again = await text('app-room-setup-modal')
  check(/Você aparece como Leu/.test(again ?? '') && /até 6 espectadores/.test(again ?? ''), 'a returning host sees who they are and the summary', again?.slice(0, 120))
  await shot('host-3')
  await press('app-room-setup-modal button', '^Cancelar', 500)
  check((await waitGame(60000)) >= 0, 'cancelling the dialog leaves an ordinary boot')
  await sleep(1200)
  const plain = await c.ev(`JSON.stringify({ streaming: __g.isStreaming, coach: !!document.querySelector('app-first-run-coach') })`).then(JSON.parse)
  check(!plain.streaming && plain.coach, 'no room, and the coach (not answered yet) is shown', JSON.stringify(plain))
}

// ------------------------------------------------------------------------------------------------------------------ join

async function modeJoin() {
  await load({ hash: '#/join-game?room=ELI-ZZZZ' })
  await sleep(2500)
  check(/Entrar em Sala Multiplayer/.test((await text('app-room-setup-modal')) ?? ''), 'a share link opens the dialog with the code in it')
  await c.ev(`document.querySelector('app-room-setup-modal input[name=playerName]').focus()`)
  await c.send('Input.insertText', { text: 'Visitante' })
  await sleep(300)
  await press('app-room-setup-modal button[type=submit]', null, 1500)
  const card = () => text('ion-card')
  check(!(await c.ev(`!!document.querySelector('ion-loading')`)), 'no ion-loading covers the page while it waits')
  check(/Cancelar/i.test((await card()) ?? ''), 'the waiting card has "Cancelar"', await card())
  const cancel = await centre('ion-card ion-button', 'Cancelar')
  check(cancel && cancel.h >= 44, 'and it is a finger-sized target: the way out of a bad wait', cancel && `${Math.round(cancel.w)}x${Math.round(cancel.h)}`)
  await shot('join-1')
  await sleep(8000)
  check(/Redes móveis podem demorar/.test((await card()) ?? ''), 'at 8 s it admits that mobile networks may be slow', await card())
  await shot('join-2')
  await sleep(6500)
  check(/cancelar/i.test((await card()) ?? '') && /Ainda tentando/.test((await card()) ?? ''), 'at 15 s it points at Cancelar', await card())
  await press('ion-card ion-button', 'Cancelar', 3000)
  check((await c.ev('location.hash')) === '#/join-game?room=ELI-ZZZZ', 'Cancelar starts again from a fresh page with the code on the address', await c.ev('location.hash'))
  check(/Entrar em Sala Multiplayer/.test((await text('app-room-setup-modal')) ?? ''), 'and the dialog is back, filled in')
}

const modes = { layout: modeLayout, data: modeData, wipe: modeWipe, back: modeBack, coach: modeCoach, boot: modeBoot, host: modeHost, join: modeJoin }
if (!modes[mode]) { console.error(`unknown mode ${mode}: ${Object.keys(modes).join(' | ')}`); process.exit(2) }
await modes[mode]()
const errors = (await c.logs()).filter(line => /^\[EXC\]|NG0\d+/.test(line))
check(errors.length === 0, 'no exception and no Angular error in the console', errors.slice(0, 3).join(' / '))
