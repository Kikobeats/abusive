'use strict'

const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const { default: test } = require('ava')

const scene = import('../docs/cover/scene.js')
const content = import('../docs/cover/content.js')
const brand = import('../docs/brand/mark.js')
const atlasLayout = import('../docs/cover/atlas-layout.js')

const ROOT = join(__dirname, '..')
const read = file => readFileSync(join(ROOT, file), 'utf8')

const { desktop: DESKTOP_TEXT } = JSON.parse(
  read('docs/cover/build/text-boxes.json')
)

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

test('the wall font grows only on covers wider than 1800px', async t => {
  const { layoutFor } = await scene
  t.is(layoutFor(1800, 1080, DESKTOP_TEXT).fontSize, 13)
  t.is(layoutFor(1801, 1080, DESKTOP_TEXT).fontSize, 14)
})

test('the desktop mark scale stays between its limits', async t => {
  const { layoutFor } = await scene
  t.is(layoutFor(760, 300, DESKTOP_TEXT).scale, 4)
  const roomy = { ...DESKTOP_TEXT, right: 300, bodyRight: 300 }
  t.is(layoutFor(4000, 3000, roomy).scale, 12)
})

const overlapsWordmark = (layout, text, homeX, MARK_OUTLINE) =>
  MARK_OUTLINE.some(([x, y]) => {
    const px = homeX + x * layout.scale
    const py = layout.home[1] + y * layout.scale
    return py <= text.wordmarkBottom + 24 && px <= text.right + 24
  })

test('the mark moves right only as far as it must to clear the wordmark', async t => {
  const { layoutFor, MARK_OUTLINE } = await scene
  const clear = { ...DESKTOP_TEXT, right: -Infinity, wordmarkBottom: -Infinity }
  const resting = layoutFor(1440, 900, clear).home[0]
  const layout = layoutFor(1440, 900, DESKTOP_TEXT)
  t.true(layout.home[0] > resting)
  t.false(overlapsWordmark(layout, DESKTOP_TEXT, layout.home[0], MARK_OUTLINE))
  t.true(
    overlapsWordmark(layout, DESKTOP_TEXT, layout.home[0] - 4, MARK_OUTLINE)
  )
})

test('a wordmark the mark can never clear stops it at the right margin', async t => {
  const { layoutFor } = await scene
  const wall = { ...DESKTOP_TEXT, right: 1440, wordmarkBottom: 900 }
  const [homeX] = layoutFor(1440, 900, wall).home
  t.true(homeX >= 1440 - 56 - 12 && homeX < 1440 - 56 - 12 + 4)
})

test('a lens with no room to travel rests at its home', async t => {
  const { layoutFor, lensUnder } = await scene
  const narrow = layoutFor(800, 120, { ...DESKTOP_TEXT, bodyRight: 700 })
  const corners = [
    { x: 0, y: 0 },
    { x: 800, y: 120 }
  ].map(pointer => lensUnder(pointer, narrow, 0))
  t.deepEqual(corners[0], corners[1])
  t.deepEqual(corners[0], { x: narrow.home[0], y: narrow.home[1] })
})

const CLEAR_OF_WORDMARK = {
  ...DESKTOP_TEXT,
  right: -Infinity,
  wordmarkBottom: -Infinity
}
const SCENE_GAP_LEFT = 30 + 12
const SCENE_GAP_RIGHT = 56 + 12

const swayEdges = (layout, swayBounds) => {
  const units = swayBounds(layout.angle)
  return {
    left: layout.home[0] + units.left * layout.scale,
    right: layout.home[0] + units.right * layout.scale
  }
}

test('a desktop mark with room to spare is centered in the scene', async t => {
  const { layoutFor, swayBounds } = await scene
  const layout = layoutFor(1440, 900, CLEAR_OF_WORDMARK)
  const { left, right } = swayEdges(layout, swayBounds)
  const sceneLeft = DESKTOP_TEXT.bodyRight + SCENE_GAP_LEFT
  const sceneRight = 1440 - SCENE_GAP_RIGHT
  t.true(left > sceneLeft)
  t.true(Math.abs(left - sceneLeft - (sceneRight - right)) < 1e-9)
})

test('a desktop mark wider than its scene starts at the scene left edge', async t => {
  const { layoutFor, swayBounds } = await scene
  const layout = layoutFor(760, 300, CLEAR_OF_WORDMARK)
  const { left, right } = swayEdges(layout, swayBounds)
  const sceneLeft = DESKTOP_TEXT.bodyRight + SCENE_GAP_LEFT
  t.true(right > 760 - SCENE_GAP_RIGHT)
  t.true(Math.abs(left - sceneLeft) < 1e-9)
})

test('a wide phone caps the mobile mark scale', async t => {
  const { layoutFor } = await scene
  const copy = { ...DESKTOP_TEXT, bottom: 366 }
  t.is(layoutFor(759, 2000, copy).scale, 7)
  t.true(layoutFor(320, 2000, copy).scale < 7)
})

test('the desktop vertical wander grows with the cover up to 14px', async t => {
  const { layoutFor } = await scene
  t.is(layoutFor(1440, 600, DESKTOP_TEXT).wander[1], 9.6)
  t.is(layoutFor(1440, 900, DESKTOP_TEXT).wander[1], 14)
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

const PHONE_COPY = {
  right: 375,
  top: 0,
  bottom: 366,
  bodyRight: 360,
  wordmarkBottom: 107
}

test('on a short phone the whole mark fits under the copy', async t => {
  const { layoutFor, swayBounds } = await scene
  for (const [width, height] of [
    [375, 667],
    [700, 700],
    [740, 600]
  ]) {
    const layout = layoutFor(width, height, PHONE_COPY)
    const units = swayBounds(layout.angle)
    const markBottom = layout.home[1] + units.bottom * layout.scale
    t.true(markBottom <= height, `${width}x${height} mark bottom ${markBottom}`)
    t.true(layout.scale > 3)
  }
})

test('the mobile mark stops shrinking at scale 3', async t => {
  const { layoutFor } = await scene
  t.is(layoutFor(320, 568, PHONE_COPY).scale, 3)
  t.is(layoutFor(320, 400, PHONE_COPY).scale, 3)
})

test('the layout takes the mobile mode it is given over the width', async t => {
  const { layoutFor } = await scene
  t.true(layoutFor(770, 900, DESKTOP_TEXT, true).mobile)
  t.false(layoutFor(700, 900, DESKTOP_TEXT, false).mobile)
})

test('the scene and cover.css switch to mobile on the same media query', async t => {
  const { MOBILE_QUERY } = await scene
  t.is(MOBILE_QUERY, '(max-width: 759px)')
  t.true(read('docs/cover/cover.css').includes(`@media ${MOBILE_QUERY} {`))
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
  const { encodeLines, INBOX_LINES, LINE_ENCODING } = await content
  const encoded = encodeLines()
  t.is(encoded.height, INBOX_LINES.length)
  INBOX_LINES.forEach(([local, domain], index) => {
    const at = index * encoded.width
    const text = `${local}@${domain}`
    t.is(
      String.fromCharCode(...encoded.data.subarray(at, at + text.length)),
      text
    )
    t.is(encoded.data[at + LINE_ENCODING.keyEndTexel], local.length)
    t.is(encoded.data[at + LINE_ENCODING.lineLengthTexel], text.length)
  })
})

test('an inbox line fits its 36 cells and one more character is refused', async t => {
  const { encodeLines } = await content
  t.notThrows(() => encodeLines([['a'.repeat(30), 'x.com']]))
  t.true(
    t.throws(() => encodeLines([['a'.repeat(31), 'x.com']])) instanceof
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
  const { INBOX_LINES, LINE_ENCODING } = await content
  const wgsl = read('docs/cover/shaders/lens.wgsl')
  t.is(wgslConstant(wgsl, 'FIELD_COUNT'), INBOX_LINES.length)
  t.is(wgslConstant(wgsl, 'TEXT_CELLS'), LINE_ENCODING.textCells)
  t.is(wgslConstant(wgsl, 'KEY_END_TEXEL'), LINE_ENCODING.keyEndTexel)
  t.is(wgslConstant(wgsl, 'LINE_LENGTH_TEXEL'), LINE_ENCODING.lineLengthTexel)
  t.is(wgslConstant(wgsl, 'PLUS'), '+'.charCodeAt(0))
})

const wgslVector = (wgsl, name) =>
  wgsl
    .match(new RegExp(`const ${name} = vec2f\\(([\\d.]+), ([\\d.]+)\\);`))
    .slice(1, 3)
    .map(Number)

test('the shader reads the atlas with the layout the atlas was drawn with', async t => {
  const { ATLAS } = await atlasLayout
  const wgsl = read('docs/cover/shaders/lens.wgsl')
  t.deepEqual(wgslVector(wgsl, 'ATLAS_SIZE'), [
    ATLAS.columns * ATLAS.cellWidth,
    ATLAS.rows * ATLAS.cellHeight
  ])
  t.deepEqual(wgslVector(wgsl, 'ATLAS_CELL'), [
    ATLAS.cellWidth,
    ATLAS.cellHeight
  ])
  t.is(wgslConstant(wgsl, 'ATLAS_COLUMNS'), ATLAS.columns)
  t.is(wgslConstant(wgsl, 'ATLAS_TEXELS_PER_EM'), ATLAS.texelsPerEm)
  t.is(wgslConstant(wgsl, 'ATLAS_PAD'), ATLAS.pad)
  t.is(wgslConstant(wgsl, 'ATLAS_ASCENT_EM'), ATLAS.ascentEm)
  t.is(wgslConstant(wgsl, 'ATLAS_SPREAD'), ATLAS.spread)
  t.is(wgslVector(wgsl, 'CELL_EM')[0], ATLAS.advanceEm)
})

test('the lens magnifies what is under it', t => {
  const wgsl = read('docs/cover/shaders/lens.wgsl')
  t.true(wgslConstant(wgsl, 'LENS_ZOOM') > 1)
  t.true(wgslConstant(wgsl, 'LENS_PINCUSHION') >= 0)
})

const HEADING_PUNCTUATION =
  /[\u2000-\u206F\u2E00-\u2E7F\\'!"#$%&()*+,./:;<=>?@[\]^`{|}~]/g

const docsifySlug = heading =>
  heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(HEADING_PUNCTUATION, '')
    .replace(/\s/g, '-')
    .replace(/-+/g, '-')

test('every cover link into the docs points at a README section', t => {
  const ids = [
    ...read('_coverpage.md').matchAll(/href="#\/\?id=([\w-]+)"/g)
  ].map(([, id]) => id)
  const headings = read('README.md')
    .split('\n')
    .filter(line => /^#{1,6} /.test(line))
    .map(line => docsifySlug(line.replace(/^#+ /, '')))
  t.true(headings.includes('isabusive-email-ip-'))
  t.deepEqual(ids, ['quick-start', 'install'])
  for (const id of ids) {
    t.true(headings.includes(id), `#${id} is not a README section`)
  }
})

test('the cover copies the agent prompt from the README', t => {
  const readme = read('README.md')
  const cover = read('_coverpage.md')
  const prompt = readme.match(
    /Wire abusive into this project's signup:.*free email providers\./
  )[0]
  t.is(cover.match(/data-prompt="([^"]*)"/)[1], prompt)
  for (const api of [
    'isAbusive({ email, ip })',
    'never on a check anyone can call',
    'isRejectedEmail',
    'abusive/stripe',
    'abusive/redis'
  ]) {
    t.true(prompt.includes(api), api)
  }
  t.false(/—/.test(prompt))
})

test('the committed shader module is the prepared lens.wgsl', async t => {
  const { lensShader } = await import('../docs/cover/shaders.js')
  const source = lensShader.wgsl
    .replace(/^\/\/ vgsl-module: .*\n/gm, '')
    .replace(/_vgsl_m\d+__/g, '')
  t.is(source, read('docs/cover/shaders/lens.wgsl'))
})

const followState = async ({ seconds, pointer = null }) => {
  const { layoutFor } = await scene
  return {
    seconds,
    theme: 0,
    themeTarget: 0,
    layout: layoutFor(1440, 900, DESKTOP_TEXT),
    lens: null,
    velocityX: 0,
    pointer
  }
}

const settle = (stepLens, state, steps = 400) => {
  for (let i = 0; i < steps; i++) stepLens(state, 0.05)
}

test('the first still step puts the lens on its autopilot', async t => {
  const { stepLens, autopilot } = await scene
  const state = await followState({ seconds: 4.2 })
  stepLens(state, 0)
  const auto = autopilot(4.2, state.layout)
  t.is(state.lens.x, auto.x)
  t.is(state.lens.y, auto.y)
  t.is(state.lens.angle, auto.angle)
  t.is(state.seconds, 4.2)
})

test('a still step keeps the lens tilt a number', async t => {
  const { stepLens } = await scene
  const state = await followState({ seconds: 4.2 })
  stepLens(state, 0.05)
  stepLens(state, 0)
  t.true(Number.isFinite(state.lens.angle))
  t.true(Number.isFinite(state.velocityX))
})

test('the lens settles under the pointer and back on its autopilot without one', async t => {
  const { stepLens, autopilot, lensUnder } = await scene
  const pointer = { x: 1100, y: 400 }
  const state = await followState({ seconds: 4.2, pointer })
  settle(stepLens, state)
  const goal = lensUnder(
    pointer,
    state.layout,
    autopilot(state.seconds, state.layout).angle
  )
  t.true(Math.abs(state.lens.x - goal.x) < 1)
  t.true(Math.abs(state.lens.y - goal.y) < 1)

  state.pointer = null
  settle(stepLens, state)
  const auto = autopilot(state.seconds, state.layout)
  t.true(Math.abs(state.lens.x - auto.x) < 1)
  t.true(Math.abs(state.lens.y - auto.y) < 1)
})

test('a fast pointer tilts the lens to its limit and no further, either way', async t => {
  const { stepLens, autopilot } = await scene
  for (const [x, sign] of [
    [1120, 1],
    [840, -1]
  ]) {
    const state = await followState({
      seconds: 4.2,
      pointer: { x: 980, y: 450 }
    })
    settle(stepLens, state)
    state.pointer = { x, y: 450 }
    stepLens(state, 0.05)
    stepLens(state, 0.05)
    const tilt = state.lens.angle - autopilot(state.seconds, state.layout).angle
    t.true(Math.abs(tilt - sign * 0.05) < 1e-12, `tilt ${tilt}`)
  }
})

test('a long step weighs the new velocity fully and never overshoots it', async t => {
  const { stepLens } = await scene
  const state = await followState({
    seconds: 4.2,
    pointer: { x: 1100, y: 450 }
  })
  stepLens(state, 0)
  const before = state.lens.x
  stepLens(state, 0.5)
  t.is(state.velocityX, (state.lens.x - before) / 0.5)
})

test('the theme eases at a fixed rate and lands on its target, both ways', async t => {
  const { stepLens } = await scene
  const state = await followState({ seconds: 4.2 })
  state.themeTarget = 1
  stepLens(state, 0.045)
  t.true(Math.abs(state.theme - 0.1) < 1e-12)
  settle(stepLens, state, 20)
  t.is(state.theme, 1)
  state.themeTarget = 0
  stepLens(state, 0.045)
  t.true(Math.abs(state.theme - 0.9) < 1e-12)
  settle(stepLens, state, 20)
  t.is(state.theme, 0)
})

test('the scene sends the shader exactly the uniforms it declares', async t => {
  const { layoutFor, autopilot, sceneParams } = await scene
  const layout = layoutFor(1440, 900, DESKTOP_TEXT)
  const params = sceneParams({
    width: 1440,
    height: 900,
    dpr: 1,
    seconds: 4.2,
    theme: 0,
    layout,
    lens: autopilot(4.2, layout)
  })
  const fields = read('docs/cover/shaders/lens.wgsl')
    .match(/struct Params \{([^}]*)\}/)[1]
    .match(/\w+(?=:)/g)
  t.deepEqual(Object.keys(params), fields)
})

test('every mobile still frame switches on the scene media query', async t => {
  const { MOBILE_QUERY } = await scene
  const queries = [
    ...read('_coverpage.md').matchAll(/<source media="([^"]+)"/g)
  ].map(([, media]) => media)
  const mobile = queries.filter(media => media.includes('max-width'))
  t.is(mobile.length, 2)
  for (const media of mobile) t.true(media.startsWith(MOBILE_QUERY), media)
})

const MAX_AUTOPLAY_SECONDS = 5

test('the scroll hint stops moving within five seconds', t => {
  const [, seconds, count] = read('docs/cover/cover.css').match(
    /animation: cover-scroll-hint ([\d.]+)s ease-in-out (\d+);/
  )
  t.true(Number(seconds) * Number(count) <= MAX_AUTOPLAY_SECONDS)
})

test('the install command wraps instead of hiding the package name', t => {
  const rule = read('docs/cover/cover.css').match(
    /\.cover__command code \{([^}]*)\}/
  )[1]
  t.notRegex(rule, /text-overflow|white-space: nowrap|overflow: hidden/)
})

test('the install command breaks only between words', t => {
  const command = read('_coverpage.md').match(
    /<code data-command>(.*?)<\/code>/
  )[1]
  for (const word of command.replace(/<[^>]+>/g, '').split(' ')) {
    if (word.includes('-')) {
      t.true(command.includes(`<span class="cover__word">${word}</span>`), word)
    }
  }
  t.regex(
    read('docs/cover/cover.css'),
    /\.cover__word \{ white-space: nowrap; \}/
  )
})
