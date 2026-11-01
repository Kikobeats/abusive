'use strict'

const { createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const { default: test } = require('ava')

const brand = import('../docs/brand/mark.js')
const banner = import('../docs/brand/banner.js')

const ROOT = join(__dirname, '..')
const read = (file, encoding) => readFileSync(join(ROOT, file), encoding)

const JPEG_START_OF_FRAME = [0xc0, 0xc1, 0xc2]

const jpegSize = buffer => {
  let offset = 2
  while (offset < buffer.length) {
    const marker = buffer[offset + 1]
    if (JPEG_START_OF_FRAME.includes(marker)) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7)
      }
    }
    offset += 2 + buffer.readUInt16BE(offset + 2)
  }
  throw new Error('no JPEG frame header')
}

const metaContent = (html, attribute, name) =>
  html.match(new RegExp(`<meta ${attribute}="${name}" content="([^"]+)"`))[1]

test('the committed mark and icon are what the brand build generates', async t => {
  const { markSvg, iconSvg } = await brand
  t.is(read('static/mark.svg', 'utf8'), markSvg())
  t.is(read('static/logo.svg', 'utf8'), iconSvg())
})

test('the two rings do not overlap', async t => {
  const { MARK } = await brand
  const { first, second, ring } = MARK
  t.true(first + ring.outer <= second - ring.outer)
})

test('the strike stays inside the mark box', async t => {
  const { MARK, toStrikeFrame } = await brand
  const { from, to, half } = MARK.strike
  const toMark = toStrikeFrame(MARK)
  const corners = [
    toMark(from, -half),
    toMark(from, half),
    toMark(to, -half),
    toMark(to, half)
  ]
  for (const [x, y] of corners) {
    t.true(x >= 0 && x <= MARK.width, `x=${x} leaves the box`)
    t.true(y >= 0 && y <= MARK.height, `y=${y} leaves the box`)
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
