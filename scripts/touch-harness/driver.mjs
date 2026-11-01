#!/usr/bin/env node
/**
 * Owns one headless Chrome over --remote-debugging-pipe and exposes it on a local HTTP port, so the
 * other scripts here can drive it with plain `fetch`. A pipe instead of --remote-debugging-port
 * because the sandbox this harness was written in lets node bind sockets but not Chrome, and a
 * pipe works everywhere the port does.
 *
 *   node scripts/touch-harness/driver.mjs [profileDir] [port] [width] [height]
 *   CHROME_BIN=/path/to/chrome node scripts/touch-harness/driver.mjs
 *   CHROME_FLAGS='--disable-features=WebRtcHideLocalIpsWithMdns' node scripts/touch-harness/driver.mjs   extra switches (a second browser for a room)
 *
 *   GET  /session            the CDP session id of the one tab
 *   POST /send               {method, params, sessionId?} -> the raw CDP response
 *   GET  /events?since=N     console and exception events collected so far
 *   GET  /quit               close Chrome and exit
 *
 * Only `chrome-headless-shell` (what puppeteer downloads) has been exercised. A full Chrome should
 * work too (the driver adds --headless=new for anything that is not the shell), but was not run.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const CANDIDATES = [
  process.env.CHROME_BIN,
  ...fs.existsSync(path.join(os.homedir(), '.cache/puppeteer/chrome-headless-shell'))
    ? fs.readdirSync(path.join(os.homedir(), '.cache/puppeteer/chrome-headless-shell')).map(version => {
      const dir = path.join(os.homedir(), '.cache/puppeteer/chrome-headless-shell', version)
      return fs.readdirSync(dir).map(platform => path.join(dir, platform, 'chrome-headless-shell'))[0]
    })
    : [],
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].filter(Boolean)
const chromePath = CANDIDATES.find(candidate => fs.existsSync(candidate))
if (!chromePath) {
  console.error('No Chrome found. Set CHROME_BIN, or `npx puppeteer browsers install chrome-headless-shell`.')
  process.exit(1)
}

const [profileArg, portArg = '9444', widthArg = '390', heightArg = '844'] = process.argv.slice(2)
const profile = profileArg ?? path.join(os.tmpdir(), 'elifoot-touch-harness', 'profile')
const port = Number(portArg)
fs.mkdirSync(profile, { recursive: true })

const isShell = chromePath.includes('chrome-headless-shell')
const child = spawn(chromePath, [
  '--remote-debugging-pipe', '--no-sandbox', `--user-data-dir=${profile}`, '--mute-audio',
  // A throttled timer would invalidate every measurement (see the README).
  '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
  '--no-first-run', `--window-size=${widthArg},${heightArg}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  ...isShell ? [] : ['--headless=new'],
  // Extra switches, space separated. Two browsers on one machine need `--disable-features=WebRtcHideLocalIpsWithMdns`: Chrome hides
  // the host candidates behind .local names, and a sandbox that cannot resolve them never connects the pair.
  ...(process.env.CHROME_FLAGS ? process.env.CHROME_FLAGS.split(' ').filter(Boolean) : []),
  'about:blank',
], { stdio: ['ignore', 'ignore', fs.openSync(`${profile}.chrome.log`, 'w'), 'pipe', 'pipe'] })
const toChrome = child.stdio[3]
const fromChrome = child.stdio[4]

let buffer = ''
let nextId = 1
const pending = new Map()
const events = []
fromChrome.on('data', chunk => {
  buffer += chunk.toString('utf8')
  let end
  while ((end = buffer.indexOf('\0')) >= 0) {
    const message = JSON.parse(buffer.slice(0, end))
    buffer = buffer.slice(end + 1)
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message)
      pending.delete(message.id)
    } else {
      events.push({ i: events.length, at: Date.now(), ...message })
    }
  }
})
const send = (method, params = {}, sessionId) => new Promise(resolve => {
  const id = nextId++
  pending.set(id, resolve)
  toChrome.write(JSON.stringify({ id, method, params, ...sessionId ? { sessionId } : {} }) + '\0')
})

const target = await send('Target.createTarget', { url: 'about:blank' })
const attached = await send('Target.attachToTarget', { targetId: target.result.targetId, flatten: true })
const sessionId = attached.result.sessionId
for (const method of ['Runtime.enable', 'Page.enable', 'Log.enable']) await send(method, {}, sessionId)
await send('Emulation.setDeviceMetricsOverride', { width: +widthArg, height: +heightArg, deviceScaleFactor: 1, mobile: false }, sessionId)

const readBody = request => new Promise(resolve => {
  let body = ''
  request.on('data', chunk => (body += chunk))
  request.on('end', () => resolve(body))
})
http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://x')
  const json = value => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)) }
  if (url.pathname === '/session') return json({ sid: sessionId })
  if (url.pathname === '/events') {
    const since = Number(url.searchParams.get('since') || 0)
    return json({ next: events.length, events: events.slice(since) })
  }
  if (url.pathname === '/send') {
    const { method, params, sessionId: override } = JSON.parse(await readBody(request))
    return json(await send(method, params, override === undefined ? sessionId : override || undefined))
  }
  if (url.pathname === '/quit') {
    json({ bye: 1 })
    child.kill('SIGTERM')
    setTimeout(() => process.exit(0), 1500)
    return
  }
  response.writeHead(404)
  response.end()
}).listen(port, '127.0.0.1', () => console.log(`driver ready on ${port} (${path.basename(chromePath)}), session ${sessionId}`))
child.on('exit', code => {
  console.log('chrome exited', code)
  process.exit(0)
})
