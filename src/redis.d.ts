import type { AbusiveStore } from './index'

export interface RedisClient {
  set: (...args: any[]) => Promise<unknown>
  get: (key: string) => Promise<string | null>
}

export interface RedisStoreOptions {
  prefix?: string
}

export function redisStore (client: RedisClient, options?: RedisStoreOptions): AbusiveStore

declare const _default: typeof redisStore & { redisStore: typeof redisStore }
export default _default
