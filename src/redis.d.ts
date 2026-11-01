import type { SignupStore } from './index'

export interface RedisClient {
  set: (...args: any[]) => Promise<unknown>
  get: (key: string) => Promise<string | null>
  del: (...keys: string[]) => Promise<unknown>
  multi: () => any
}

export interface RedisStoreOptions {
  prefix?: string
}

export function redisStore (client: RedisClient, options?: RedisStoreOptions): SignupStore

declare const _default: typeof redisStore & { redisStore: typeof redisStore }
export default _default
