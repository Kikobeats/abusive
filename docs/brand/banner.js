import { GRADIENT, MARK, markGradient, markPath } from './mark.js'

export const BANNER = {
  width: 1200,
  height: 630,
  scale: 2,
  background: '#0c0f14',
  text: '#e8ecf3',
  accent: '#4da3ff',
  chip: '#161b23',
  chipBorder: '#2a313c',
  wordmark: { text: 'abusive', size: 132, tracking: -0.035 },
  tagline: { text: 'One free plan per person.', size: 40 },
  command: {
    prompt: '$ ',
    text: 'npm install abusive free-email-domains',
    size: 26
  },
  markToXHeight: 2.3,
  gapToMarkWidth: 0.16,
  glowOffset: 10,
  lockupCenter: 196,
  taglineBaseline: 368,
  chipTop: 426,
  chipPadding: [18, 30]
}

const CORNER_GLOW = [
  [0, 0.32],
  [0.2, 0.22],
  [0.4, 0.12],
  [0.6, 0.05],
  [0.8, 0.012],
  [1, 0]
]

const translate = (x, y) => `translate(${+x.toFixed(2)} ${+y.toFixed(2)})`

const lockup = ({ fonts, textPath }) => {
  const { wordmark } = BANNER
  const word = textPath({ font: fonts.display, ...wordmark })
  const xHeight =
    (fonts.display.tables.os2.sxHeight / fonts.display.unitsPerEm) *
    wordmark.size
  const markScale = (xHeight * BANNER.markToXHeight) / MARK.size
  const markWidth = MARK.size * markScale
  const gap = markWidth * BANNER.gapToMarkWidth
  const left = (BANNER.width - (markWidth + gap + word.width)) / 2
  const baseline = BANNER.lockupCenter + xHeight / 2
  const markTop = BANNER.lockupCenter - (MARK.size * markScale) / 2
  const markTransform = `${translate(left, markTop)} scale(${+markScale.toFixed(
    4
  )})`
  return (
    `<g filter="url(#glow)" opacity="0.55" transform="${translate(
      -BANNER.glowOffset,
      -BANNER.glowOffset
    )}"><path fill="${
      GRADIENT.top
    }" transform="${markTransform}" d="${markPath()}"/></g>` +
    '<g filter="url(#lift)">' +
    `<path fill="url(#m)" transform="${markTransform}" d="${markPath()}"/>` +
    `<path fill="${BANNER.text}" transform="${translate(
      left + markWidth + gap,
      baseline
    )}" d="${word.d}"/>` +
    '</g>'
  )
}

const tagline = ({ fonts, textPath }) => {
  const line = textPath({ font: fonts.body, ...BANNER.tagline })
  return `<path fill="${BANNER.text}" transform="${translate(
    (BANNER.width - line.width) / 2,
    BANNER.taglineBaseline
  )}" d="${line.d}"/>`
}

const command = ({ fonts, textPath }) => {
  const { prompt, text, size } = BANNER.command
  const [padY, padX] = BANNER.chipPadding
  const promptPath = textPath({ font: fonts.mono, text: prompt, size })
  const textRun = textPath({ font: fonts.mono, text, size })
  const width = promptPath.width + textRun.width + padX * 2
  const height = size + padY * 2
  const left = (BANNER.width - width) / 2
  const baseline = BANNER.chipTop + padY + size * 0.78
  return (
    `<rect x="${left}" y="${BANNER.chipTop}" width="${width}" height="${height}" rx="14" fill="${BANNER.chip}" stroke="${BANNER.chipBorder}"/>` +
    `<path fill="${BANNER.accent}" transform="${translate(
      left + padX,
      baseline
    )}" d="${promptPath.d}"/>` +
    `<path fill="${BANNER.text}" transform="${translate(
      left + padX + promptPath.width,
      baseline
    )}" d="${textRun.d}"/>`
  )
}

export const bannerSvg = context =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BANNER.width} ${BANNER.height}" width="${BANNER.width}" height="${BANNER.height}">` +
  '<defs>' +
  markGradient('m') +
  `<radialGradient id="corner" cx="0" cy="0" r="${
    BANNER.width * 0.62
  }" gradientUnits="userSpaceOnUse">${CORNER_GLOW.map(
    ([offset, opacity]) =>
      `<stop offset="${offset}" stop-color="${GRADIENT.bottom}" stop-opacity="${opacity}"/>`
  ).join('')}</radialGradient>` +
  '<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="22"/></filter>' +
  '<filter id="lift" x="-10%" y="-20%" width="120%" height="150%"><feDropShadow dx="2" dy="5" stdDeviation="4" flood-color="#000" flood-opacity="0.6"/></filter>' +
  '</defs>' +
  `<rect width="${BANNER.width}" height="${BANNER.height}" fill="${BANNER.background}"/>` +
  `<rect width="${BANNER.width}" height="${BANNER.height}" fill="url(#corner)"/>` +
  lockup(context) +
  tagline(context) +
  command(context) +
  '</svg>\n'
