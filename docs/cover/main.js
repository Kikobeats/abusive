import { lensShader } from './shaders.js'
import {
  BEST_FRAME_SECONDS,
  MOBILE_QUERY,
  createLensEffect,
  layoutFor,
  sceneParams,
  stepLens
} from './scene.js'

const VGPU_URL = 'https://cdn.jsdelivr.net/npm/vgpu@0.6.0/+esm'
const DPR_RANGE = [1, 2]
const MAX_STEP_SECONDS = 0.05
const LIVE_TIMEOUT_MS = 5000

const prefersLight = window.matchMedia('(prefers-color-scheme: light)')
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
const mobileViewport = window.matchMedia(MOBILE_QUERY)

const readTheme = () => (prefersLight.matches ? 1 : 0)

function contentRight (element) {
  const range = document.createRange()
  range.selectNodeContents(element)
  return range.getBoundingClientRect().right
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

export function mountScene (cover) {
  const canvas = cover.querySelector('canvas')
  const textBlock = cover.querySelector('[data-cover-text]')

  const teardown = new AbortController()
  const { signal } = teardown

  let stopRendering = () => {}
  let release = () => {}
  let liveTimer = null

  const hasFailed = () => cover.dataset.mode === 'fallback'
  const stopped = () => signal.aborted || hasFailed()

  function showFallback (reason) {
    cover.dataset.mode = 'fallback'
    cover.dataset.reason = reason
    stopRendering()
    release()
  }

  function measureLayout () {
    const rect = cover.getBoundingClientRect()
    return layoutFor(
      rect.width,
      rect.height,
      textBoxFor(rect),
      mobileViewport.matches
    )
  }

  function textBoxFor (rect) {
    const boxes = [textBlock, ...textBlock.children].map(element =>
      element.getBoundingClientRect()
    )
    const right = Math.max(...boxes.map(box => box.right))
    const top = Math.min(...boxes.map(box => box.top))
    const bottom = Math.max(...boxes.map(box => box.bottom))
    const [wordmark, ...body] = textBlock.children
    return {
      right: right - rect.left,
      top: top - rect.top,
      bottom: bottom - rect.top,
      bodyRight: Math.max(...body.map(contentRight)) - rect.left,
      wordmarkBottom: wordmark.getBoundingClientRect().bottom - rect.top
    }
  }

  async function start () {
    const [vgpu, atlasPixels] = await Promise.all([
      import(VGPU_URL),
      loadAtlas()
    ])
    if (stopped()) return
    const adapter = await navigator.gpu.requestAdapter()
    if (stopped()) return
    if (!adapter) return showFallback('no-adapter')
    const timing =
      new URLSearchParams(window.location.search).has('timing') &&
      adapter.features.has('timestamp-query')
    const gpu = await vgpu.init(
      timing ? { requiredFeatures: ['timestamp-query'] } : undefined
    )
    if (stopped()) return gpu.dispose()
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
    const textResize = new window.ResizeObserver(() => {
      state.layout = null
    })
    textResize.observe(textBlock)
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
        !stopped() && onScreen && document.visibilityState === 'visible'
      if (run && !loop) {
        last = null
        loop = vgpu.frameLoop(gpu, tick)
      } else if (!run && loop) {
        loop.stop()
        loop = null
      }
    }
    const visibility = new window.IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting
      sync()
    })
    visibility.observe(cover)
    document.addEventListener('visibilitychange', sync, { signal })
    stopRendering = sync
    release = () => {
      release = () => {}
      textResize.disconnect()
      visibility.disconnect()
      gpu.dispose()
    }
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
    prefersLight.addEventListener(
      'change',
      () => {
        state.themeTarget = readTheme()
      },
      { signal }
    )
  }

  function advance (state, step) {
    if (!state.layout) state.layout = measureLayout()
    stepLens(state, step)
  }

  function armTimeout () {
    clearTimeout(liveTimer)
    if (document.visibilityState !== 'visible') return
    liveTimer = setTimeout(() => {
      if (cover.dataset.mode === 'loading') showFallback('timeout')
    }, LIVE_TIMEOUT_MS)
  }

  function destroy () {
    teardown.abort()
    clearTimeout(liveTimer)
    stopRendering()
    release()
  }

  reducedMotion.addEventListener(
    'change',
    () => {
      if (reducedMotion.matches) showFallback('reduced-motion')
    },
    { signal }
  )
  document.addEventListener('visibilitychange', armTimeout, { signal })
  armTimeout()
  start().catch(error =>
    showFallback(`init-failed: ${error?.code ?? error?.message ?? error}`)
  )
  return destroy
}
