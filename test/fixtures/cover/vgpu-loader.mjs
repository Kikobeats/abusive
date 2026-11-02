const VGPU_URL = 'https://cdn.jsdelivr.net/npm/vgpu@0.6.0/+esm'
const FAKE_VGPU = new URL('./fake-vgpu.mjs', import.meta.url).href

export async function resolve (specifier, context, nextResolve) {
  if (specifier === VGPU_URL) return { url: FAKE_VGPU, shortCircuit: true }
  return nextResolve(specifier, context)
}
