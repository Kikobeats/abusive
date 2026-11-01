'use strict'

const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const { default: test } = require('ava')

const ROOT = join(__dirname, '..')

const WCAG_AA_TEXT = 4.5
const LINEAR_SEGMENT_LIMIT = 0.03928
const LINEAR_SEGMENT_SLOPE = 12.92
const GAMMA_OFFSET = 0.055
const GAMMA_SCALE = 1.055
const GAMMA_EXPONENT = 2.4
const RED_WEIGHT = 0.2126
const GREEN_WEIGHT = 0.7152
const BLUE_WEIGHT = 0.0722
const LUMINANCE_FLARE = 0.05
const CHANNEL_MAX = 255
const HEX_COLOR = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i

const COVER_BG = '--cover-bg'
const COVER_ACCENT = '--cover-accent'
const COVER_ACCENT_INK = '--cover-accent-ink'

const SHARED_TOKENS = {
  '--bg-color': COVER_BG,
  '--primary-color': '--cover-text',
  '--muted-color': '--cover-muted',
  '--border-color': '--cover-border',
  '--accent-color': COVER_ACCENT
}

const READABLE_PAIRS = [
  ['--primary-color', '--bg-color'],
  ['--primary-color', '--surface-color'],
  ['--muted-color', '--bg-color'],
  ['--muted-color', '--surface-color'],
  ['--accent-color', '--bg-color']
]

const readCss = file => readFileSync(join(ROOT, file), 'utf8')

const tokensIn = (css, selector, searchFrom = 0) => {
  const opening = `${selector} {`
  const start = css.indexOf(opening, searchFrom)
  if (start === -1) throw new Error(`no block for ${selector}`)
  const block = css.slice(start + opening.length, css.indexOf('}', start))
  return Object.fromEntries(
    [...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [
      name,
      value.trim()
    ])
  )
}

const stylesheet = readCss('docs/css/style.css')
const coverSheet = readCss('docs/cover/cover.css')

const THEMES = {
  light: {
    style: tokensIn(stylesheet, ':root'),
    cover: tokensIn(coverSheet, ':root[data-theme="light"]')
  },
  dark: {
    style: tokensIn(
      stylesheet,
      ':root',
      stylesheet.indexOf('@media (prefers-color-scheme: dark)')
    ),
    cover: tokensIn(coverSheet, ':root')
  }
}

const linearize = channel => {
  const value = channel / CHANNEL_MAX
  return value <= LINEAR_SEGMENT_LIMIT
    ? value / LINEAR_SEGMENT_SLOPE
    : ((value + GAMMA_OFFSET) / GAMMA_SCALE) ** GAMMA_EXPONENT
}

const luminance = color => {
  const match = color.match(HEX_COLOR)
  if (!match) throw new Error(`not a six digit hex color: ${color}`)
  const [red, green, blue] = match
    .slice(1)
    .map(channel => linearize(parseInt(channel, 16)))
  return RED_WEIGHT * red + GREEN_WEIGHT * green + BLUE_WEIGHT * blue
}

const contrast = (first, second) => {
  const [lighter, darker] = [luminance(first), luminance(second)].sort(
    (a, b) => b - a
  )
  return (lighter + LUMINANCE_FLARE) / (darker + LUMINANCE_FLARE)
}

test('contrast matches the WCAG reference values', t => {
  t.is(contrast('#000000', '#ffffff'), 21)
  t.is(contrast('#ffffff', '#ffffff'), 1)
  t.is(+contrast('#777777', '#ffffff').toFixed(2), 4.48)
})

for (const [theme, { style, cover }] of Object.entries(THEMES)) {
  for (const [foreground, background] of READABLE_PAIRS) {
    test(`${theme}: ${foreground} on ${background} is readable`, t => {
      const ratio = contrast(style[foreground], style[background])
      t.true(ratio >= WCAG_AA_TEXT, `measured ${ratio.toFixed(2)}`)
    })
  }

  test(`${theme}: the accent ink is readable on the accent`, t => {
    const ratio = contrast(cover[COVER_ACCENT_INK], cover[COVER_ACCENT])
    t.true(ratio >= WCAG_AA_TEXT, `measured ${ratio.toFixed(2)}`)
  })

  for (const [styleToken, coverToken] of Object.entries(SHARED_TOKENS)) {
    test(`${theme}: ${styleToken} agrees with ${coverToken}`, t => {
      t.is(style[styleToken].toLowerCase(), cover[coverToken].toLowerCase())
    })
  }
}

test('the cover light theme is the same from the OS setting and from data-theme', t => {
  const fromSystem = tokensIn(
    coverSheet,
    ':root:not([data-theme="dark"])',
    coverSheet.indexOf('@media (prefers-color-scheme: light)')
  )
  t.deepEqual(fromSystem, THEMES.light.cover)
})

test('no colour in the cover shader leans green', t => {
  const shader = readFileSync(
    join(__dirname, '../docs/cover/shaders/lens.wgsl'),
    'utf8'
  )
  const colors = [
    ...shader.matchAll(
      /^const (\w+) = vec3f\(([\d.]+), ([\d.]+), ([\d.]+)\);$/gm
    )
  ]
  t.true(colors.length > 0)
  for (const [, name, red, green, blue] of colors) {
    t.true(
      Number(green) <= Number(blue),
      `${name} has more green (${green}) than blue (${blue}), red ${red}`
    )
  }
})
