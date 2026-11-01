const DEGREES = Math.PI / 180

export const MARK = {
  width: 110,
  height: 54,
  ring: { cy: 27, outer: 24, inner: 11.5 },
  first: 24,
  second: 82,
  strike: { from: -30, to: 30, half: 7, angle: 40 * DEGREES, corner: 1.25 }
}

export const GRADIENT = { top: '#5cb8ff', bottom: '#2b7bff' }

export const ICON = {
  size: 64,
  radius: 14,
  markWidth: 52,
  top: '#16202e',
  bottom: '#060a10',
  edge: '#ffffff'
}

const round = value => +value.toFixed(3)

const circle = (cx, cy, r, sweep) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 ${sweep} ${r * 2} 0a${r} ${r} 0 1 ${sweep} ${
    -r * 2
  } 0Z`

const ring = (cx, { cy, outer, inner }) =>
  circle(cx, cy, outer, 1) + circle(cx, cy, inner, 0)

export const toStrikeFrame = ({ second, ring: { cy }, strike: { angle } }) => {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return (x, y) => [
    round(second + cos * x - sin * y),
    round(cy + sin * x + cos * y)
  ]
}

const strikePath = mark => {
  const { from, to, half, corner: r } = mark.strike
  const point = toStrikeFrame(mark)
  const line = (x, y) => `L${point(x, y).join(' ')}`
  const arc = (x, y) => `A${r} ${r} 0 0 1 ${point(x, y).join(' ')}`
  return [
    `M${point(from + r, -half).join(' ')}`,
    line(to - r, -half),
    arc(to, r - half),
    line(to, half - r),
    arc(to - r, half),
    line(from + r, half),
    arc(from, half - r),
    line(from, r - half),
    arc(from + r, -half),
    'Z'
  ].join('')
}

export const markPath = (mark = MARK) =>
  ring(mark.first, mark.ring) + ring(mark.second, mark.ring) + strikePath(mark)

const gradient = (id, x1, y1, x2, y2, stops) =>
  `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops
    .map(
      ([offset, color, opacity = 1]) =>
        `<stop offset="${offset}" stop-color="${color}"${
          opacity < 1 ? ` stop-opacity="${opacity}"` : ''
        }/>`
    )
    .join('')}</linearGradient>`

export const markGradient = id =>
  gradient(id, 0, 0, MARK.width * 0.35, MARK.height, [
    [0, GRADIENT.top],
    [1, GRADIENT.bottom]
  ])

export const markSvg = () =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MARK.width} ${MARK.height}">` +
  `<defs>${markGradient('m')}</defs>` +
  `<path fill="url(#m)" d="${markPath()}"/>` +
  '</svg>\n'

export const iconMarkTransform = (icon = ICON) => {
  const scale = icon.markWidth / MARK.width
  const x = (icon.size - icon.markWidth) / 2
  const y = (icon.size - MARK.height * scale) / 2
  return `translate(${x} ${round(y)}) scale(${+scale.toFixed(5)})`
}

export const iconSvg = (icon = ICON) => {
  const { size, radius } = icon
  const transform = iconMarkTransform(icon)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">` +
    '<defs>' +
    gradient('t', 0, 0, 0, size, [
      [0, icon.top],
      [1, icon.bottom]
    ]) +
    gradient('e', 0, 0, 0, size * 0.3, [
      [0, icon.edge, 0.14],
      [1, icon.edge, 0]
    ]) +
    markGradient('m') +
    '<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>' +
    '</defs>' +
    `<rect width="${size}" height="${size}" rx="${radius}" fill="url(#t)"/>` +
    `<rect x="0.5" y="0.5" width="${size - 1}" height="${size - 1}" rx="${
      radius - 0.5
    }" fill="none" stroke="url(#e)"/>` +
    `<path fill="${
      GRADIENT.top
    }" opacity="0.35" filter="url(#glow)" transform="${transform}" d="${markPath()}"/>` +
    `<path fill="url(#m)" transform="${transform}" d="${markPath()}"/>` +
    '</svg>\n'
  )
}
