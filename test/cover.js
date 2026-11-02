'use strict'

const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const { default: test } = require('ava')

const scene = import('../docs/cover/scene.js')
const content = import('../docs/cover/content.js')
const brand = import('../docs/brand/mark.js')

const ROOT = join(__dirname, '..')
const read = file => readFileSync(join(ROOT, file), 'utf8')

const DESKTOP_TEXT = {
  right: 614,
  top: 247,
  bottom: 653,
  bodyRight: 512,
  wordmarkBottom: 339
}

const MEASURED_TEXT = [
  [[1440, 900], DESKTOP_TEXT],
  [
    [1024, 768],
    { right: 479, top: 207, bottom: 561, bodyRight: 455, wordmarkBottom: 272 }
  ],
  [
    [1920, 1080],
    { right: 614, top: 337, bottom: 743, bodyRight: 512, wordmarkBottom: 429 }
  ]
]

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
  for (const [[width, height], text] of MEASURED_TEXT) {
    const layout = layoutFor(width, height, text)
    const c = Math.cos(layout.angle)
    const s = Math.sin(layout.angle)
    for (const [x, y] of MARK_OUTLINE) {
      const px = layout.home[0] + (c * x - s * y) * layout.scale
      const py = layout.home[1] + (s * x + c * y) * layout.scale
      t.true(px >= 0 && px <= width, `${width}x${height} x=${px}`)
      t.true(py >= 0 && py <= height, `${width}x${height} y=${py}`)
      t.true(
        py > text.wordmarkBottom || px > text.right,
        `${width}x${height} overlaps the wordmark at ${px},${py}`
      )
    }
  }
})

test('on a short phone the mark stays below the copy', async t => {
  const { layoutFor, markBounds } = await scene
  const copy = {
    right: 375,
    top: 0,
    bottom: 366,
    bodyRight: 360,
    wordmarkBottom: 107
  }
  for (const [width, height] of [
    [375, 667],
    [390, 844],
    [320, 568]
  ]) {
    const layout = layoutFor(width, height, copy)
    const autopilotSway = 6
    const markTop =
      layout.home[1] +
      markBounds(layout.angle).top * layout.scale -
      autopilotSway
    t.true(markTop >= copy.bottom, `${width}x${height} mark top ${markTop}`)
  }
})

const lensCenter = (mark, layout, angle, MARK) => {
  const d = (MARK.center - MARK.size / 2) * layout.scale
  return {
    x: mark.x + Math.cos(angle) * d - Math.sin(angle) * d,
    y: mark.y + Math.sin(angle) * d + Math.cos(angle) * d
  }
}

test('inside its travel area the lens center lands under the pointer', async t => {
  const { layoutFor, lensUnder } = await scene
  const { MARK } = await brand
  const layout = layoutFor(1440, 900, DESKTOP_TEXT)
  const angle = 0.03
  const pointer = { x: 1000, y: 450 }
  const lens = lensCenter(
    lensUnder(pointer, layout, angle),
    layout,
    angle,
    MARK
  )
  t.true(Math.abs(lens.x - pointer.x) < 1e-9)
  t.true(Math.abs(lens.y - pointer.y) < 1e-9)
})

test('the lens never enters the copy column or leaves the cover', async t => {
  const { layoutFor, lensUnder } = await scene
  const { MARK } = await brand
  for (const [[width, height], text] of MEASURED_TEXT) {
    const layout = layoutFor(width, height, text)
    const ring = MARK.ring.outer * layout.scale
    for (const pointer of [
      { x: 0, y: 0 },
      { x: 0, y: height },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: text.bodyRight / 2, y: height / 2 }
    ]) {
      const lens = lensCenter(lensUnder(pointer, layout, 0), layout, 0, MARK)
      t.true(
        lens.x - ring > text.bodyRight,
        `${width}x${height} ${JSON.stringify(pointer)} enters the copy`
      )
      t.true(lens.x + ring <= width, `${width}x${height} right edge`)
      t.true(
        lens.y - ring >= 0 && lens.y + ring <= height,
        `${width}x${height} vertical`
      )
    }
  }
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

test('the scroll cue points at a README section', t => {
  const id = read('_coverpage.md').match(
    /class="cover__scroll" href="#\/\?id=([\w-]+)"/
  )[1]
  const headings = read('README.md')
    .split('\n')
    .filter(line => line.startsWith('## '))
    .map(line => line.slice(3).trim().toLowerCase().replace(/\s+/g, '-'))
  t.true(headings.includes(id), `#${id} is not a README section`)
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
