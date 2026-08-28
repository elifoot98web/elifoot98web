#!/usr/bin/env node
/**
 * Drive and observe one browser of a multiplayer test session over the Chrome DevTools
 * Protocol. No dependencies: node 22 ships a global WebSocket, which is the only reason
 * this is 200 lines instead of a puppeteer install.
 *
 *   node scripts/multiplayer-harness/cdp.mjs <command> <port> [argument]
 *
 *   state    <port>                what this peer sees: room, roster, transcript, video
 *   eval     <port> '<js>'         evaluate an expression (awaited, JSON out)
 *   click    <port> '<selector>'   real mouse events at the element's centre
 *   front    <port>                raise the window, then report visibilityState
 *   watch    <port>                stream console + exceptions until killed
 *   shot     <port> <file.png>     screenshot
 *   offline  <port> <true|false>   Network.emulateNetworkConditions
 *   nav      <port> <url>          navigate
 *   reload   <port>                reload
 *
 * Read the README before using it: several of these commands exist because of a trap that
 * silently invalidates results, and `state` is where the pass/fail conditions live.
 */
const [command, portArg, argument] = process.argv.slice(2)
const port = Number(portArg)

if (!command || !port) {
  console.error('Usage: node scripts/multiplayer-harness/cdp.mjs <command> <port> [argument]')
  process.exit(1)
}

const httpJson = path =>
  new Promise((resolve, reject) => {
    import('node:http').then(({ default: http }) =>
      http
        .get({ host: '127.0.0.1', port, path }, res => {
          let body = ''
          res.on('data', chunk => (body += chunk))
          res.on('end', () => {
            try { resolve(JSON.parse(body)) } catch (err) { reject(err) }
          })
        })
        .on('error', reject)
    )
  })

/** The app's own tab, not whatever else the profile has open. */
const findTarget = async () => {
  const targets = await httpJson('/json/list')
  const pages = targets.filter(target => target.type === 'page')
  return pages.find(target => target.url.includes('/#/')) ?? pages[0]
}

const target = await findTarget()
if (!target) {
  console.error(`No page target on ${port}. Is the browser still running?`)
  process.exit(1)
}

const socket = new WebSocket(target.webSocketDebuggerUrl)
let nextId = 0
const pending = new Map()

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })

const describeArg = arg =>
  arg.value !== undefined ? String(arg.value) : (arg.description ?? arg.preview?.description ?? arg.type)

const printEvent = message => {
  const stamp = new Date().toISOString().slice(11, 23)
  if (message.method === 'Runtime.consoleAPICalled') {
    console.log(`${stamp} [${message.params.type}] ${message.params.args.map(describeArg).join(' ')}`)
  } else if (message.method === 'Runtime.exceptionThrown') {
    const details = message.params.exceptionDetails
    console.log(`${stamp} [EXCEPTION] ${details.exception?.description ?? details.text}`)
  } else if (message.method === 'Log.entryAdded') {
    console.log(`${stamp} [log:${message.params.entry.level}] ${message.params.entry.text}`)
  }
}

socket.onmessage = event => {
  const message = JSON.parse(event.data)
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id)
    pending.delete(message.id)
    message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result)
  } else if (message.method && command === 'watch') {
    printEvent(message)
  }
}

await new Promise(resolve => (socket.onopen = resolve))

/**
 * Every evaluation races a timer, because an awaited Ionic overlay dismiss can simply never
 * settle: in a page Chrome considers hidden, the enter/leave animation never completes and
 * the promise stays pending forever. Without the race the whole call hangs instead of
 * telling you what happened. `front <port>` is the cure for the underlying condition.
 */
const evaluate = async expression => {
  await send('Runtime.enable')
  const result = await send('Runtime.evaluate', {
    expression: `Promise.race([ (async()=>(${expression}))(), new Promise(r=>setTimeout(()=>r('__EVAL_TIMEOUT__'), 20000)) ])`,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  })
  if (result.exceptionDetails) {
    const details = result.exceptionDetails
    console.error(`EVAL ERROR: ${details.exception?.description ?? details.text}`)
    process.exit(2)
  }
  return result.result.value ?? result.result.description ?? null
}

/**
 * Everything worth asserting on in one call, so a session reads as a sequence of states
 * rather than a pile of ad-hoc selectors.
 *
 * On the guest, `gameState` is resolved through the page's own `GameState` field rather than a
 * copy of the enum: it is numeric with no explicit values, so any copy here would rot the
 * moment a member is appended. The host page has no such state machine — it is either
 * broadcasting or not — so its two flags are reported instead. `window.ng` only exists in
 * development builds, which is all this harness is for.
 */
const STATE_EXPRESSION = `(() => {
  const text = el => el?.innerText?.replace(/\\s+/g, ' ').trim() ?? null;
  const page = document.querySelector('app-join-game') ?? document.querySelector('app-game');
  const isGuest = page?.tagName === 'APP-JOIN-GAME';
  const component = window.ng?.getComponent?.(page);
  const guestState = () => component?.GameState && component.gameState !== undefined
    ? Object.entries(component.GameState).find(([, value]) => value === component.gameState)?.[0]
    : 'unknown (no ng — production build?)';
  const hostState = () => !component ? 'unknown (no ng — production build?)'
    : component.isStreaming ? 'STREAMING'
    : component.isHosting ? 'HOSTING_PENDING'
    : 'NOT_HOSTING';
  const video = document.querySelector('#stream-target');
  return {
    role: isGuest ? 'guest' : 'host',
    url: location.hash,
    visibility: document.visibilityState,
    gameState: isGuest ? guestState() : hostState(),
    room: component?.currentRoomCode || component?.hostRoomId || null,
    pill: text(document.querySelector('.mp-status-pill')),
    headcount: text(document.querySelector('.chat-titlebar-count')),
    roster: text(document.querySelector('app-participant-list')),
    transcript: Array.from(document.querySelectorAll('.chat-line')).map(line => line.innerText.replace(/\\n/g, ' | ')),
    video: video ? {
      resolution: video.videoWidth + 'x' + video.videoHeight,
      box: video.offsetWidth + 'x' + video.offsetHeight,
      currentTime: Number(video.currentTime.toFixed(2)),
      paused: video.paused,
    } : null,
    overlays: Array.from(document.querySelectorAll('ion-alert, ion-modal, ion-toast'))
      .filter(el => !el.classList.contains('overlay-hidden'))
      .map(el => el.tagName + ': ' + (text(el) ?? '').slice(0, 70)),
  };
})()`

switch (command) {
  case 'state': {
    console.log(JSON.stringify(await evaluate(STATE_EXPRESSION), null, 1))
    break
  }
  case 'eval': {
    console.log(JSON.stringify(await evaluate(argument), null, 1))
    break
  }
  /**
   * Real mouse events, because a synthetic `element.click()` is not reliable inside an
   * `ion-modal` — the submit button of the room dialog swallows it — and a genuine gesture
   * is what the app sees from a user anyway.
   */
  case 'click': {
    const point = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(argument)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const box = el.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    })()`)
    if (!point) {
      console.error(`No element matches ${argument}`)
      process.exit(2)
    }
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', {
        type,
        x: point.x,
        y: point.y,
        button: 'left',
        clickCount: 1,
        buttons: type === 'mousePressed' ? 1 : 0,
      })
    }
    console.log(`clicked ${argument} at ${Math.round(point.x)},${Math.round(point.y)}`)
    break
  }
  /**
   * Raise the window before driving any dialog. A covered window is 'hidden' to Chrome, and
   * a hidden page runs no animation frames, so Ionic's overlays never finish presenting or
   * dismissing — the room dialog stays on screen and the join never starts.
   */
  case 'front': {
    await send('Page.enable')
    await send('Page.bringToFront')
    console.log(`front; visibility = ${await evaluate('document.visibilityState')}`)
    break
  }
  /**
   * One watcher per port. Two writing to the same file truncate each other and you end up
   * reading an empty log at the exact moment you need it.
   */
  case 'watch': {
    await send('Runtime.enable')
    await send('Log.enable')
    console.log(`# watching ${target.url} on ${port}`)
    await new Promise(() => {})
    break
  }
  case 'shot': {
    const { data } = await send('Page.captureScreenshot', { format: 'png' })
    const { writeFile } = await import('node:fs/promises')
    await writeFile(argument, Buffer.from(data, 'base64'))
    console.log(`wrote ${argument}`)
    break
  }
  /**
   * Cuts HTTP and WebSocket traffic, so it is enough to break *signalling*. It does not
   * reliably stop media already flowing over an established WebRTC connection, so a real
   * "host drops off the network" test still means turning the machine's Wi-Fi off.
   */
  case 'offline': {
    await send('Network.enable')
    const offline = argument === 'true'
    await send('Network.emulateNetworkConditions', {
      offline,
      latency: 0,
      downloadThroughput: offline ? 0 : -1,
      uploadThroughput: offline ? 0 : -1,
    })
    console.log(`offline = ${offline}`)
    break
  }
  case 'nav': {
    await send('Page.enable')
    await send('Page.navigate', { url: argument })
    console.log(`navigating to ${argument}`)
    break
  }
  case 'reload': {
    await send('Page.enable')
    await send('Page.reload', {})
    console.log('reloaded')
    break
  }
  default: {
    console.error(`Unknown command: ${command}`)
    process.exit(1)
  }
}

process.exit(0)
