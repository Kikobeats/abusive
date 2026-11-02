'use strict'

const { createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const { default: test } = require('ava')

const brand = import('../docs/brand/mark.js')
const banner = import('../docs/brand/banner.js')

const ROOT = join(__dirname, '..')
const read = (file, encoding) => readFileSync(join(ROOT, file), encoding)

const JPEG_BASELINE_FRAME = 0xc0

const jpegSize = buffer => {
  let offset = 2
  while (offset < buffer.length) {
    const marker = buffer[offset + 1]
    if (marker === JPEG_BASELINE_FRAME) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7)
      }
    }
    offset += 2 + buffer.readUInt16BE(offset + 2)
  }
  throw new Error('no baseline JPEG frame header')
}

const metaContent = (html, attribute, name) =>
  html.match(new RegExp(`<meta ${attribute}="${name}" content="([^"]+)"`))[1]

test('the committed mark and icon are what the brand build generates', async t => {
  const { markSvg, iconSvg } = await brand
  t.is(read('static/mark.svg', 'utf8'), markSvg())
  t.is(read('static/logo.svg', 'utf8'), iconSvg())
})

test('the cover cursor is the generated mark, clicking at the lens center', async t => {
  const { cursorSvg, cursorHotspot } = await brand
  t.is(read('static/cursor.svg', 'utf8'), cursorSvg())
  const hotspot = cursorHotspot()
  const rule = read('docs/cover/cover.css', 'utf8').match(
    /\.cover-hero \{[^}]*cursor: url\("\.\.\/\.\.\/static\/cursor\.svg"\) (\d+) (\d+), zoom-in;/
  )
  t.truthy(rule, 'the cover sets the magnifier cursor')
  t.deepEqual(rule.slice(1).map(Number), [hotspot, hotspot])
})

test('the dot floats inside the lens without touching the ring', async t => {
  const { MARK } = await brand
  t.true(MARK.dot > 0)
  t.true(MARK.dot < MARK.ring.inner)
  t.true(MARK.ring.inner < MARK.ring.outer)
})

test('the handle starts inside the ring band and ends outside it', async t => {
  const { MARK } = await brand
  const { from, to, half } = MARK.handle
  t.true(Math.hypot(from, half) > MARK.ring.inner, 'handle pokes into the lens')
  t.true(from < MARK.ring.outer, 'handle floats off the ring')
  t.true(to > MARK.ring.outer)
})

test('the whole mark stays inside its square box', async t => {
  const { MARK, toHandleFrame } = await brand
  const { from, to, half } = MARK.handle
  const toMark = toHandleFrame(MARK)
  const points = [
    toMark(from, -half),
    toMark(from, half),
    toMark(to, -half),
    toMark(to, half),
    [MARK.center - MARK.ring.outer, MARK.center - MARK.ring.outer],
    [MARK.center + MARK.ring.outer, MARK.center + MARK.ring.outer]
  ]
  for (const [x, y] of points) {
    t.true(x >= 0 && x <= MARK.size, `x=${x} leaves the box`)
    t.true(y >= 0 && y <= MARK.size, `y=${y} leaves the box`)
  }
})

test('the social image URLs carry the hash of the committed banner', t => {
  const html = read('index.html', 'utf8')
  const version = createHash('sha256')
    .update(read('static/banner.jpg'))
    .digest('hex')
    .slice(0, 8)
  const expected = `https://abusive.js.org/static/banner.jpg?v=${version}`
  t.is(metaContent(html, 'property', 'og:image'), expected)
  t.is(metaContent(html, 'name', 'twitter:image'), expected)
})

test('the declared banner size is the rendered banner size', async t => {
  const { BANNER } = await banner
  const html = read('index.html', 'utf8')
  const size = jpegSize(read('static/banner.jpg'))
  t.deepEqual(size, {
    width: BANNER.width * BANNER.scale,
    height: BANNER.height * BANNER.scale
  })
  t.is(Number(metaContent(html, 'property', 'og:image:width')), size.width)
  t.is(Number(metaContent(html, 'property', 'og:image:height')), size.height)
})

test('the banner URLs get the new version whether or not they had one', async t => {
  const { versionBannerUrls } = await banner
  const html = [
    '<meta content="https://abusive.js.org/static/banner.jpg" />',
    '<meta content="https://abusive.js.org/static/banner.jpg?v=0123abcd" />',
    '<link href="static/banner.png" />'
  ].join('\n')
  t.is(
    versionBannerUrls(html, 'feedbeef'),
    [
      '<meta content="https://abusive.js.org/static/banner.jpg?v=feedbeef" />',
      '<meta content="https://abusive.js.org/static/banner.jpg?v=feedbeef" />',
      '<link href="static/banner.png" />'
    ].join('\n')
  )
})

const DITHER_SAMPLE = 4096

test('the banner dither moves a channel by at most one and never wraps', async t => {
  const { dither } = await banner
  for (const [value, low, high] of [
    [0, 0, 1],
    [128, 127, 129],
    [255, 254, 255]
  ]) {
    const pixels = dither(Buffer.alloc(DITHER_SAMPLE, value))
    t.true(
      pixels.every(channel => channel >= low && channel <= high),
      `${value}`
    )
    t.true(
      pixels.some(channel => channel !== value),
      `${value} never moved`
    )
    t.deepEqual(pixels, dither(Buffer.alloc(DITHER_SAMPLE, value)))
  }
})
