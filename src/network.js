'use strict'

const { isIP } = require('net')

const IPV6_GROUPS = 8
const IPV6_PREFIX_GROUPS = 4
const MAPPED_IPV4_GROUP = 5
const MAPPED_IPV4_MARKER = 0xffff
const BYTE = 256
const ZONE = /%.*$/
const EMBEDDED_IPV4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/

const hexGroupsOf = ipv4 => {
  const [, a, b, c, d] = ipv4.match(EMBEDDED_IPV4).map(Number)
  return `${(a * BYTE + b).toString(16)}:${(c * BYTE + d).toString(16)}`
}

const parseGroups = text =>
  text === '' ? [] : text.split(':').map(group => parseInt(group, 16))

const expandIpv6 = ip => {
  const hexOnly = ip.replace(EMBEDDED_IPV4, hexGroupsOf)
  const [head, tail] = hexOnly.split('::')
  const before = parseGroups(head)
  if (tail === undefined) return before
  const after = parseGroups(tail)
  const zeros = Array(IPV6_GROUPS - before.length - after.length).fill(0)
  return [...before, ...zeros, ...after]
}

const isMappedIpv4 = groups =>
  groups[MAPPED_IPV4_GROUP] === MAPPED_IPV4_MARKER &&
  groups.slice(0, MAPPED_IPV4_GROUP).every(group => group === 0)

const mappedIpv4 = groups =>
  groups
    .slice(MAPPED_IPV4_GROUP + 1)
    .flatMap(group => [Math.floor(group / BYTE), group % BYTE])
    .join('.')

const networkOf = ip => {
  if (typeof ip !== 'string') return null
  const trimmed = ip.trim()
  const address = trimmed.replace(ZONE, '')
  const family = isIP(address)
  if (family === 4) return address === trimmed ? address : null
  if (family !== 6) return null
  const groups = expandIpv6(address)
  if (isMappedIpv4(groups)) return mappedIpv4(groups)
  const prefix = groups.slice(0, IPV6_PREFIX_GROUPS)
  return `${prefix.map(group => group.toString(16)).join(':')}::/64`
}

module.exports = networkOf
