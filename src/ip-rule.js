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

  const isIpUsedByAnother = async (address, ip) => {
    const network = networkOf(ip)
    if (network === null) return false
    const holder = hash(address)
    const owner = await store.claim(`ip:${hash(network)}`, holder)
    return owner !== holder
  }

  return { isIpUsedByAnother }
}

module.exports = createIpRule
