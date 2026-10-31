#!/usr/bin/env node
// Makes a MASKABLE copy of a launcher icon from the artwork the app already ships, with no tools but node:
//
//   node scripts/pwa-icons/make-maskable.mjs <source.png> <out.png> [--size 512] [--scale 0.66] [--check]
//
// A maskable icon is drawn full-bleed and then cut to whatever shape the launcher uses (a circle, a squircle, a
// rounded square), so everything that matters has to sit inside the "safe zone": a circle of 40% of the icon's
// width around the centre. The shipped launcher icon is the opposite, artwork to the very edge, which a circular
// mask would cut through the lettering. This script shrinks the artwork by `--scale` (area averaging, so the
// pixel-art stays legible) and centres it on a canvas of the artwork's own background colour (its top-left pixel),
// so the padding is seamless. `--check` prints, for the result, how far from the centre the lettering reaches.
//
// 0.66 keeps the lettering ("98", "ELIFOOT", "WEBPLAY": the farthest of it is the bottom corners of WEBPLAY,
// 0.585 of the width from the centre in the source) inside the 0.40 circle with a margin: 0.585 * 0.66 = 0.386
// (0.68 would pass by a hair, 0.398, and a launcher's circle is exactly the edge of the safe zone's margin).
// What is left outside the circle is the pitch's markings and the edges of the dark band, which a mask may
// cut. The two files the manifest lists were made with `--size 512` and `--size 192`.
//
// Decodes non-interlaced PNGs (palette of 1 to 8 bits, grey, RGB, RGBA of 8 bits) and writes 8-bit RGBA.
import fs from 'node:fs'
import zlib from 'node:zlib'

function decode(file) {
  const buf = fs.readFileSync(file)
  let pos = 8, width, height, depth, colorType, interlace, palette = null, trns = null
  const idat = []
  while (pos < buf.length) {
    const length = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + length)
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; colorType = data[9]; interlace = data[12] }
    if (type === 'PLTE') palette = data
    if (type === 'tRNS') trns = data
    if (type === 'IDAT') idat.push(data)
    pos += 12 + length
  }
  if (interlace) throw new Error('interlaced PNGs are not supported')
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType]
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = Math.ceil(width * channels * depth / 8)
  const out = Buffer.alloc(height * stride)
  const bpp = Math.max(1, channels * depth / 8)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    for (let x = 0; x < stride; x++) {
      const cur = raw[y * (stride + 1) + 1 + x]
      const a = x >= bpp ? out[y * stride + x - bpp] : 0
      const b = y > 0 ? out[(y - 1) * stride + x] : 0
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0
      let v
      switch (filter) {
        case 0: v = cur; break
        case 1: v = cur + a; break
        case 2: v = cur + b; break
        case 3: v = cur + ((a + b) >> 1); break
        case 4: { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = cur + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break }
        default: throw new Error(`bad filter ${filter}`)
      }
      out[y * stride + x] = v & 255
    }
  }
  const rgba = new Float64Array(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let r, g, b, a = 255
    if (colorType === 3) {
      const bit = x * depth
      const idx = (out[y * stride + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1)
      r = palette[idx * 3]; g = palette[idx * 3 + 1]; b = palette[idx * 3 + 2]
      if (trns && idx < trns.length) a = trns[idx]
    } else if (colorType === 2) { const o = y * stride + x * 3; r = out[o]; g = out[o + 1]; b = out[o + 2] }
    else if (colorType === 6) { const o = y * stride + x * 4; r = out[o]; g = out[o + 1]; b = out[o + 2]; a = out[o + 3] }
    else { const o = y * stride + x * channels; r = g = b = out[o]; if (colorType === 4) a = out[o + 1] }
    rgba.set([r, g, b, a], (y * width + x) * 4)
  }
  return { width, height, rgba }
}

/** Area-averaged resize: each target pixel is the mean of the source area it covers. */
function resize(image, targetWidth, targetHeight) {
  const { width, height, rgba } = image
  const out = new Float64Array(targetWidth * targetHeight * 4)
  const sx = width / targetWidth, sy = height / targetHeight
  for (let ty = 0; ty < targetHeight; ty++) for (let tx = 0; tx < targetWidth; tx++) {
    const x0 = tx * sx, x1 = (tx + 1) * sx, y0 = ty * sy, y1 = (ty + 1) * sy
    let r = 0, g = 0, b = 0, a = 0, total = 0
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++) for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      const w = (Math.min(x + 1, x1) - Math.max(x, x0)) * (Math.min(y + 1, y1) - Math.max(y, y0))
      const o = (Math.min(y, height - 1) * width + Math.min(x, width - 1)) * 4
      r += rgba[o] * w; g += rgba[o + 1] * w; b += rgba[o + 2] * w; a += rgba[o + 3] * w; total += w
    }
    out.set([r / total, g / total, b / total, a / total], (ty * targetWidth + tx) * 4)
  }
  return { width: targetWidth, height: targetHeight, rgba: out }
}

function crc32(buf) {
  let c, crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}

function encode({ width, height, rgba }) {
  const stride = width * 4
  const raw = Buffer.alloc(height * (stride + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    for (let x = 0; x < stride; x++) raw[y * (stride + 1) + 1 + x] = Math.round(rgba[y * stride + x])
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4)
  header[8] = 8; header[9] = 6 // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const args = process.argv.slice(2)
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback }
const size = Number(flag('--size', '512'))
const scale = Number(flag('--scale', '0.66'))
const check = args.includes('--check')
const [source, target] = args.filter(arg => !arg.startsWith('--'))
if (!source || !target) {
  console.error('usage: make-maskable.mjs <source.png> <out.png> [--size 512] [--scale 0.66] [--check]')
  process.exit(1)
}

const art = decode(source)
const background = Array.from(art.rgba.subarray(0, 4))
const inner = Math.round(size * scale)
// Resize from the source straight to the size it will be drawn at, not through an intermediate: two passes blur twice.
const small = resize(art, Math.round(inner * art.width / Math.max(art.width, art.height)), Math.round(inner * art.height / Math.max(art.width, art.height)))
const canvas = { width: size, height: size, rgba: new Float64Array(size * size * 4) }
for (let i = 0; i < size * size; i++) canvas.rgba.set(background, i * 4)
const left = Math.floor((size - small.width) / 2), top = Math.floor((size - small.height) / 2)
for (let y = 0; y < small.height; y++) for (let x = 0; x < small.width; x++) {
  canvas.rgba.set(small.rgba.subarray((y * small.width + x) * 4, (y * small.width + x) * 4 + 4), ((top + y) * size + left + x) * 4)
}
fs.writeFileSync(target, encode(canvas))
console.log(`${target}: ${size}x${size}, artwork ${small.width}x${small.height} at (${left}, ${top}), background rgba(${background.join(', ')})`)

if (check) {
  // The lettering is yellow (254,254,0) with a black outline: how far from the centre do those reach?
  const cx = (size - 1) / 2, cy = (size - 1) / 2
  let far = 0
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const o = (y * size + x) * 4
    const [r, g, b] = [canvas.rgba[o], canvas.rgba[o + 1], canvas.rgba[o + 2]]
    const yellow = r > 200 && g > 200 && b < 80
    if (yellow) far = Math.max(far, Math.hypot(x - cx, y - cy))
  }
  console.log(`farthest yellow pixel from the centre: ${(far / size).toFixed(3)} of the width (safe zone: 0.400)`)
}
