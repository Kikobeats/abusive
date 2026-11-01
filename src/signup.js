'use strict'

const { createHmac, randomUUID } = require('crypto')
const networkOf = require('./network')

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_IP_MEMORY_MS = 30 * DAY_MS
const DEFAULT_BURST_LIMIT = 3
const DEFAULT_BURST_WINDOW_MS = 7 * DAY_MS
const DEFAULT_BURST_BLOCK_MS = 90 * DAY_MS

const BLOCKED_DOMAIN = 'blocked-domain'
const DOMAIN_BURST = 'domain-burst'
const SAME_IP = 'same-ip'
const SAME_INBOX = 'same-inbox'

const never = () => false

const assertPositiveInteger = (name, value) => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`\`${name}\` must be a positive integer`)
  }
}

const assertFunction = (name, value) => {
  if (typeof value !== 'function') {
    throw new TypeError(`\`${name}\` must be a function`)
  }
}

const assertStore = store => {
  const methods = ['claim', 'read', 'countRecent', 'remove']
  if (
    store == null ||
    methods.some(name => typeof store[name] !== 'function')
  ) {
    throw new TypeError(`\`store\` must implement ${methods.join(', ')}`)
  }
}

const parentsOf = domain => {
  const labels = domain.split('.')
  return labels.slice(0, -1).map((_, index) => labels.slice(index).join('.'))
}

const createSignupScreen = ({
  isAlwaysShared,
  store,
  secret,
  ipMemoryMs = DEFAULT_IP_MEMORY_MS,
  burstLimit = DEFAULT_BURST_LIMIT,
  burstWindowMs = DEFAULT_BURST_WINDOW_MS,
  burstBlockMs = DEFAULT_BURST_BLOCK_MS,
  onBlock = never,
  isTrustedDomain = never,
  isSharedDomain = never
}) => {
  assertStore(store)
  if (typeof secret !== 'string' || secret === '') {
    throw new TypeError('`secret` must be a non-empty string')
  }
  assertPositiveInteger('ipMemoryMs', ipMemoryMs)
  assertPositiveInteger('burstLimit', burstLimit)
  assertPositiveInteger('burstWindowMs', burstWindowMs)
  assertPositiveInteger('burstBlockMs', burstBlockMs)
  assertFunction('onBlock', onBlock)
  assertFunction('isTrustedDomain', isTrustedDomain)
  assertFunction('isSharedDomain', isSharedDomain)

  const hash = value => createHmac('sha256', secret).update(value).digest('hex')
  const blockKey = domain => `blocked:${domain}`
  const burstKey = domain => `burst:${domain}`
  const admittedKey = identity => `admitted:${hash(identity)}`
  const ipKey = ip => {
    const network = networkOf(ip)
    return network === null ? null : `ip:${hash(network)}`
  }

  const blockOf = async domain => {
    const [own, ...parents] = await Promise.all(
      parentsOf(domain).map(parent => store.read(blockKey(parent)))
    )
    return {
      own: own != null,
      inherited: parents.some(marker => marker != null)
    }
  }

  const isRefusedByBlock = async (domain, isTrusted) => {
    const { own, inherited } = await blockOf(domain)
    return inherited || (own && !(await isTrusted()))
  }

  const notifyBlock = domain => {
    Promise.resolve()
      .then(() => onBlock(domain))
      .catch(() => {})
  }

  const blockAfterBurst = async domain => {
    const token = randomUUID()
    try {
      const holder = await store.claim(blockKey(domain), token, burstBlockMs)
      if (holder === token) notifyBlock(domain)
    } catch (error) {
      notifyBlock(domain)
      throw error
    }
  }

  const judgeOf = domain => {
    let shared
    let trusted
    const isShared = () => {
      shared ??= Promise.resolve().then(
        () => isAlwaysShared(domain) || isSharedDomain(domain)
      )
      return shared
    }
    const isTrusted = () => {
      trusted ??= isShared().then(result => !result && isTrustedDomain(domain))
      return trusted
    }
    return { isShared, isTrusted }
  }

  const checkSignup = async ({ domain }) => {
    const { isTrusted } = judgeOf(domain)
    return (await isRefusedByBlock(domain, isTrusted))
      ? { reason: BLOCKED_DOMAIN }
      : null
  }

  const applyBurstRule = async (
    { domain, holder },
    { isShared, isTrusted }
  ) => {
    if (await isShared()) return null
    const recent = await store.countRecent(
      burstKey(domain),
      holder,
      burstWindowMs
    )
    if (recent < burstLimit || (await isTrusted())) return null
    await blockAfterBurst(domain)
    return { reason: DOMAIN_BURST }
  }

  const admitNewInbox = async ({ identity, domain }, key, judge) => {
    const holder = hash(identity)
    const owner =
      key === null ? null : await store.claim(key, holder, ipMemoryMs)
    if (owner != null && owner !== holder && !(await judge.isTrusted())) {
      return { reason: SAME_IP }
    }
    const releaseIp = async () => {
      if (owner === holder) await store.remove(key)
    }
    try {
      const refusal = await applyBurstRule({ domain, holder }, judge)
      if (refusal !== null) await releaseIp()
      return refusal
    } catch (error) {
      await releaseIp()
      throw error
    }
  }

  const admitSignup = async (candidate, ip) => {
    const { identity, spelling, domain } = candidate
    const judge = judgeOf(domain)
    await judge.isShared()
    const spelled = hash(spelling)
    const marker = admittedKey(identity)
    const admittedAs = await store.read(marker)
    if (admittedAs != null) {
      return admittedAs === spelled ? null : { reason: SAME_INBOX }
    }
    const winner = await store.claim(marker, spelled, ipMemoryMs)
    if (winner !== spelled) return { reason: SAME_INBOX }
    try {
      const refusal = await admitNewInbox(candidate, ipKey(ip), judge)
      if (refusal !== null) await store.remove(marker)
      return refusal
    } catch (error) {
      await store.remove(marker)
      throw error
    }
  }

  return { admitSignup, checkSignup }
}

module.exports = createSignupScreen
