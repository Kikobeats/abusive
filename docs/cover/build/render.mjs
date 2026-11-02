import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import sharp from 'sharp'
import * as vgpu from 'vgpu/node'
import { lensShader } from '../shaders.js'
import { BEST_FRAME_SECONDS, autopilot, createLensEffect, layoutFor, sceneParams } from '../scene.js'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const atlasPng = PNG.sync.read(readFileSync(new URL('../atlas.png', import.meta.url)))
const atlasPixels = new Uint8Array(atlasPng.width * atlasPng.height)
for (let i = 0; i < atlasPixels.length; i++) atlasPixels[i] = atlasPng.data[i * 4]

const TEXT_BOXES = JSON.parse(readFileSync(new URL('./text-boxes.json', import.meta.url), 'utf8'))
const WEBP = { quality: 82, effort: 6 }

const FRAMES = [
  { name: 'fallback-dark', width: 1440, height: 900, dpr: 2, theme: 0, text: TEXT_BOXES.desktop },
  { name: 'fallback-light', width: 1440, height: 900, dpr: 2, theme: 1, text: TEXT_BOXES.desktop },
  { name: 'fallback-dark-mobile', width: 390, height: 844, dpr: 2, theme: 0, text: TEXT_BOXES.mobile },
  { name: 'fallback-light-mobile', width: 390, height: 844, dpr: 2, theme: 1, text: TEXT_BOXES.mobile }
]

async function renderFrame (gpu, { width, height, dpr, theme, text }) {
  const seconds = BEST_FRAME_SECONDS
  const layout = layoutFor(width, height, text)
  const lens = autopilot(seconds, layout)
  const params = sceneParams({ width, height, dpr, seconds, theme, layout, lens })
  const fx = createLensEffect(vgpu, gpu, lensShader, atlasPixels, params)
  const [w, h] = params.resolution
  const colorTarget = vgpu.target(gpu, { size: [w, h] })
  fx.draw(colorTarget)
  const pixels = await colorTarget.color.read({ mipLevel: 0, region: 'all' })
  return { pixels, width: w, height: h }
}

const toImage = ({ pixels, width, height }) => sharp(Buffer.from(pixels), { raw: { width, height, channels: 4 } }).removeAlpha()

function framesFor (mode) {
  const frames = FRAMES.filter((frame) => mode === 'all' || frame.name === mode)
  if (frames.length === 0) {
    throw new Error(`unknown frame "${mode}", expected all or one of ${FRAMES.map((frame) => frame.name).join(', ')}`)
  }
  return frames
}

async function renderStills (gpu, frames, out) {
  mkdirSync(`${out}/scratch`, { recursive: true })
  for (const spec of frames) {
    const frame = await renderFrame(gpu, spec)
    await toImage(frame).webp(WEBP).toFile(`${out}/${spec.name}.webp`)
    await toImage(frame).png().toFile(`${out}/scratch/${spec.name}.png`)
    console.log(`${spec.name} ${frame.width}x${frame.height}`)
  }
}

const [mode = 'all', out = ROOT] = process.argv.slice(2)
const gpu = await vgpu.init()
await renderStills(gpu, framesFor(mode), out)
gpu.dispose()
