// The guest's real cursor, read out of guest RAM: the oracle every grade in this harness is made against.
// Injected into the page by nav.mjs (never part of the app). It talks to dosCI directly and never through the
// app's touch layer, so it can grade that layer.
//
// Windows 3.1 keeps the cursor as two uint16s (x, y). On the shipped bundle they sit at two addresses that were the
// same after a reboot, on every screen and at both video modes (0x45c12, 0x5eaae); a third hit is heap and moves.
// Nothing here trusts that: `calibrate()` verifies a hint by nudging the cursor and watching the value follow, and
// scans the 8 MB if no hint does. Re-run it after any change to the disk image or the video drivers.
(() => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  const O = window.ORACLE = window.ORACLE || { addr: null, hints: [0x45c12, 0x5eaae] }

  O.readAt = async address => {
    const bytes = await dosCI.readMemory(address, 4)
    const view = new DataView(bytes.buffer, bytes.byteOffset, 4)
    return { x: view.getUint16(0, true), y: view.getUint16(2, true) }
  }
  O.read = () => O.readAt(O.addr)

  // Slow, and meant for the oracle only: 5 sends of (-200, -200), 80 ms apart, then settle. It clips into the corner.
  O.home = async () => {
    for (let i = 0; i < 5; i++) { dosCI.sendMouseRelativeMotion(-200, -200); await sleep(80) }
    await sleep(250)
  }

  O.verify = async address => {
    const before = await O.readAt(address)
    const sx = before.x < dosCI.width() - 60 ? 20 : -20
    const sy = before.y < dosCI.height() - 60 ? 20 : -20
    dosCI.sendMouseRelativeMotion(sx, sy)
    await sleep(120)
    const after = await O.readAt(address)
    const ok = Math.abs(after.x - before.x) === 40 && Math.abs(after.y - before.y) === 40
    dosCI.sendMouseRelativeMotion(-sx, -sy)
    await sleep(120)
    return ok
  }

  // Three snapshots of all of guest RAM with the cursor at three known positions; the address whose pair read
  // (0,0), (120,80) and (360,260) every time is the cursor. About 1.5 s.
  O.discover = async () => {
    const snapshot = async () => {
      const all = new Uint8Array(8 << 20)
      for (let offset = 0; offset < all.length; offset += 1 << 20) all.set(await dosCI.readMemory(offset, 1 << 20), offset)
      return new DataView(all.buffer)
    }
    await O.home()
    const s0 = await snapshot()
    dosCI.sendMouseRelativeMotion(60, 40); await sleep(250)
    const s1 = await snapshot()
    dosCI.sendMouseRelativeMotion(120, 90); await sleep(250)
    const s2 = await snapshot()
    const hits = []
    for (let a = 0; a < s0.byteLength - 4; a += 2) {
      if (s0.getUint16(a, true) === 0 && s0.getUint16(a + 2, true) === 0
        && s1.getUint16(a, true) === 120 && s1.getUint16(a + 2, true) === 80
        && s2.getUint16(a, true) === 360 && s2.getUint16(a + 2, true) === 260) hits.push(a)
    }
    return hits
  }

  O.calibrate = async () => {
    for (const hint of O.hints) {
      if (await O.verify(hint)) { O.addr = hint; return { via: 'hint', addr: hint } }
    }
    const hits = await O.discover()
    if (!hits.length) throw new Error('cursor address not found')
    O.addr = hits[0]
    return { via: 'scan', addr: hits[0], all: hits }
  }
  return 1
})()
