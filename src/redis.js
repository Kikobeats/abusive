'use strict'

const DEFAULT_PREFIX = 'abusive:'
const CLAIM_ATTEMPTS = 5

const redisStore = (client, { prefix = DEFAULT_PREFIX } = {}) => {
  if (client == null) throw new TypeError('`client` must be a Redis client')
  return {
    claim: async (key, value, ttlMs) => {
      const stored = `${prefix}${key}`
      for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
        if ((await client.set(stored, value, 'PX', ttlMs, 'NX')) === 'OK') { return value }
        const holder = await client.get(stored)
        if (holder != null) return holder
      }
      throw new Error(`could not claim \`${key}\``)
    }
  }
}

module.exports = redisStore
module.exports.redisStore = redisStore
