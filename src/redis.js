'use strict'

const DEFAULT_PREFIX = 'abusive:'
const OLDEST_SCORE = 0
const COUNT_REPLY = 2
const CLAIM_ATTEMPTS = 5

const replyOf = ([error, value]) => {
  if (error) throw error
  return value
}

const redisStore = (client, { prefix = DEFAULT_PREFIX } = {}) => {
  if (client == null) throw new TypeError('`client` must be a Redis client')
  const keyOf = key => `${prefix}${key}`

  return {
    claim: async (key, value, ttlMs) => {
      const expiry = ttlMs === undefined ? [] : ['PX', ttlMs]
      for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
        const stored = await client.set(keyOf(key), value, ...expiry, 'NX')
        if (stored === 'OK') return value
        const holder = await client.get(keyOf(key))
        if (holder != null) return holder
      }
      throw new Error(`could not claim \`${key}\``)
    },
    read: key => client.get(keyOf(key)),
    write: (key, value) => client.set(keyOf(key), value),
    countRecent: async (key, member, windowMs) => {
      const now = Date.now()
      const replies = await client
        .multi()
        .zremrangebyscore(keyOf(key), OLDEST_SCORE, now - windowMs)
        .zadd(keyOf(key), 'NX', now, member)
        .zcard(keyOf(key))
        .pexpire(keyOf(key), windowMs)
        .exec()
      return replies.map(replyOf)[COUNT_REPLY]
    },
    remove: (...keys) => Promise.all(keys.map(key => client.del(keyOf(key))))
  }
}

module.exports = redisStore
module.exports.redisStore = redisStore
