import { encodeLines } from './content.js'
import { ATLAS } from './atlas-layout.js'
import { MARK, toHandleFrame } from '../brand/mark.js'

const MOBILE_BREAKPOINT = 760
export const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`
const DESKTOP_RIGHT_MARGIN = 56
const DESKTOP_TEXT_GAP = 30
const DESKTOP_WORDMARK_GAP = 24
const DESKTOP_WANDER_X = 12
const DESKTOP_TOP_MARGIN = 48
const DESKTOP_BOTTOM_MARGIN = 64
const DESKTOP_CENTER_HEIGHT_RATIO = 0.5
const DESKTOP_SCALE_MIN = 4
const DESKTOP_SCALE_MAX = 12
const DESKTOP_ANGLE = 0
const MOBILE_ANGLE = 0
const ANGLE_SWAY = 0.035
const MOBILE_GUTTER = 16
const MOBILE_SCALE_MAX = 7
const MOBILE_SCALE_MIN = 3
const MOBILE_BOTTOM_MARGIN = 24
const MOBILE_COPY_GAP = 24
const MOBILE_FONT_SIZE = 11
const MOBILE_WANDER_SHARE = 0.6
const MOBILE_WANDER_Y = 6
const DESKTOP_FONT_SIZE = 13
const WIDE_FONT_SIZE = 14
const WIDE_WIDTH = 1800
const DESKTOP_WANDER_Y_MAX = 14
const DESKTOP_WANDER_Y_RATIO = 0.016
const WORDMARK_NUDGE = 4
const DRIFT_PX_PER_SECOND = 7
const RING_SAMPLES = 48
const WANDER_X_WAVES = [
  [0.72, 0.16, -0.5],
  [0.28, 0.37, 1.3]
]
const WANDER_Y_WAVE = [1, 0.21, 0.7]
const SWAY_WAVE = [1, 0.13, 0.4]
const FOLLOW_STIFFNESS = 7
const THEME_SECONDS = 0.45
const MAX_TILT = 0.05
const TILT_PER_VELOCITY = 0.0004
const VELOCITY_SMOOTHING = 6

export const MARK_CENTER = [MARK.size / 2, MARK.size / 2]
const LENS_OFFSET = [MARK.center - MARK_CENTER[0], MARK.center - MARK_CENTER[1]]
const TRAVEL_MARGIN = 24

const span = (low, high, fallback) =>
  low <= high ? [low, high] : [fallback, fallback]

function lensTravel ([left, top, right, bottom], scale, [homeX, homeY]) {
  const ring = MARK.ring.outer * scale
  const [minX, maxX] = span(
    left + ring,
    right - ring,
    homeX + LENS_OFFSET[0] * scale
  )
  const [minY, maxY] = span(
    top + ring,
    bottom - ring,
    homeY + LENS_OFFSET[1] * scale
  )
  return [minX, minY, maxX, maxY]
}

export const BEST_FRAME_SECONDS = 4.2

const clamp = (value, low, high) => Math.min(high, Math.max(low, value))
const wave = ([amplitude, frequency, phase], seconds) =>
  amplitude * Math.sin(seconds * frequency + phase)

const ringSamples = () =>
  Array.from({ length: RING_SAMPLES }, (_, i) => {
    const a = (i / RING_SAMPLES) * Math.PI * 2
    return [
      MARK.center + MARK.ring.outer * Math.cos(a),
      MARK.center + MARK.ring.outer * Math.sin(a)
    ]
  })

const handleCorners = () => {
  const { from, to, half } = MARK.handle
  const point = toHandleFrame(MARK)
  return [
    point(from, -half),
    point(to, -half),
    point(to, half),
    point(from, half)
  ]
}

export const MARK_OUTLINE = [...ringSamples(), ...handleCorners()].map(
  ([x, y]) => [x - MARK_CENTER[0], y - MARK_CENTER[1]]
)

export function markBounds (angle) {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const box = {
    left: Infinity,
    right: -Infinity,
    top: Infinity,
    bottom: -Infinity
  }
  for (const [x, y] of MARK_OUTLINE) {
    const rx = c * x - s * y
    const ry = s * x + c * y
    box.left = Math.min(box.left, rx)
    box.right = Math.max(box.right, rx)
    box.top = Math.min(box.top, ry)
    box.bottom = Math.max(box.bottom, ry)
  }
  return box
}

export function swayBounds (angle) {
  const boxes = [angle - ANGLE_SWAY, angle, angle + ANGLE_SWAY].map(markBounds)
  return {
    left: Math.min(...boxes.map(b => b.left)),
    right: Math.max(...boxes.map(b => b.right)),
    top: Math.min(...boxes.map(b => b.top)),
    bottom: Math.max(...boxes.map(b => b.bottom))
  }
}

function mobileLayout (width, height, textBox) {
  const top = textBox.bottom
  const units = swayBounds(MOBILE_ANGLE)
  const floor = height - MOBILE_BOTTOM_MARGIN
  const widthScale = (width - 2 * MOBILE_GUTTER) / (units.right - units.left)
  const heightScale =
    (floor - top - MOBILE_COPY_GAP) / (units.bottom - units.top)
  const scale = Math.min(
    widthScale,
    MOBILE_SCALE_MAX,
    Math.max(MOBILE_SCALE_MIN, heightScale)
  )
  const markWidth = (units.right - units.left) * scale
  const markHeight = (units.bottom - units.top) * scale
  const boxTop = top + Math.max(MOBILE_COPY_GAP, (floor - top - markHeight) / 2)
  const centerY = boxTop - units.top * scale
  const centerX = (width - markWidth) / 2 - units.left * scale
  const wanderX =
    ((width - markWidth) / 2 - MOBILE_GUTTER) * MOBILE_WANDER_SHARE
  return {
    mobile: true,
    angle: MOBILE_ANGLE,
    fontSize: MOBILE_FONT_SIZE,
    scrim: [0, top],
    home: [centerX, centerY],
    travel: lensTravel(
      [
        MOBILE_GUTTER,
        top + MOBILE_COPY_GAP,
        width - MOBILE_GUTTER,
        height - TRAVEL_MARGIN
      ],
      scale,
      [centerX, centerY]
    ),
    wander: [wanderX, MOBILE_WANDER_Y],
    scale,
    markSize: [markWidth, markHeight]
  }
}

function outlineClearsWordmark (angle, scale, homeX, homeY, wordmark) {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return MARK_OUTLINE.every(([x, y]) => {
    const px = homeX + (c * x - s * y) * scale
    const py = homeY + (s * x + c * y) * scale
    return (
      py > wordmark.bottom + DESKTOP_WORDMARK_GAP ||
      px > wordmark.right + DESKTOP_WORDMARK_GAP
    )
  })
}

function desktopLayout (width, height, textBox) {
  const { bodyRight } = textBox
  const wordmark = { right: textBox.right, bottom: textBox.wordmarkBottom }
  const units = swayBounds(DESKTOP_ANGLE)
  const sceneLeft = bodyRight + DESKTOP_TEXT_GAP + DESKTOP_WANDER_X
  const sceneRight = width - DESKTOP_RIGHT_MARGIN - DESKTOP_WANDER_X
  const homeY = height * DESKTOP_CENTER_HEIGHT_RATIO
  const widthScale = (sceneRight - sceneLeft) / (units.right - units.left)
  const heightScale = Math.min(
    (homeY - DESKTOP_TOP_MARGIN) / -units.top,
    (height - DESKTOP_BOTTOM_MARGIN - homeY) / units.bottom
  )
  const scale = Math.max(
    DESKTOP_SCALE_MIN,
    Math.min(DESKTOP_SCALE_MAX, widthScale, heightScale)
  )
  const markWidth = (units.right - units.left) * scale
  const room = Math.max(0, sceneRight - sceneLeft - markWidth)
  let homeX = sceneLeft - units.left * scale + room / 2
  while (
    !outlineClearsWordmark(DESKTOP_ANGLE, scale, homeX, homeY, wordmark) &&
    homeX < sceneRight
  ) {
    homeX += WORDMARK_NUDGE
  }
  const wander = [
    DESKTOP_WANDER_X,
    Math.min(DESKTOP_WANDER_Y_MAX, height * DESKTOP_WANDER_Y_RATIO)
  ]
  return {
    mobile: false,
    angle: DESKTOP_ANGLE,
    fontSize: width > WIDE_WIDTH ? WIDE_FONT_SIZE : DESKTOP_FONT_SIZE,
    scrim: [bodyRight, 0],
    home: [homeX, homeY],
    travel: lensTravel(
      [
        bodyRight + DESKTOP_TEXT_GAP,
        TRAVEL_MARGIN,
        width - TRAVEL_MARGIN,
        height - TRAVEL_MARGIN
      ],
      scale,
      [homeX, homeY]
    ),
    wander,
    scale,
    markSize: [markWidth, (units.bottom - units.top) * scale]
  }
}

export function layoutFor (
  width,
  height,
  textBox,
  mobile = width < MOBILE_BREAKPOINT
) {
  return mobile
    ? mobileLayout(width, height, textBox)
    : desktopLayout(width, height, textBox)
}

export function autopilot (seconds, layout) {
  const [hx, hy] = layout.home
  const [wx, wy] = layout.wander
  const wanderX = WANDER_X_WAVES.reduce(
    (sum, shape) => sum + wave(shape, seconds),
    0
  )
  return {
    x: hx + wx * wanderX,
    y: hy + wy * wave(WANDER_Y_WAVE, seconds),
    angle: layout.angle + ANGLE_SWAY * wave(SWAY_WAVE, seconds)
  }
}

export function lensUnder (pointer, layout, angle) {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const [x, y] = LENS_OFFSET
  const [minX, minY, maxX, maxY] = layout.travel
  const lensX = Math.min(maxX, Math.max(minX, pointer.x))
  const lensY = Math.min(maxY, Math.max(minY, pointer.y))
  return {
    x: lensX - (c * x - s * y) * layout.scale,
    y: lensY - (s * x + c * y) * layout.scale
  }
}

export function stepLens (state, step) {
  state.seconds += step
  const auto = autopilot(state.seconds, state.layout)
  const goal = state.pointer
    ? lensUnder(state.pointer, state.layout, auto.angle)
    : auto
  if (!state.lens) state.lens = { ...auto }

  const blend = 1 - Math.exp(-FOLLOW_STIFFNESS * step)
  const previousX = state.lens.x
  state.lens.x += (goal.x - state.lens.x) * blend
  state.lens.y += (goal.y - state.lens.y) * blend
  if (step > 0) {
    const velocity = (state.lens.x - previousX) / step
    state.velocityX +=
      (velocity - state.velocityX) * Math.min(1, step * VELOCITY_SMOOTHING)
  }
  const tilt = clamp(state.velocityX * TILT_PER_VELOCITY, -MAX_TILT, MAX_TILT)
  state.lens.angle = auto.angle + tilt

  const themeStep = step / THEME_SECONDS
  state.theme += clamp(state.themeTarget - state.theme, -themeStep, themeStep)
}

export function driftAt (seconds) {
  return seconds * DRIFT_PX_PER_SECOND
}

export function sceneParams ({
  width,
  height,
  dpr,
  seconds,
  theme,
  layout,
  lens
}) {
  return {
    resolution: [Math.round(width * dpr), Math.round(height * dpr)],
    dpr,
    time: seconds,
    lens: [lens.x, lens.y, layout.scale, lens.angle],
    theme,
    fontSize: layout.fontSize,
    scrim: layout.scrim,
    drift: driftAt(seconds)
  }
}

function uploadR8 (gpu, texture, format, data, width, height) {
  const handle = texture(gpu, {
    kind: '2d',
    size: [width, height],
    format,
    usage: ['texture_binding', 'copy_dst'],
    label: `lens-${format}`
  })
  gpu.device.gpu.queue.writeTexture(
    { texture: handle.gpu },
    data,
    { bytesPerRow: width },
    [width, height]
  )
  return handle
}

export function createLensEffect (
  api,
  gpu,
  shader,
  atlasPixels,
  initialParams
) {
  const atlasWidth = ATLAS.columns * ATLAS.cellWidth
  const atlasHeight = ATLAS.rows * ATLAS.cellHeight
  const atlas = uploadR8(
    gpu,
    api.texture,
    'r8unorm',
    atlasPixels,
    atlasWidth,
    atlasHeight
  )
  const encoded = encodeLines()
  const lines = uploadR8(
    gpu,
    api.texture,
    'r8uint',
    encoded.data,
    encoded.width,
    encoded.height
  )
  const atlasSampler = api.sampler(gpu, {
    minFilter: 'linear',
    magFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge'
  })
  return api.effect(gpu, shader, {
    label: 'sibling-lens',
    set: { params: initialParams, atlas, atlasSampler, lines }
  })
}
