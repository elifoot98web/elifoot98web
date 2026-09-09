#!/usr/bin/env node
/**
 * Launch the browsers for a multiplayer test session.
 *
 *   node scripts/multiplayer-harness/launch.mjs [--peers 2] [--url http://localhost:4200]
 *                                              [--first-port 9222] [--keep] [--headless]
 *
 * Peer 0 is the host and opens `#/game?host=1`; the rest are spectators and open
 * `#/join-game`. Each gets its own Chrome profile and its own CDP port, and both of those
 * are load-bearing rather than tidiness — see the README.
 *
 * Nothing here is part of the app: this directory is test tooling, outside every input in
 * angular.json. See the README for why that is guaranteed rather than incidental.
 */
import { spawn } from 'node:child_process'
import { existsSync, rmSync, mkdirSync } from 'node:fs'
import { get } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DEFAULTS = {
  peers: 2,
  url: 'http://localhost:4200',
  firstPort: 9222,
  profileRoot: join(tmpdir(), 'elifoot-mp-harness'),
  windowSize: { width: 900, height: 760 },
}

/** Chrome is not an npm dependency, so it has to be found. CHROME_BIN wins if set. */
const CHROME_CANDIDATES = [
  process.env['CHROME_BIN'],
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)

/**
 * The flags that matter, and why. Chrome treats a window covered by another one as
 * occluded, which makes `document.visibilityState` 'hidden'; a hidden page has its timers
 * throttled and its animation frames suspended, and *both* wreck a multiplayer session.
 * Throttling stretches the 13 s host grace, the 20 s stream wait and the 1.5 s auto-saver
 * tick into nonsense (a game boot once took 112 s), and suspended frames leave Ionic's
 * enter/leave animations unfinished, so an awaited `modalController.dismiss()` never
 * settles and the join dialog hangs with the room never joined.
 *
 * These flags fix the timers. Animations still need the window frontmost, which is what
 * `cdp.mjs front <port>` is for.
 */
const REALTIME_FLAGS = [
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  // First-run bubbles and the default-browser prompt steal the click target otherwise.
  '--no-first-run',
  '--no-default-browser-check',
]

const parseArgs = argv => {
  const args = { ...DEFAULTS, keep: false, headless: false }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = argv[i + 1]
    switch (flag) {
      case '--peers': args.peers = Number(value); i++; break
      case '--url': args.url = value; i++; break
      case '--first-port': args.firstPort = Number(value); i++; break
      case '--keep': args.keep = true; break
      // Off by default: the point of this harness is watching the picture while it is driven.
      case '--headless': args.headless = true; break
      case '--help': case '-h': args.help = true; break
      default:
        throw new Error(`unknown argument: ${flag}`)
    }
  }
  if (!Number.isInteger(args.peers) || args.peers < 1) throw new Error('--peers must be a positive integer')
  return args
}

const usage = `Usage: node scripts/multiplayer-harness/launch.mjs [options]

  --peers N        how many browsers; peer 0 hosts, the rest spectate (default ${DEFAULTS.peers})
  --url URL        where the app is served (default ${DEFAULTS.url})
  --first-port N   CDP port for peer 0, incrementing (default ${DEFAULTS.firstPort})
  --keep           reuse existing profiles instead of wiping them
  --headless       run without windows; overlay animations then need 'cdp.mjs front'
  --help
`

const httpJson = (port, path) =>
  new Promise((resolve, reject) => {
    get({ host: '127.0.0.1', port, path, timeout: 1000 }, res => {
      let body = ''
      res.on('data', chunk => (body += chunk))
      res.on('end', () => {
        try { resolve(JSON.parse(body)) } catch (err) { reject(err) }
      })
    }).on('error', reject)
  })

const isPortLive = async port => {
  try {
    await httpJson(port, '/json/version')
    return true
  } catch {
    return false
  }
}

const waitForPort = async (port, attempts = 40) => {
  for (let i = 0; i < attempts; i++) {
    if (await isPortLive(port)) return true
    await new Promise(r => setTimeout(r, 500))
  }
  return false
}

const peerFor = (index, args) => {
  const isHost = index === 0
  return {
    index,
    role: isHost ? 'host' : `guest${index}`,
    port: args.firstPort + index,
    // The host page carries the emulator, so it is the one that must never be reloaded
    // mid-session; guests are cheap to reload and the app relies on that (see
    // JoinGamePage.reloadSpectator).
    url: isHost ? `${args.url}/#/game?host=1` : `${args.url}/#/join-game`,
    profile: join(args.profileRoot, isHost ? 'host' : `guest${index}`),
    // Cascaded rather than tiled: we cannot know the screen size, and the flags above mean
    // a covered window still keeps time correctly.
    position: { x: index * 60, y: index * 40 },
  }
}

const launchPeer = (peer, chrome, args) => {
  if (!args.keep && existsSync(peer.profile)) rmSync(peer.profile, { recursive: true, force: true })
  mkdirSync(peer.profile, { recursive: true })

  const flags = [
    `--user-data-dir=${peer.profile}`,
    `--remote-debugging-port=${peer.port}`,
    ...REALTIME_FLAGS,
    `--window-size=${args.windowSize.width},${args.windowSize.height}`,
    `--window-position=${peer.position.x},${peer.position.y}`,
    ...(args.headless ? ['--headless=new'] : []),
    peer.url,
  ]

  // Detached, with output discarded: the browsers have to outlive this process.
  const child = spawn(chrome, flags, { detached: true, stdio: 'ignore' })
  child.unref()
}

/** A plain GET, so a missing dev server is reported before any browser opens onto it. */
const appIsServed = url =>
  new Promise(resolve => {
    get(url, res => {
      res.resume()
      resolve(true)
    }).on('error', () => resolve(false))
  })

const main = async () => {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(`${err.message}\n\n${usage}`)
    process.exit(1)
  }
  if (args.help) {
    console.log(usage)
    return
  }

  const chrome = CHROME_CANDIDATES.find(path => existsSync(path))
  if (!chrome) {
    console.error('Could not find Chrome. Set CHROME_BIN to its executable.')
    process.exit(1)
  }

  if (!(await appIsServed(args.url))) {
    console.error(`Nothing is serving ${args.url}. Run \`npm start\` first.`)
    process.exit(1)
  }

  const peers = Array.from({ length: args.peers }, (_, i) => peerFor(i, args))

  for (const peer of peers) {
    if (await isPortLive(peer.port)) {
      console.error(
        `Port ${peer.port} is already in use — a previous session is probably still running.\n` +
        `Close it with:  pkill -f "${args.profileRoot}"`
      )
      process.exit(1)
    }
  }

  for (const peer of peers) launchPeer(peer, chrome, args)

  console.log(`Chrome: ${chrome}`)
  console.log(`Profiles: ${args.profileRoot}${args.keep ? ' (reused)' : ' (fresh)'}\n`)

  for (const peer of peers) {
    const ready = await waitForPort(peer.port)
    console.log(`  ${String(peer.port).padEnd(6)} ${peer.role.padEnd(7)} ${ready ? 'ready' : 'NO CDP — check the window'}  ${peer.url}`)
  }

  const drive = 'node scripts/multiplayer-harness/cdp.mjs'
  console.log(`
Next:
  ${drive} state ${peers[0].port}                 # what the host sees
  ${drive} watch ${peers[0].port} > /tmp/host.log &   # one watcher per port, no more
  ${drive} front ${peers.at(-1).port}                 # before driving any dialog

Stop everything:  pkill -f "${args.profileRoot}"
`)
}

await main()
