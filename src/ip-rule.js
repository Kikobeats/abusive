'use strict'

const { createHmac } = require('crypto')
const networkOf = require('./network')

const createIpRule = ({ store, secret }) => {
  if (typeof store?.claim !== 'function') {
    throw new TypeError('`ip.store` must implement claim')
  }
  if (typeof secret !== 'string' || secret === '') {
    throw new TypeError('`secret` must be a non-empty string')
  }

  const hash = value => createHmac('sha256', secret).update(value).digest('hex')

  const keyOf = ip => {
    const network = networkOf(ip)
    return network === null ? null : `ip:${hash(network)}`
  }

  const takeIp = async (address, ip) => {
    const key = keyOf(ip)
    if (key === null) return false
    const holder = hash(address)
    return (await store.claim(key, holder)) !== holder
  }

  const isIpTakenByAnother = async (address, ip) => {
    const key = keyOf(ip)
    if (key === null || typeof store.peek !== 'function') return false
    const owner = await store.peek(key)
    return owner != null && owner !== hash(address)
  }

  return { takeIp, isIpTakenByAnother }
}

module.exports = createIpRule
