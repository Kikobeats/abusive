'use strict'

const INVISIBLE_CHARACTERS = /[\p{Cf}\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/gu
// NFKC folds U+FF0E to "." and U+FF61 to U+3002. U+3002 itself is unchanged.
const LABEL_DOTS = /\u3002/g
const TRAILING_DOTS = /\.+$/
const SUBADDRESS = /\+.*$/
const GMAIL_DOTS = /\./g
const SEPARATORS = /[._-]/g
// One or two digits next to a letter: destek1..destek99. Longer runs are
// years or lucky numbers that unrelated people pick: john1987, derek2001.
const TRAILING_COUNTER = /(?<=\p{L})\d{1,2}$/u
const LEADING_COUNTER = /^\d{1,2}(?=\p{L})/u
const LETTER = /\p{L}/u
const SAFE_MAILBOX = /^[a-z0-9._+-]+$/
const LETTER_RUNS = /[a-z]+/g
const HOSTNAME = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/
// Below this, a numbered mailbox like jo2 is shared by too many people.
const MIN_MAILBOX_LENGTH = 3
const GMAIL_DOMAINS = ['gmail.com', 'googlemail.com']
const SAME_INBOX = 'same-inbox'
const NUMBERED = 'numbered'

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

const isGmail = domain => GMAIL_DOMAINS.includes(domain)

const inboxDomainOf = domain => (isGmail(domain) ? GMAIL_DOMAINS[0] : domain)

const domainsSharingInbox = domain =>
  isGmail(domain)
    ? [domain, ...GMAIL_DOMAINS.filter(alias => alias !== domain)]
    : [domain]

const inboxOf = ({ local, domain }) => {
  const mailbox = withoutSubaddress(local)
  return isGmail(domain) ? mailbox.replace(GMAIL_DOTS, '') : mailbox
}

const withoutCounter = mailbox =>
  TRAILING_COUNTER.test(mailbox)
    ? mailbox.replace(TRAILING_COUNTER, '')
    : mailbox.replace(LEADING_COUNTER, '')

const mailboxOf = parts =>
  withoutCounter(inboxOf(parts).replace(SEPARATORS, ''))

const isNumberable = mailbox =>
  mailbox.length >= MIN_MAILBOX_LENGTH && LETTER.test(mailbox)

const longestLetterRun = local =>
  (local.match(LETTER_RUNS) ?? []).reduce(
    (longest, run) => (run.length > longest.length ? run : longest),
    ''
  )

const collapsedInboxOf = parts => inboxOf(parts).replace(SEPARATORS, '')

// A one- or two-letter run is too broad to search for, and Stripe ignores it.
// Fall back to the collapsed mailbox so d.e.r.e.k searches for derek. A mailbox
// too short to have numbered siblings keeps its counter, so ab1+x finds ab1.
const MIN_KEYWORD_LENGTH = 3

const keywordOf = candidate => {
  const run = longestLetterRun(withoutSubaddress(candidate.local))
  if (run.length >= MIN_KEYWORD_LENGTH) return run
  const mailbox = mailboxOf(candidate)
  return isNumberable(mailbox) ? mailbox : collapsedInboxOf(candidate)
}

const isSameAddress = (a, b) => a.local === b.local && a.domain === b.domain

const relationOf = (a, b) => {
  if (
    a == null ||
    b == null ||
    inboxDomainOf(a.domain) !== inboxDomainOf(b.domain) ||
    isSameAddress(a, b)
  ) {
    return null
  }
  const inbox = inboxOf(a)
  if (inbox !== '' && inbox === inboxOf(b)) return SAME_INBOX
  const mailbox = mailboxOf(a)
  if (isNumberable(mailbox) && mailbox === mailboxOf(b)) return NUMBERED
  return null
}

const isSibling = (candidate, existing) =>
  relationOf(toParts(candidate), toParts(existing)) !== null

const isSearchable = candidate =>
  HOSTNAME.test(candidate.domain) &&
  SAFE_MAILBOX.test(candidate.local) &&
  collapsedInboxOf(candidate) !== ''

const assertMinSiblings = value => {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(
      '`minSiblings` must be a positive integer or a function returning one'
    )
  }
  return value
}

const toMinSiblings = minSiblings => {
  if (typeof minSiblings === 'function') {
    return candidate => assertMinSiblings(minSiblings({ ...candidate }))
  }
  assertMinSiblings(minSiblings)
  return () => minSiblings
}

const assertLimit = limit => {
  if (limit !== Infinity && (!Number.isInteger(limit) || limit < 0)) {
    throw new TypeError('`limit` must be a non-negative integer or Infinity')
  }
  return limit
}

const createAbusive = ({
  dataset,
  lookup,
  limit = Infinity,
  minSiblings = 1
} = {}) => {
  const freeEmailDomains = toDomainSet(dataset)
  if (lookup != null && typeof lookup !== 'function') {
    throw new TypeError('`lookup` must be a function')
  }
  const siblingsRequired = toMinSiblings(minSiblings)
  assertLimit(limit)

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
    const keyword = keywordOf(candidate)
    const required = siblingsRequired(candidate)
    const numberedInboxes = new Set()
    let read = 0
    for (const domain of domainsSharingInbox(candidate.domain)) {
      if (read >= limit) return null
      for await (const existing of await lookup({ domain, keyword })) {
        const parts = typeof existing === 'string' ? parseEmail(existing) : null
        const relation = relationOf(candidate, parts)
        if (relation === SAME_INBOX) return existing
        if (relation === NUMBERED) {
          numberedInboxes.add(
            `${inboxOf(parts)}@${inboxDomainOf(parts.domain)}`
          )
          if (numberedInboxes.size >= required) return existing
        }
        if (++read >= limit) return null
      }
    }
    return null
  }

  const findSibling = async email => {
    if (lookup == null) {
      throw new TypeError('`lookup` is required to find siblings')
    }
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
