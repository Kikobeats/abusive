const DEGREES = Math.PI / 180

export const MARK = {
  size: 60,
  center: 24,
  ring: { outer: 24, inner: 15.8 },
  dot: 8,
  handle: { from: 20, to: 46, half: 4, angle: 45 * DEGREES, corner: 0.6 }
}

export const GRADIENT = { top: '#3cb9fd', bottom: '#1274fe', slant: 0.35 }

export const ICON = {
  size: 64,
  radius: 14,
  markSize: 44,
  top: '#16202e',
  bottom: '#060a10',
  edge: '#ffffff',
  edgeOpacity: 0.14,
  edgeFade: 0.3,
  glowBlur: 3,
  glowOpacity: 0.35
}

const PATH_DECIMALS = 3
const SCALE_DECIMALS = 5

const round = value => +value.toFixed(PATH_DECIMALS)

const circle = (cx, cy, r, sweep) =>
  `M${round(cx - r)} ${cy}a${r} ${r} 0 1 ${sweep} ${round(
    r * 2
  )} 0a${r} ${r} 0 1 ${sweep} ${round(-r * 2)} 0Z`

export const toHandleFrame = ({ center, handle: { angle } }) => {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return (x, y) => [
    round(center + cos * x - sin * y),
    round(center + sin * x + cos * y)
  ]
}

const handlePath = mark => {
  const { from, to, half, corner: r } = mark.handle
  const point = toHandleFrame(mark)
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

export const markPath = (mark = MARK) => {
  const { center, ring, dot } = mark
  return (
    circle(center, center, ring.outer, 1) +
    circle(center, center, ring.inner, 0) +
    circle(center, center, dot, 1) +
    handlePath(mark)
  )
}

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
  gradient(id, 0, 0, MARK.size * GRADIENT.slant, MARK.size, [
    [0, GRADIENT.top],
    [1, GRADIENT.bottom]
  ])

export const markSvg = () =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MARK.size} ${MARK.size}">` +
  `<defs>${markGradient('m')}</defs>` +
  `<path fill="url(#m)" d="${markPath()}"/>` +
  '</svg>\n'

export const iconMarkTransform = (icon = ICON) => {
  const scale = icon.markSize / MARK.size
  const offset = (icon.size - icon.markSize) / 2
  return `translate(${offset} ${offset}) scale(${+scale.toFixed(
    SCALE_DECIMALS
  )})`
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
    gradient('e', 0, 0, 0, size * icon.edgeFade, [
      [0, icon.edge, icon.edgeOpacity],
      [1, icon.edge, 0]
    ]) +
    markGradient('m') +
    `<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${icon.glowBlur}"/></filter>` +
    '</defs>' +
    `<rect width="${size}" height="${size}" rx="${radius}" fill="url(#t)"/>` +
    `<rect x="0.5" y="0.5" width="${size - 1}" height="${size - 1}" rx="${
      radius - 0.5
    }" fill="none" stroke="url(#e)"/>` +
    `<path fill="${GRADIENT.top}" opacity="${
      icon.glowOpacity
    }" filter="url(#glow)" transform="${transform}" d="${markPath()}"/>` +
    `<path fill="url(#m)" transform="${transform}" d="${markPath()}"/>` +
    '</svg>\n'
  )
}
