// A small CDP client for driver.mjs. The port comes from CDP_PORT (default 9444). No dependencies: node 22 has fetch.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** Where screenshots go. */
export const OUT = process.env.TOUCH_HARNESS_OUT ?? path.join(os.tmpdir(), 'elifoot-touch-harness')
fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true })
fs.mkdirSync(path.join(OUT, 'results'), { recursive: true })

const BASE = `http://127.0.0.1:${process.env.CDP_PORT || 9444}`
const raw = async (method, params = {}, sessionId) =>
  (await fetch(`${BASE}/send`, { method: 'POST', body: JSON.stringify({ method, params, sessionId }) })).json()

export async function connect() {
  const { sid } = await (await fetch(`${BASE}/session`)).json()
  const send = async (method, params = {}) => {
    const message = await raw(method, params, sid)
    if (message.error) throw new Error(`${method} ${JSON.stringify(message.error)}`)
    return message.result
  }

  // Every evaluation races a timer: a hung page must fail the step, not the whole run.
  const evaluate = async (expression, timeout = 60000) => {
    let timer
    const result = await Promise.race([
      send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`eval timeout: ${expression.slice(0, 80)}`)), timeout) }),
    ]).finally(() => clearTimeout(timer))
    if (result.exceptionDetails) throw new Error(`EVAL ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`)
    return result.result.value
  }
  const ev = (expression, timeout) => evaluate(`(async()=>(${expression}))()`, timeout)
  const evBody = (body, timeout) => evaluate(`(async()=>{${body}})()`, timeout)

  const shot = async (file, clip) => {
    const result = await send('Page.captureScreenshot', { format: 'png', ...clip ? { clip } : {} })
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'))
    return file
  }
  /** The guest's framebuffer as a PNG, exact pixels (dosCI.screenshot), not the page. */
  const dosShot = async file => {
    const url = await evBody(`const im = await dosCI.screenshot(); const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height; cv.getContext('2d').putImageData(im, 0, 0); return im.width + 'x' + im.height + '|' + cv.toDataURL('image/png')`)
    const [size, data] = url.split('|')
    fs.writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'))
    return size
  }

  let since = 0
  const logs = async () => {
    const result = await (await fetch(`${BASE}/events?since=${since}`)).json()
    since = result.next
    return result.events
      .filter(event => event.method === 'Runtime.consoleAPICalled' || event.method === 'Runtime.exceptionThrown')
      .map(event => event.method === 'Runtime.exceptionThrown'
        ? `[EXC] ${event.params.exceptionDetails.exception?.description ?? event.params.exceptionDetails.text}`
        : `[${event.params.type}] ${event.params.args.map(arg => arg.value ?? arg.description ?? arg.type).join(' ')}`)
  }

  // ---- input ----
  const touch = (type, points) => send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i, radiusX: p.r ?? 10, radiusY: p.r ?? 10, force: 1 })),
  })
  const tap = async (x, y, hold = 60) => { await touch('touchStart', [{ x, y }]); await sleep(hold); await touch('touchEnd', []) }
  const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, ...extra })
  const emulate = async (width = 390, height = 844, deviceScaleFactor = 2, mobile = true) => {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile })
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  }
  return { send, ev, evBody, shot, dosShot, logs, touch, tap, mouse, emulate, sid }
}
