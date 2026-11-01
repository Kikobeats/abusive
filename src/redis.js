'use strict'

const DEFAULT_PREFIX = 'abusive:'
const CLAIM_ATTEMPTS = 5
// setTimeout turns anything else into a 1ms timer, failing every check.
const MAX_TIMEOUT_MS = 2 ** 31 - 1

const assertMilliseconds = (name, value, max) => {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new TypeError(`\`${name}\` must be an integer from 1 to ${max}`)
  }
}

const withinTimeout = async (timeoutMs, work) => {
  if (timeoutMs === undefined) return work()
  let timer
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error('redis store timed out')),
      timeoutMs
    )
  })
  try {
    return await Promise.race([work(), timeout])
  } finally {
    clearTimeout(timer)
  }
}

const redisStore = (
  client,
  { prefix = DEFAULT_PREFIX, timeoutMs, ttlMs } = {}
) => {
  if (client == null) {
    throw new TypeError(
      '`client` must be a Redis client or a function returning one'
    )
  }
  if (timeoutMs !== undefined) {
    assertMilliseconds('timeoutMs', timeoutMs, MAX_TIMEOUT_MS)
  }
  assertMilliseconds('ttlMs', ttlMs, Number.MAX_SAFE_INTEGER)
  const expiry = ttlMs === undefined ? [] : ['PX', ttlMs]
  const claim = async (key, value) => {
    const redis = typeof client === 'function' ? await client() : client
    const stored = `${prefix}${key}`
    for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
      if ((await redis.set(stored, value, ...expiry, 'NX')) === 'OK') {
        return value
      }
      const holder = await redis.get(stored)
      if (holder != null) return holder
    }
    throw new Error(`could not claim \`${key}\``)
  }
  return {
    claim: (key, value) => withinTimeout(timeoutMs, () => claim(key, value))
  }
}

module.exports = redisStore
module.exports.redisStore = redisStore
