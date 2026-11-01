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

const MIN_READOUT_PAIRS = 12
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
  const { layoutFor, TABLE_ROWS } = await scene
  const mobile = layoutFor(759, 844, DESKTOP_TEXT)
  const desktop = layoutFor(760, 900, DESKTOP_TEXT)
  t.true(mobile.mobile)
  t.false(desktop.mobile)
  t.is(mobile.rows, TABLE_ROWS.mobile)
  t.is(desktop.rows, TABLE_ROWS.desktop)
})

test('the desktop scrim and beam mask start at the measured ink', async t => {
  const { layoutFor } = await scene
  const layout = layoutFor(1440, 900, DESKTOP_TEXT)
  t.is(layout.scrim[0], DESKTOP_TEXT.bodyRight)
  t.is(layout.copy[0], DESKTOP_TEXT.bodyRight)
  t.is(layout.copy[1], DESKTOP_TEXT.bottom)
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

test('the first readout stays up until the first swap', async t => {
  const { tableState, TABLE } = await scene
  t.is(tableState(TABLE.firstSwap - 0.001).cycle, 0)
  t.is(tableState(TABLE.firstSwap).cycle, 1)
})

test('every readout verdict is what isSibling says', async t => {
  const { READOUT, REFUSED, ALLOWED } = await content
  t.true(READOUT.length >= MIN_READOUT_PAIRS)
  for (const [candidate, existing, verdict] of READOUT) {
    t.true([REFUSED, ALLOWED].includes(verdict))
    t.is(
      isSibling(candidate, existing) ? REFUSED : ALLOWED,
      verdict,
      `${candidate} vs ${existing}`
    )
  }
})

test('every readout pair comes from the README table', async t => {
  const { READOUT } = await content
  const readme = read('README.md')
  for (const [candidate, existing] of READOUT) {
    t.true(
      readme.includes(`| \`${candidate}\` | \`${existing}\` |`),
      `${candidate} vs ${existing}`
    )
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

test('encoded rows carry the readout right aligned and the inbox lines split at the local part', async t => {
  const { encodeLines, READOUT, INBOX_LINES, TABLE_CHARS, REFUSED } =
    await content
  const encoded = encodeLines()
  t.is(encoded.height, READOUT.length + INBOX_LINES.length)
  const row = index =>
    String.fromCharCode(
      ...encoded.data.subarray(
        index * encoded.width,
        index * encoded.width + TABLE_CHARS
      )
    )
  READOUT.forEach(([candidate, , verdict], index) => {
    const text = row(index)
    t.true(text.startsWith(candidate))
    t.true(text.endsWith(verdict))
    t.is(text.length, TABLE_CHARS)
    t.is(encoded.data[index * encoded.width + 36], candidate.length)
    t.is(encoded.data[index * encoded.width + 37], TABLE_CHARS)
    t.is(encoded.data[index * encoded.width + 38], verdict === REFUSED ? 1 : 0)
  })
  INBOX_LINES.forEach(([local, domain], index) => {
    const at = (READOUT.length + index) * encoded.width
    t.true(row(READOUT.length + index).startsWith(`${local}@${domain}`))
    t.is(encoded.data[at + 36], local.length)
    t.is(encoded.data[at + 37], local.length + 1 + domain.length)
  })
})

test('a pair that does not fit the band is refused', async t => {
  const { encodeLines, TABLE_CHARS, REFUSED } = await content
  const candidate = `${'a'.repeat(TABLE_CHARS - REFUSED.length - 1)}@x`
  t.true(
    t.throws(() => encodeLines([[candidate, 'a@x', REFUSED]], [])) instanceof
      RangeError
  )
})

test('the shader draws the frozen mark', async t => {
  const { MARK } = await brand
  const wgsl = read('docs/cover/shaders/lens.wgsl')
  t.is(wgslConstant(wgsl, 'RING_CY'), MARK.ring.cy)
  t.is(wgslConstant(wgsl, 'RING_OUTER'), MARK.ring.outer)
  t.is(wgslConstant(wgsl, 'RING_INNER'), MARK.ring.inner)
  t.is(wgslConstant(wgsl, 'FIRST_CX'), MARK.first)
  t.is(wgslConstant(wgsl, 'SECOND_CX'), MARK.second)
  t.is(wgslConstant(wgsl, 'STRIKE_FROM'), MARK.strike.from)
  t.is(wgslConstant(wgsl, 'STRIKE_TO'), MARK.strike.to)
  t.is(wgslConstant(wgsl, 'STRIKE_HALF'), MARK.strike.half)
  t.is(wgslConstant(wgsl, 'STRIKE_CORNER'), MARK.strike.corner)
  t.true(
    Math.abs(wgslConstant(wgsl, 'STRIKE_ANGLE') - MARK.strike.angle) <
      ANGLE_TOLERANCE
  )
  t.is(
    wgsl
      .match(/const MARK_CENTER = vec2f\(([\d.]+), ([\d.]+)\);/)
      .slice(1, 3)
      .map(Number)
      .join(','),
    `${MARK.width / 2},${MARK.ring.cy}`
  )
})

test('the shader readout matches the encoded rows', async t => {
  const { READOUT, INBOX_LINES, TABLE_CHARS } = await content
  const wgsl = read('docs/cover/shaders/lens.wgsl')
  t.is(wgslConstant(wgsl, 'READOUT_COUNT'), READOUT.length)
  t.is(wgslConstant(wgsl, 'FIELD_FIRST_ROW'), READOUT.length)
  t.is(wgslConstant(wgsl, 'FIELD_COUNT'), INBOX_LINES.length)
  t.is(wgslConstant(wgsl, 'TABLE_CHARS'), TABLE_CHARS)
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
