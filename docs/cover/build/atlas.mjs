import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { PNG } from 'pngjs'
import opentype from 'opentype.js'
import { ATLAS } from '../atlas-layout.js'

const require = createRequire(import.meta.url)
const FONT_FILE = require.resolve('@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff')
const CURVE_STEPS = 8

const font = opentype.parse(readFileSync(FONT_FILE).buffer.slice(0))
const unitsPerEm = font.unitsPerEm

const quadratic = (from, { x1, y1, x, y }, t) => {
  const u = 1 - t
  return [
    u * u * from[0] + 2 * u * t * x1 + t * t * x,
    u * u * from[1] + 2 * u * t * y1 + t * t * y
  ]
}

function flatten (path) {
  const segments = []
  let pen = null
  const lineTo = next => {
    segments.push([pen[0], pen[1], next[0], next[1]])
    pen = next
  }
  for (const command of path.commands) {
    if (command.type === 'M') pen = [command.x, command.y]
    else if (command.type === 'L') lineTo([command.x, command.y])
    else if (command.type === 'Q') {
      const from = pen
      for (let i = 1; i <= CURVE_STEPS; i++) lineTo(quadratic(from, command, i / CURVE_STEPS))
    }
  }
  return segments
}

function signedDistance (segments, x, y) {
  let best = Infinity
  let winding = 0
  for (const [ax, ay, bx, by] of segments) {
    const dx = bx - ax
    const dy = by - ay
    const lengthSq = dx * dx + dy * dy || 1e-9
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSq))
    const px = ax + t * dx - x
    const py = ay + t * dy - y
    best = Math.min(best, px * px + py * py)
    if (ay <= y) {
      if (by > y && dx * (y - ay) - dy * (x - ax) > 0) winding++
    } else if (by <= y && dx * (y - ay) - dy * (x - ax) < 0) winding--
  }
  const distance = Math.sqrt(best)
  return winding !== 0 ? distance : -distance
}

const width = ATLAS.columns * ATLAS.cellWidth
const height = ATLAS.rows * ATLAS.cellHeight
const pixels = new Uint8Array(width * height)
const fontUnitsPerTexel = unitsPerEm / ATLAS.texelsPerEm

for (let index = 0; index < ATLAS.glyphCount; index++) {
  const char = String.fromCharCode(ATLAS.firstCode + index)
  const glyph = font.charToGlyph(char)
  const segments = flatten(glyph.getPath(0, 0, unitsPerEm))
  const originX = (index % ATLAS.columns) * ATLAS.cellWidth
  const originY = Math.floor(index / ATLAS.columns) * ATLAS.cellHeight
  for (let ty = 0; ty < ATLAS.cellHeight; ty++) {
    for (let tx = 0; tx < ATLAS.cellWidth; tx++) {
      const emX = (tx + 0.5 - ATLAS.pad) / ATLAS.texelsPerEm
      const emUp = ATLAS.ascentEm - (ty + 0.5 - ATLAS.pad) / ATLAS.texelsPerEm
      const distanceTexels = signedDistance(segments, emX * unitsPerEm, -emUp * unitsPerEm) / fontUnitsPerTexel
      const value = 0.5 + 0.5 * Math.max(-1, Math.min(1, distanceTexels / ATLAS.spread))
      pixels[(originY + ty) * width + originX + tx] = Math.round(value * 255)
    }
  }
}

const png = new PNG({ width, height, colorType: 0, inputColorType: 0, bitDepth: 8 })
png.data = Buffer.from(pixels)
writeFileSync(new URL('../atlas.png', import.meta.url), PNG.sync.write(png, { colorType: 0, inputColorType: 0 }))
console.log(`atlas ${width}x${height}, ${ATLAS.glyphCount} glyphs from ${FONT_FILE.split('/').pop()}`)
