import { lensShader } from './shaders.js'
import {
  BEST_FRAME_SECONDS,
  createLensEffect,
  layoutFor,
  sceneParams,
  stepLens
} from './scene.js'

const VGPU_URL = 'https://cdn.jsdelivr.net/npm/vgpu@0.6.0/+esm'
const DPR_RANGE = [1, 2]
const MAX_STEP_SECONDS = 0.05
const COPIED_MS = 1400

const cover = document.querySelector('[data-cover]')
const canvas = cover.querySelector('canvas')
const textBlock = cover.querySelector('[data-cover-text]')
const copyReset = new WeakMap()

let stopRendering = () => {}

const hasFailed = () => cover.dataset.mode === 'fallback'

function showFallback (reason) {
  cover.dataset.mode = 'fallback'
  cover.dataset.reason = reason
  stopRendering()
}

function wantsFallback () {
  if (new URLSearchParams(window.location.search).has('fallback')) {
    return 'forced'
  }
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return 'reduced-motion'
  }
  if (!('gpu' in navigator)) return 'no-webgpu'
  return null
}

function readTheme () {
  const forced = document.documentElement.dataset.theme
  if (forced === 'light') return 1
  if (forced === 'dark') return 0
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 1 : 0
}

function contentRight (element) {
  const range = document.createRange()
  range.selectNodeContents(element)
  return range.getBoundingClientRect().right
}

function measureLayout () {
  const rect = cover.getBoundingClientRect()
  return layoutFor(rect.width, rect.height, textBoxFor(rect))
}

function textBoxFor (rect) {
  const boxes = [textBlock, ...textBlock.children].map(element =>
    element.getBoundingClientRect()
  )
  const right = Math.max(...boxes.map(box => box.right))
  const top = Math.min(...boxes.map(box => box.top))
  const bottom = Math.max(...boxes.map(box => box.bottom))
  const [wordmark, ...body] = [...textBlock.children]
  const bodyRight = body.length ? Math.max(...body.map(contentRight)) : right
  return {
    right: right - rect.left,
    top: top - rect.top,
    bottom: bottom - rect.top,
    bodyRight: bodyRight - rect.left,
    wordmarkBottom:
      (wordmark?.getBoundingClientRect().bottom ?? bottom) - rect.top
  }
}

async function loadAtlas () {
  const response = await fetch(new URL('./atlas.png', import.meta.url))
  const bitmap = await window.createImageBitmap(await response.blob(), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none'
  })
  const scratch = new window.OffscreenCanvas(bitmap.width, bitmap.height)
  const context = scratch.getContext('2d', { willReadFrequently: true })
  context.drawImage(bitmap, 0, 0)
  const rgba = context.getImageData(0, 0, bitmap.width, bitmap.height).data
  const red = new Uint8Array(bitmap.width * bitmap.height)
  for (let i = 0; i < red.length; i++) red[i] = rgba[i * 4]
  return red
}

async function start () {
  const reason = wantsFallback()
  if (reason) return showFallback(reason)

  const [vgpu, atlasPixels] = await Promise.all([import(VGPU_URL), loadAtlas()])
  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) return showFallback('no-adapter')
  const timing =
    new URLSearchParams(window.location.search).has('timing') &&
    adapter.features.has('timestamp-query')
  const gpu = await vgpu.init(
    timing ? { requiredFeatures: ['timestamp-query'] } : undefined
  )
  gpu.onError?.(error => showFallback(`gpu-error: ${error?.code ?? error}`))
  gpu.lost.then(({ reason }) => showFallback(`device-lost: ${reason}`))

  const canvasSurface = vgpu.surface(gpu, canvas, { dpr: DPR_RANGE })
  const state = createState()
  stepLens(state, 0)
  const fx = createLensEffect(
    vgpu,
    gpu,
    lensShader,
    atlasPixels,
    paramsFor(state, canvasSurface)
  )
  const gpuTimer = timing ? vgpu.timer(gpu) : undefined
  if (gpuTimer) exposeTimings(gpuTimer)

  canvasSurface.onResize(() => {
    state.layout = null
  })
  new window.ResizeObserver(() => {
    state.layout = null
  }).observe(textBlock)
  document.fonts?.ready.then(() => {
    state.layout = null
  })
  bindInput(state)

  let loop = null
  let last = null
  let firstFrame = true
  const tick = frame => {
    const now = performance.now() / 1000
    const step = last === null ? 0 : Math.min(MAX_STEP_SECONDS, now - last)
    last = now
    advance(state, step)
    fx.set({ params: paramsFor(state, canvasSurface) })
    frame.pass(
      gpuTimer
        ? { target: canvasSurface, timer: gpuTimer.span('lens') }
        : canvasSurface,
      fx
    )
    if (firstFrame) {
      firstFrame = false
      window.requestAnimationFrame(() => {
        if (!hasFailed()) cover.dataset.mode = 'live'
      })
    }
  }

  let onScreen = true
  const sync = () => {
    const run =
      !hasFailed() && onScreen && document.visibilityState === 'visible'
    if (run && !loop) {
      last = null
      loop = vgpu.frameLoop(gpu, tick)
    } else if (!run && loop) {
      loop.stop()
      loop = null
    }
  }
  new window.IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting
    sync()
  }).observe(cover)
  document.addEventListener('visibilitychange', sync)
  stopRendering = sync
  sync()
}

function createState () {
  return {
    seconds: BEST_FRAME_SECONDS,
    theme: readTheme(),
    themeTarget: readTheme(),
    layout: measureLayout(),
    lens: null,
    velocityX: 0,
    pointer: null
  }
}

function bindInput (state) {
  cover.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch') return
    const rect = cover.getBoundingClientRect()
    state.pointer = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    }
  })
  cover.addEventListener('pointerleave', () => {
    state.pointer = null
  })
  const updateTheme = () => (state.themeTarget = readTheme())
  window
    .matchMedia('(prefers-color-scheme: light)')
    .addEventListener('change', updateTheme)
  new window.MutationObserver(updateTheme).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme']
  })
}

function advance (state, step) {
  if (!state.layout) state.layout = measureLayout()
  stepLens(state, step)
}

function paramsFor ({ seconds, theme, layout, lens }, canvasSurface) {
  const { dpr, size } = canvasSurface
  return sceneParams({
    width: size[0] / dpr,
    height: size[1] / dpr,
    dpr,
    seconds,
    theme,
    layout,
    lens
  })
}

function exposeTimings (gpuTimer) {
  const samples = (window.__lensGpuMs = [])
  gpuTimer.onResults(spans => {
    if (typeof spans.lens === 'number') samples.push(spans.lens)
  })
}

function scheduleReset (button, reset) {
  const pending = copyReset.get(button)
  if (pending) clearTimeout(pending)
  copyReset.set(
    button,
    setTimeout(() => {
      copyReset.delete(button)
      reset()
    }, COPIED_MS)
  )
}

async function copyText (button, text) {
  try {
    await navigator.clipboard.writeText(text)
    button.dataset.copied = 'true'
    return true
  } catch {
    delete button.dataset.copied
    return false
  }
}

function bindCopy (button, readText, label) {
  const idle = label?.textContent
  button.addEventListener('click', async () => {
    const copied = await copyText(button, readText())
    if (label) label.textContent = copied ? 'Copied' : idle
    if (!copied) return
    scheduleReset(button, () => {
      delete button.dataset.copied
      if (label) label.textContent = idle
    })
  })
}

function setupCopy () {
  const command = cover.querySelector('[data-command]')
  const copyPrompt = cover.querySelector('[data-copy-prompt]')
  bindCopy(cover.querySelector('[data-copy]'), () => command.textContent)
  bindCopy(
    copyPrompt,
    () => copyPrompt.dataset.prompt,
    copyPrompt.querySelector('[data-copy-prompt-label]')
  )
}

setupCopy()
start().catch(error =>
  showFallback(`init-failed: ${error?.code ?? error?.message ?? error}`)
)
