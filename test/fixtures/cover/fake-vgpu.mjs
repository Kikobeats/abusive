const gpuHarness = () => globalThis.gpuHarness

export const init = options => gpuHarness().init(options)
export const surface = (gpu, canvas, options) => gpuHarness().surface(options)
export const texture = () => ({ gpu: {} })
export const sampler = () => ({})
export const effect = (gpu, shader, { set }) => gpuHarness().effect(set)
export const frameLoop = (gpu, tick) => gpuHarness().frameLoop(tick)
export const timer = () => gpuHarness().timer()
