'use strict'

const { createHmac } = require('crypto')
const networkOf = require('./network')

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_IP_MEMORY_MS = 30 * DAY_MS

const createIpRule = ({ store, secret, ipMemoryMs = DEFAULT_IP_MEMORY_MS }) => {
  if (typeof store?.claim !== 'function') {
    throw new TypeError('`store` must implement claim')
  }
  if (typeof secret !== 'string' || secret === '') {
    throw new TypeError('`secret` must be a non-empty string')
  }
  if (!Number.isSafeInteger(ipMemoryMs) || ipMemoryMs < 1) {
    throw new TypeError('`ipMemoryMs` must be a positive integer')
  }

  const hash = value => createHmac('sha256', secret).update(value).digest('hex')

  const isIpUsedByAnother = async (address, ip) => {
    const network = networkOf(ip)
    if (network === null) return false
    const holder = hash(address)
    const owner = await store.claim(`ip:${hash(network)}`, holder, ipMemoryMs)
    return owner !== holder
  }

  return { isIpUsedByAnother }
}

module.exports = createIpRule
