'use strict'

const INVISIBLE_CHARACTERS = /[\u200B-\u200D\u2060\uFEFF]/g
const LABEL_DOTS = /[\u3002\uFF0E\uFF61]/g
const TRAILING_DOTS = /\.+$/
const SUBADDRESS = /\+.*$/
const NUMBERING_AND_SEPARATORS = /[\d._-]/g
const SAFE_MAILBOX = /^[a-z0-9._+-]+$/
const LETTER_RUNS = /[a-z]+/g
const HOSTNAME = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/

const canonicalAddress = email =>
  String(email)
    .normalize('NFKC')
    .replace(INVISIBLE_CHARACTERS, '')
    .replace(LABEL_DOTS, '.')
    .trim()
    .toLowerCase()

const parseEmail = email => {
  const address = canonicalAddress(email)
  const at = address.lastIndexOf('@')
  if (at <= 0) return null
  const domain = address.slice(at + 1).replace(TRAILING_DOTS, '')
  if (domain === '') return null
  return { local: address.slice(0, at), domain }
}

const toParts = email => (typeof email === 'string' ? parseEmail(email) : email)

const toDomainSet = dataset => {
  if (
    dataset == null ||
    typeof dataset === 'string' ||
    typeof dataset[Symbol.iterator] !== 'function'
  ) {
    throw new TypeError('`dataset` must be an iterable of free email domains')
  }
  return new Set(
    Array.from(dataset, domain =>
      canonicalAddress(domain).replace(TRAILING_DOTS, '')
    )
  )
}

const withoutSubaddress = local => local.replace(SUBADDRESS, '')

const mailboxOf = ({ local }) =>
  withoutSubaddress(local).replace(NUMBERING_AND_SEPARATORS, '')

const longestLetterRun = local =>
  local
    .match(LETTER_RUNS)
    .reduce((longest, run) => (run.length > longest.length ? run : longest), '')

const isSibling = (candidate, existing) => {
  const a = toParts(candidate)
  const b = toParts(existing)
  if (a == null || b == null || a.domain !== b.domain || a.local === b.local) { return false }
  const mailbox = mailboxOf(a)
  return mailbox !== '' && mailbox === mailboxOf(b)
}

const isSearchable = candidate =>
  HOSTNAME.test(candidate.domain) &&
  SAFE_MAILBOX.test(candidate.local) &&
  mailboxOf(candidate) !== ''

const createAbusive = ({ dataset, lookup, limit = Infinity } = {}) => {
  const freeEmailDomains = toDomainSet(dataset)
  if (lookup != null && typeof lookup !== 'function') { throw new TypeError('`lookup` must be a function') }

  const isFreeEmailDomain = domain => {
    const labels = canonicalAddress(domain)
      .replace(TRAILING_DOTS, '')
      .split('.')
    return labels.some((_, index) =>
      freeEmailDomains.has(labels.slice(index).join('.'))
    )
  }

  const isFreeEmail = email => {
    const parts = parseEmail(email)
    return parts !== null && isFreeEmailDomain(parts.domain)
  }

  const registeredSibling = async candidate => {
    const keyword = longestLetterRun(withoutSubaddress(candidate.local))
    let read = 0
    for await (const existing of await lookup({
      domain: candidate.domain,
      keyword
    })) {
      if (read++ >= limit) return null
      if (typeof existing === 'string' && isSibling(candidate, existing)) { return existing }
    }
    return null
  }

  const findSibling = async email => {
    if (lookup == null) { throw new TypeError('`lookup` is required to find siblings') }
    const candidate = parseEmail(email)
    if (candidate === null || !isSearchable(candidate)) return null
    return registeredSibling(candidate)
  }

  return { findSibling, isFreeEmail, isFreeEmailDomain, isSibling, parseEmail }
}

module.exports = createAbusive
module.exports.createAbusive = createAbusive
module.exports.isSibling = isSibling
module.exports.parseEmail = parseEmail
