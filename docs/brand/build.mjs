import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import opentype from 'opentype.js'
import sharp from 'sharp'
import { BANNER, bannerSvg, dither, versionBannerUrls } from './banner.js'
import { ICON, iconSvg, markSvg } from './mark.js'

const require = createRequire(import.meta.url)
const STATIC = new URL('../../static/', import.meta.url)
const INDEX = new URL('../../index.html', import.meta.url)
const ICON_SIZES = { 'logo.png': 512, 'favicon-32x32.png': 32 }
const CSS_DPI = 72
const BANNER_JPEG = { quality: 95, chromaSubsampling: '4:4:4' }

const font = (pkg, file) => {
  const { buffer, byteOffset, byteLength } = readFileSync(require.resolve(`@fontsource/${pkg}/files/${file}`))
  return opentype.parse(buffer.slice(byteOffset, byteOffset + byteLength))
}

const FONTS = {
  display: font('space-grotesk', 'space-grotesk-latin-700-normal.woff'),
  body: font('ibm-plex-sans', 'ibm-plex-sans-latin-400-normal.woff'),
  mono: font('jetbrains-mono', 'jetbrains-mono-latin-400-normal.woff')
}

const POINTS = { M: ['x', 'y'], L: ['x', 'y'], Q: ['x1', 'y1', 'x', 'y'], C: ['x1', 'y1', 'x2', 'y2', 'x', 'y'], Z: [] }

const pathData = commands =>
  commands.map(command => command.type + POINTS[command.type].map(axis => +command[axis].toFixed(2)).join(' ')).join('')

const textPath = ({ font, text, size, tracking = 0 }) => {
  const scale = size / font.unitsPerEm
  const glyphs = font.stringToGlyphs(text)
  let x = 0
  const parts = glyphs.map((glyph, index) => {
    const d = pathData(glyph.getPath(x, 0, size).commands)
    const next = glyphs[index + 1]
    const kerning = next ? font.getKerningValue(glyph, next) : 0
    x += (glyph.advanceWidth + kerning) * scale + (next ? tracking * size : 0)
    return d
  })
  return { d: parts.join(''), width: x }
}

const write = (name, contents) => {
  writeFileSync(new URL(name, STATIC), contents)
  console.log(`static/${name}`)
}

const icon = iconSvg()
write('mark.svg', markSvg())
write('logo.svg', icon)

for (const [name, size] of Object.entries(ICON_SIZES)) {
  await sharp(Buffer.from(icon), { density: (CSS_DPI * size) / ICON.size }).resize(size, size).png().toFile(fileURLToPath(new URL(name, STATIC)))
  console.log(`static/${name}`)
}

const banner = bannerSvg({ fonts: FONTS, textPath })
const { data, info } = await sharp(Buffer.from(banner), { density: CSS_DPI * BANNER.scale })
  .resize(BANNER.width * BANNER.scale, BANNER.height * BANNER.scale)
  .flatten({ background: BANNER.background })
  .raw()
  .toBuffer({ resolveWithObject: true })
await sharp(dither(data), { raw: info })
  .jpeg(BANNER_JPEG)
  .toFile(fileURLToPath(new URL('banner.jpg', STATIC)))
console.log('static/banner.jpg')

const version = createHash('sha256').update(readFileSync(new URL('banner.jpg', STATIC))).digest('hex').slice(0, 8)
writeFileSync(INDEX, versionBannerUrls(readFileSync(INDEX, 'utf8'), version))
console.log(`index.html og:image ?v=${version}`)
