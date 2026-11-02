'use strict'

const { register } = require('node:module')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')

const { Window } = require('happy-dom')
const { default: test } = require('ava')

register('./fixtures/cover/vgpu-loader.mjs', pathToFileURL(__filename))

const ROOT = join(__dirname, '..')
const COVER_MAIN = pathToFileURL(join(ROOT, 'docs/cover/main.js')).href
const COVER_COPY = pathToFileURL(join(ROOT, 'docs/cover/copy.js')).href
const COVER_MARKUP = readFileSync(join(ROOT, '_coverpage.md'), 'utf8')
const SITE = 'https://abusive.js.org/'
const COVER_SIZE = { width: 1440, height: 900 }
const TEXT_BOX = { left: 96, top: 247, right: 614, bottom: 653 }
const WORDMARK_BOTTOM = 339
const BODY_RIGHT = 512
const COPIED_MS = 1400
const LIVE_TIMEOUT_MS = 5000
const BEST_FRAME_SECONDS = 4.2
const MAX_STEP_SECONDS = 0.05

let instance = 0

const rect = ({ left = 0, top = 0, right, bottom }) => ({
  left,
  top,
  right,
  bottom,
  width: right - left,
  height: bottom - top
})

const setGlobal = (name, value) =>
  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
    writable: true
  })

const createGpuHarness = ({ adapter, initError, initGate, onError = true }) => {
  const harness = {
    initOptions: 'not called',
    params: [],
    passes: 0,
    loop: null,
    loops: 0,
    adapter
  }
  harness.init = async options => {
    harness.initOptions = options
    if (initError !== undefined) throw initError
    await initGate
    const gpu = {
      dispose: () => (harness.disposed = true),
      lost: new Promise(resolve => {
        harness.loseDevice = reason => resolve({ reason })
      }),
      device: { gpu: { queue: { writeTexture () {} } } }
    }
    if (onError) gpu.onError = callback => (harness.raiseError = callback)
    return gpu
  }
  harness.surface = options => {
    harness.surfaceOptions = options
    return {
      dpr: 1,
      size: [COVER_SIZE.width, COVER_SIZE.height],
      onResize: callback => (harness.resize = callback)
    }
  }
  harness.effect = set => {
    harness.params.push(set.params)
    return { set: update => harness.params.push(update.params) }
  }
  harness.frameLoop = tick => {
    harness.loops++
    harness.loop = tick
    return { stop: () => (harness.loop = null) }
  }
  harness.timer = () => ({
    span: name => name,
    onResults: callback => (harness.timerResults = callback)
  })
  return harness
}

const openCover = async ({
  url = SITE,
  gpu = true,
  adapter = { features: new Set() },
  initError,
  initGate,
  atlasGate,
  onError,
  fallback,
  mobile = false,
  prefersLight = false,
  fonts,
  clipboard = () => Promise.resolve()
} = {}) => {
  const window = new Window({ url })
  const { document } = window
  document.body.innerHTML = COVER_MARKUP
  if (fonts) document.fonts = { ready: fonts }

  const cover = document.querySelector('[data-cover]')
  if (fallback) {
    cover.dataset.mode = 'fallback'
    cover.dataset.reason = fallback
  }
  const textBlock = cover.querySelector('[data-cover-text]')
  const measured = { cover: 0 }
  cover.getBoundingClientRect = () => {
    measured.cover++
    return rect({ right: COVER_SIZE.width, bottom: COVER_SIZE.height })
  }
  textBlock.getBoundingClientRect = () => rect(TEXT_BOX)
  const [wordmark, ...body] = textBlock.children
  wordmark.getBoundingClientRect = () =>
    rect({ ...TEXT_BOX, bottom: WORDMARK_BOTTOM })
  for (const element of body) {
    element.getBoundingClientRect = () => rect(TEXT_BOX)
  }
  document.createRange = () => ({
    selectNodeContents () {},
    getBoundingClientRect: () => rect({ ...TEXT_BOX, right: BODY_RIGHT })
  })

  const media = { light: prefersLight, listeners: [] }
  window.matchMedia = query => ({
    get matches () {
      if (query === '(max-width: 759px)') return mobile
      return query === '(prefers-color-scheme: light)' && media.light
    },
    addEventListener: (type, listener) => {
      if (type === 'change') media.listeners.push(listener)
    }
  })
  const setPrefersLight = value => {
    media.light = value
    media.listeners.forEach(listener => listener())
  }

  const frames = []
  window.requestAnimationFrame = callback => frames.push(callback)
  const flushFrames = () => frames.splice(0).forEach(callback => callback())

  const observers = { intersection: null, resize: null }
  window.IntersectionObserver = class {
    constructor (callback) {
      observers.intersection = callback
    }

    observe () {}
  }
  window.ResizeObserver = class {
    constructor (callback) {
      observers.resize = callback
    }

    observe () {}
  }
  window.createImageBitmap = async () => ({ width: 2, height: 1 })
  window.OffscreenCanvas = class {
    getContext () {
      return {
        drawImage () {},
        getImageData: () => ({ data: new Uint8ClampedArray(8) })
      }
    }
  }

  const adapterRequests = { count: 0 }
  const clock = { now: 0 }
  const timers = new Map()
  let nextTimer = 0
  const copied = []

  setGlobal('window', window)
  setGlobal('document', document)
  setGlobal('navigator', {
    ...(gpu
      ? {
          gpu: {
            requestAdapter: async () => {
              adapterRequests.count++
              return adapter
            }
          }
        }
      : {}),
    clipboard: {
      writeText: text => {
        copied.push(text)
        return clipboard(text)
      }
    }
  })
  setGlobal('fetch', async () => {
    await atlasGate
    return { blob: async () => ({}) }
  })
  setGlobal('performance', { now: () => clock.now * 1000 })
  setGlobal('setTimeout', (callback, ms) => {
    timers.set(++nextTimer, { callback, ms })
    return nextTimer
  })
  setGlobal('clearTimeout', id => timers.delete(id))
  const runTimers = delay => {
    for (const [id, { callback, ms }] of [...timers]) {
      if (ms !== delay) continue
      timers.delete(id)
      callback()
    }
  }
  const pendingDelays = () =>
    [...timers.values()].map(({ ms }) => ms).sort((a, b) => a - b)

  const gpuHarness = createGpuHarness({
    adapter,
    initError,
    initGate,
    onError
  })
  setGlobal('gpuHarness', gpuHarness)

  instance++
  await import(`${COVER_COPY}?instance=${instance}`)
  if (!fallback) await import(`${COVER_MAIN}?instance=${instance}`)
  await settle()

  const tick = (seconds = 0) => {
    clock.now += seconds
    gpuHarness.loop({ pass: () => gpuHarness.passes++ })
  }
  const lastParams = () => gpuHarness.params.at(-1)
  const pointer = (type, init) =>
    cover.dispatchEvent(new window.PointerEvent(type, init))

  return {
    window,
    document,
    cover,
    gpu: gpuHarness,
    observers,
    measured,
    adapterRequests,
    copied,
    timers,
    tick,
    lastParams,
    pointer,
    flushFrames,
    pendingFrames: () => frames.length,
    runTimers,
    pendingDelays,
    setPrefersLight,
    close: () => window.close()
  }
}

const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise(resolve => setImmediate(resolve))
  }
}

const fallbackReason = async options => {
  const page = await openCover(options)
  const { mode, reason } = page.cover.dataset
  page.close()
  return { mode, reason }
}

test.serial('a GPU without an adapter keeps the still frame', async t => {
  t.deepEqual(await fallbackReason({ adapter: null }), {
    mode: 'fallback',
    reason: 'no-adapter'
  })
})

test.serial(
  'the copy buttons work on the still frame, without the renderer',
  async t => {
    const page = await openCover({ fallback: 'no-webgpu' })
    await click(page, '[data-copy]')
    t.deepEqual(page.copied, ['npm install abusive free-email-domains'])
    page.close()
  }
)

test.serial(
  'the layout is mobile exactly when the mobile media query matches',
  async t => {
    const wide = await openCover({ mobile: true })
    t.is(wide.lastParams().fontSize, 11)
    wide.close()
    const desktop = await openCover()
    t.is(desktop.lastParams().fontSize, 13)
    desktop.close()
  }
)

test.serial(
  'a failed start reports the error code, else its message, else the value',
  async t => {
    t.is(
      (await fallbackReason({ initError: { code: 'E_GPU', message: 'x' } }))
        .reason,
      'init-failed: E_GPU'
    )
    t.is(
      (await fallbackReason({ initError: new Error('no device') })).reason,
      'init-failed: no device'
    )
    t.is(
      (await fallbackReason({ initError: 'boom' })).reason,
      'init-failed: boom'
    )
  }
)

test.serial('the cover goes live one frame after its first draw', async t => {
  const page = await openCover()
  t.is(page.cover.dataset.mode, 'loading')
  page.tick()
  t.is(page.gpu.passes, 1)
  t.is(page.cover.dataset.mode, 'loading')
  page.flushFrames()
  t.is(page.cover.dataset.mode, 'live')
  page.tick(0.016)
  page.tick(0.016)
  t.is(page.pendingFrames(), 0)
  t.is(page.cover.dataset.mode, 'live')
  t.deepEqual(page.gpu.surfaceOptions, { dpr: [1, 2] })
  page.close()
})

test.serial(
  'a GPU error before the first frame lands keeps the still frame',
  async t => {
    const page = await openCover()
    page.tick()
    page.gpu.raiseError({ code: 'OOM' })
    page.flushFrames()
    t.is(page.cover.dataset.mode, 'fallback')
    t.is(page.cover.dataset.reason, 'gpu-error: OOM')
    t.is(page.gpu.loop, null)
    page.close()
  }
)

test.serial('a GPU error without a code reports the error itself', async t => {
  const page = await openCover()
  page.gpu.raiseError('validation')
  t.is(page.cover.dataset.reason, 'gpu-error: validation')
  page.close()
})

test.serial('a GPU without error reporting still renders', async t => {
  const page = await openCover({ onError: false })
  page.tick()
  page.flushFrames()
  t.is(page.cover.dataset.mode, 'live')
  page.close()
})

test.serial(
  'a lost device stops the loop and shows the still frame',
  async t => {
    const page = await openCover()
    page.tick()
    page.flushFrames()
    page.gpu.loseDevice('destroyed')
    await settle()
    t.is(page.cover.dataset.mode, 'fallback')
    t.is(page.cover.dataset.reason, 'device-lost: destroyed')
    t.is(page.gpu.loop, null)
    page.observers.intersection([{ isIntersecting: true }])
    t.is(page.gpu.loop, null)
    page.close()
  }
)

test.serial(
  'rendering pauses off screen or in a hidden tab and resumes without a jump',
  async t => {
    const page = await openCover()
    t.is(page.gpu.loops, 1)
    page.tick()
    page.tick(0.02)
    const time = page.lastParams().time
    page.observers.intersection([{ isIntersecting: false }])
    t.is(page.gpu.loop, null)
    page.observers.intersection([{ isIntersecting: true }])
    t.is(page.gpu.loops, 2)
    page.tick(30)
    t.is(page.lastParams().time, time)

    Object.defineProperty(page.document, 'visibilityState', {
      value: 'hidden',
      configurable: true
    })
    page.document.dispatchEvent(new page.window.Event('visibilitychange'))
    t.is(page.gpu.loop, null)
    Object.defineProperty(page.document, 'visibilityState', {
      value: 'visible',
      configurable: true
    })
    page.document.dispatchEvent(new page.window.Event('visibilitychange'))
    t.is(page.gpu.loops, 3)
    page.document.dispatchEvent(new page.window.Event('visibilitychange'))
    t.is(page.gpu.loops, 3)
    t.not(page.gpu.loop, null)
    page.close()
  }
)

test.serial(
  'a long gap between frames advances the scene by one capped step',
  async t => {
    const page = await openCover()
    page.tick()
    t.is(page.lastParams().time, BEST_FRAME_SECONDS)
    page.tick(10)
    t.true(
      Math.abs(page.lastParams().time - BEST_FRAME_SECONDS - MAX_STEP_SECONDS) <
        1e-9
    )
    page.tick(0.01)
    t.true(
      Math.abs(
        page.lastParams().time - BEST_FRAME_SECONDS - MAX_STEP_SECONDS - 0.01
      ) < 1e-9
    )
    page.close()
  }
)

const lensAfter = async (events, page) => {
  page.tick()
  events(page)
  for (let i = 0; i < 100; i++) page.tick(0.05)
  return page.lastParams().lens[0]
}

test.serial(
  'a mouse moves the lens, a finger does not, and leaving lets it go',
  async t => {
    const resting = await openCover()
    const restX = await lensAfter(() => {}, resting)
    resting.close()

    const mouse = await openCover()
    const mouseX = await lensAfter(
      page =>
        page.pointer('pointermove', {
          pointerType: 'mouse',
          clientX: 1200,
          clientY: 450
        }),
      mouse
    )
    t.true(mouseX > restX + 100, `mouse ${mouseX} rest ${restX}`)
    mouse.pointer('pointerleave', {})
    for (let i = 0; i < 100; i++) mouse.tick(0.05)
    t.true(Math.abs(mouse.lastParams().lens[0] - restX) < 30)
    mouse.close()

    const finger = await openCover()
    const fingerX = await lensAfter(
      page =>
        page.pointer('pointermove', {
          pointerType: 'touch',
          clientX: 1200,
          clientY: 450
        }),
      finger
    )
    t.is(fingerX, restX)
    finger.close()
  }
)

const themeAfter = async (page, change) => {
  page.tick()
  change(page)
  await settle()
  for (let i = 0; i < 20; i++) page.tick(0.05)
  return page.lastParams().theme
}

const initialTheme = async options => {
  const page = await openCover(options)
  const { theme } = page.lastParams()
  page.close()
  return theme
}

test.serial('the theme follows the OS setting, live', async t => {
  t.is(await initialTheme({ prefersLight: true }), 1)
  t.is(await initialTheme(), 0)

  const page = await openCover()
  t.is(await themeAfter(page, cover => cover.setPrefersLight(true)), 1)
  t.is(await themeAfter(page, cover => cover.setPrefersLight(false)), 0)
  page.close()
})

test.serial(
  'the layout is measured again only after something resizes',
  async t => {
    let fontsLoaded
    const fonts = new Promise(resolve => (fontsLoaded = resolve))
    const page = await openCover({ fonts })
    page.tick()
    const measured = page.measured.cover
    for (let i = 0; i < 10; i++) page.tick(0.016)
    t.is(page.measured.cover, measured)

    for (const invalidate of [
      () => page.gpu.resize(),
      () => page.observers.resize(),
      async () => {
        fontsLoaded()
        await settle()
      }
    ]) {
      const before = page.measured.cover
      await invalidate()
      t.is(page.measured.cover, before)
      page.tick(0.016)
      page.tick(0.016)
      t.is(page.measured.cover, before + 1)
    }
    page.close()
  }
)

test.serial(
  '?timing asks for timestamps only where the GPU has them, and keeps numeric spans',
  async t => {
    const timed = new Set(['timestamp-query'])
    const page = await openCover({
      url: `${SITE}?timing`,
      adapter: { features: timed }
    })
    t.deepEqual(page.gpu.initOptions, { requiredFeatures: ['timestamp-query'] })
    page.gpu.timerResults({ lens: 1.5 })
    page.gpu.timerResults({ lens: undefined })
    page.gpu.timerResults({})
    t.deepEqual(page.window.__lensGpuMs, [1.5])
    page.close()

    const missing = await openCover({
      url: `${SITE}?timing`,
      adapter: { features: new Set() }
    })
    t.is(missing.gpu.initOptions, undefined)
    t.is(missing.window.__lensGpuMs, undefined)
    missing.close()

    const off = await openCover({ adapter: { features: timed } })
    t.is(off.gpu.initOptions, undefined)
    t.is(off.window.__lensGpuMs, undefined)
    off.close()
  }
)

const click = async (page, selector) => {
  page.cover.querySelector(selector).click()
  await settle()
}

const status = page => page.cover.querySelector('[role="status"]').textContent

test.serial(
  'copying the command marks the button and announces it until the reset',
  async t => {
    const page = await openCover()
    const button = page.cover.querySelector('[data-copy]')
    t.is(status(page), '')
    await click(page, '[data-copy]')
    t.deepEqual(page.copied, ['npm install abusive free-email-domains'])
    t.is(button.dataset.copied, 'true')
    t.is(status(page), 'Copied to clipboard')
    t.deepEqual(page.pendingDelays(), [COPIED_MS, COPIED_MS, LIVE_TIMEOUT_MS])
    page.runTimers(COPIED_MS)
    t.false('copied' in button.dataset)
    t.is(status(page), '')
    page.close()
  }
)

test.serial(
  'a second copy restarts both resets instead of stacking them',
  async t => {
    const page = await openCover()
    const button = page.cover.querySelector('[data-copy-prompt]')
    const label = button.querySelector('[data-copy-prompt-label]')
    await click(page, '[data-copy-prompt]')
    t.is(page.copied[0], button.dataset.prompt)
    t.is(label.textContent, 'Copied')
    await click(page, '[data-copy-prompt]')
    t.deepEqual(page.pendingDelays(), [COPIED_MS, COPIED_MS, LIVE_TIMEOUT_MS])
    page.runTimers(COPIED_MS)
    t.is(label.textContent, 'Copy prompt')
    t.false('copied' in button.dataset)
    t.is(status(page), '')
    page.close()
  }
)

test.serial(
  'a refused copy resets its button at once and keeps its own announcement',
  async t => {
    let allow = true
    const page = await openCover({
      clipboard: () =>
        allow ? Promise.resolve() : Promise.reject(new Error('denied'))
    })
    const button = page.cover.querySelector('[data-copy-prompt]')
    const label = button.querySelector('[data-copy-prompt-label]')
    await click(page, '[data-copy-prompt]')
    allow = false
    await click(page, '[data-copy-prompt]')
    t.is(label.textContent, 'Copy prompt')
    t.false('copied' in button.dataset)
    t.is(status(page), 'Could not copy')
    t.deepEqual(page.pendingDelays(), [COPIED_MS, LIVE_TIMEOUT_MS])
    page.runTimers(COPIED_MS)
    t.is(status(page), '')
    page.close()
  }
)

test.serial(
  'one button announcing does not get cleared by the other button',
  async t => {
    const page = await openCover()
    await click(page, '[data-copy-prompt]')
    await click(page, '[data-copy]')
    t.is(status(page), 'Copied to clipboard')
    t.deepEqual(page.pendingDelays(), [
      COPIED_MS,
      COPIED_MS,
      COPIED_MS,
      LIVE_TIMEOUT_MS
    ])
    page.runTimers(COPIED_MS)
    t.is(status(page), '')
    t.false('copied' in page.cover.querySelector('[data-copy]').dataset)
    t.false('copied' in page.cover.querySelector('[data-copy-prompt]').dataset)
    page.close()
  }
)

test.serial(
  'a cover still loading after the timeout falls back to the still frame',
  async t => {
    const page = await openCover()
    page.runTimers(LIVE_TIMEOUT_MS)
    t.is(page.cover.dataset.mode, 'fallback')
    t.is(page.cover.dataset.reason, 'timeout')
    t.is(page.gpu.loop, null)
    page.close()
  }
)

test.serial('the timeout leaves a live or failed cover alone', async t => {
  const live = await openCover()
  live.tick()
  live.flushFrames()
  live.runTimers(LIVE_TIMEOUT_MS)
  t.is(live.cover.dataset.mode, 'live')
  t.not(live.gpu.loop, null)
  live.close()

  const failed = await openCover({ adapter: null })
  failed.runTimers(LIVE_TIMEOUT_MS)
  t.is(failed.cover.dataset.reason, 'no-adapter')
  failed.close()
})

const deferred = () => {
  const gate = {}
  gate.promise = new Promise(resolve => (gate.resolve = resolve))
  return gate
}

test.serial(
  'a timeout during the atlas download stops the start before the GPU',
  async t => {
    const atlas = deferred()
    const page = await openCover({ atlasGate: atlas.promise })
    page.runTimers(LIVE_TIMEOUT_MS)
    atlas.resolve()
    await settle()
    t.is(page.adapterRequests.count, 0)
    t.is(page.cover.dataset.reason, 'timeout')
    page.close()
  }
)

test.serial(
  'a timeout during the adapter request never creates a device',
  async t => {
    const adapter = deferred()
    const page = await openCover({ adapter: adapter.promise })
    page.runTimers(LIVE_TIMEOUT_MS)
    adapter.resolve(null)
    await settle()
    t.is(page.gpu.initOptions, 'not called')
    t.is(page.cover.dataset.reason, 'timeout')
    page.close()
  }
)

test.serial(
  'a device that arrives after the timeout is released unused',
  async t => {
    const init = deferred()
    const page = await openCover({ initGate: init.promise })
    page.runTimers(LIVE_TIMEOUT_MS)
    init.resolve()
    await settle()
    t.true(page.gpu.disposed)
    t.deepEqual(page.gpu.params, [])
    t.is(page.gpu.loops, 0)
    t.is(page.cover.dataset.reason, 'timeout')
    page.close()
  }
)

test.serial(
  'the pause button stops the scene until it is pressed again',
  async t => {
    const page = await openCover()
    const pause = page.cover.querySelector('[data-pause]')
    t.is(pause.getAttribute('aria-pressed'), 'false')
    pause.click()
    t.is(pause.getAttribute('aria-pressed'), 'true')
    t.is(page.gpu.loop, null)
    page.document.dispatchEvent(new page.window.Event('visibilitychange'))
    page.observers.intersection([{ isIntersecting: true }])
    t.is(page.gpu.loop, null)
    pause.click()
    t.is(pause.getAttribute('aria-pressed'), 'false')
    t.not(page.gpu.loop, null)
    page.close()
  }
)
