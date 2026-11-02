'use strict'

const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const { default: test } = require('ava')

const { createAbusive, isSibling } = require('../src')

const scene = import('../docs/cover/scene.js')
const content = import('../docs/cover/content.js')
const brand = import('../docs/brand/mark.js')

const ROOT = join(__dirname, '..')
const read = file => readFileSync(join(ROOT, file), 'utf8')

const DESKTOP_TEXT = {
  right: 528,
  top: 269,
  bottom: 631,
  bodyRight: 504,
  wordmarkBottom: 361
}

const PILL_ADDRESSES = 5
const DEGREES = Math.PI / 180
const ANGLE_TOLERANCE = 1e-6

const wgslConstant = (wgsl, name) => {
  const match = wgsl.match(new RegExp(`const ${name} = ([^;]+);`))
  if (!match) throw new Error(`no WGSL constant ${name}`)
  const value = match[1].trim()
  const degrees = value.match(/^radians\(([-\d.]+)\)$/)
  return degrees
    ? Number(degrees[1]) * DEGREES
    : Number(value.replace(/u$/, ''))
}

const sameInboxOnly = existing =>
  createAbusive({ sibling: { lookup: () => [existing], min: 2 } })

test('a narrow cover is the mobile layout and a wide cover is the desktop one', async t => {
  const { layoutFor } = await scene
  t.true(layoutFor(759, 844, DESKTOP_TEXT).mobile)
  t.false(layoutFor(760, 900, DESKTOP_TEXT).mobile)
})

test('the desktop scrim starts at the measured ink', async t => {
  const { layoutFor } = await scene
  const layout = layoutFor(1440, 900, DESKTOP_TEXT)
  t.is(layout.scrim[0], DESKTOP_TEXT.bodyRight)
})

test('the mark outline clears the wordmark and stays inside the desktop cover', async t => {
  const { layoutFor, MARK_OUTLINE } = await scene
  for (const [width, height] of [
    [1440, 900],
    [1024, 768],
    [1920, 1080]
  ]) {
    const layout = layoutFor(width, height, DESKTOP_TEXT)
    const c = Math.cos(layout.angle)
    const s = Math.sin(layout.angle)
    for (const [x, y] of MARK_OUTLINE) {
      const px = layout.home[0] + (c * x - s * y) * layout.scale
      const py = layout.home[1] + (s * x + c * y) * layout.scale
      t.true(px >= 0 && px <= width, `${width}x${height} x=${px}`)
      t.true(py >= 0 && py <= height, `${width}x${height} y=${py}`)
      t.true(
        py > DESKTOP_TEXT.wordmarkBottom || px > DESKTOP_TEXT.right,
        `${width}x${height} overlaps the wordmark at ${px},${py}`
      )
    }
  }
})

test('the status pill counts five same-inbox siblings of one another', async t => {
  const { SAME_INBOX } = await content
  const pill = read('_coverpage.md').match(/data-status-text>([^<]+)</)[1]
  t.is(pill, `${PILL_ADDRESSES} addresses &rarr; 1 inbox`)
  t.is(new Set(SAME_INBOX).size, PILL_ADDRESSES)
  for (const candidate of SAME_INBOX) {
    for (const existing of SAME_INBOX) {
      if (candidate === existing) continue
      t.is(
        await sameInboxOnly(existing).findSibling(candidate),
        existing,
        `${candidate} is not the same inbox as ${existing}`
      )
    }
  }
})

test('a numbered sibling alone does not count as the same inbox', async t => {
  t.is(
    await sameInboxOnly('derek1@gmail.com').findSibling('derek2@gmail.com'),
    null
  )
  t.true(isSibling('derek2@gmail.com', 'derek1@gmail.com'))
})

test('encoded rows carry each inbox line split at the local part', async t => {
  const { encodeLines, INBOX_LINES } = await content
  const encoded = encodeLines()
  t.is(encoded.height, INBOX_LINES.length)
  INBOX_LINES.forEach(([local, domain], index) => {
    const at = index * encoded.width
    const text = `${local}@${domain}`
    t.is(
      String.fromCharCode(...encoded.data.subarray(at, at + text.length)),
      text
    )
    t.is(encoded.data[at + 36], local.length)
    t.is(encoded.data[at + 37], text.length)
  })
})

test('an inbox line that does not fit its cells is refused', async t => {
  const { encodeLines } = await content
  t.true(
    t.throws(() => encodeLines([['a'.repeat(40), 'x.com']])) instanceof
      RangeError
  )
})

test('the shader draws the frozen mark', async t => {
  const { MARK } = await brand
  const wgsl = read('docs/cover/shaders/lens.wgsl')
  t.is(wgslConstant(wgsl, 'LENS_CXY'), MARK.center)
  t.is(wgslConstant(wgsl, 'RING_OUTER'), MARK.ring.outer)
  t.is(wgslConstant(wgsl, 'RING_INNER'), MARK.ring.inner)
  t.is(wgslConstant(wgsl, 'HANDLE_FROM'), MARK.handle.from)
  t.is(wgslConstant(wgsl, 'HANDLE_TO'), MARK.handle.to)
  t.is(wgslConstant(wgsl, 'HANDLE_HALF'), MARK.handle.half)
  t.is(wgslConstant(wgsl, 'HANDLE_CORNER'), MARK.handle.corner)
  t.true(
    Math.abs(wgslConstant(wgsl, 'HANDLE_ANGLE') - MARK.handle.angle) <
      ANGLE_TOLERANCE
  )
  t.is(
    wgsl
      .match(/const MARK_CENTER = vec2f\(([\d.]+), ([\d.]+)\);/)
      .slice(1, 3)
      .map(Number)
      .join(','),
    `${MARK.size / 2},${MARK.size / 2}`
  )
})

test('the shader wall matches the encoded rows', async t => {
  const { INBOX_LINES } = await content
  const wgsl = read('docs/cover/shaders/lens.wgsl')
  t.is(wgslConstant(wgsl, 'FIELD_COUNT'), INBOX_LINES.length)
})

test('the lens magnifies what is under it', t => {
  const wgsl = read('docs/cover/shaders/lens.wgsl')
  t.true(wgslConstant(wgsl, 'LENS_ZOOM') > 1)
  t.true(wgslConstant(wgsl, 'LENS_PINCUSHION') >= 0)
})

test('the cover copies the agent prompt from the README', t => {
  const readme = read('README.md')
  const cover = read('_coverpage.md')
  const prompt = readme.match(
    /Wire abusive into this project's signup:.*free email providers\./
  )[0]
  const copied = cover
    .match(/data-prompt="([^"]*)"/)[1]
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
  t.is(copied, prompt)
  for (const api of [
    'isAbusive({ email })',
    'verified: true',
    'isRejectedEmail',
    'abusive/stripe',
    'abusive/redis'
  ]) {
    t.true(prompt.includes(api), api)
  }
  t.false(/—/.test(prompt))
})
