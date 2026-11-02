'use strict'

const createIpRule = require('./ip-rule')

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
const MAX_ADDRESS_LENGTH = 320
const SINGLE_ADDRESS = /^[^\s@]+@[^\s@]+$/
const SIBLING = 'sibling'
const IP = 'ip'
const noop = () => {}
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

const toDomainSet = domains => {
  if (
    domains == null ||
    typeof domains === 'string' ||
    typeof domains[Symbol.iterator] !== 'function'
  ) {
    throw new TypeError('`rejectedDomains` must be an iterable of domains')
  }
  return new Set(
    Array.from(domains, domain =>
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

const notifyQuietly = (hook, details) => {
  try {
    Promise.resolve(hook(details)).catch(noop)
  } catch {}
}

const assertHook = (name, hook) => {
  if (typeof hook !== 'function') {
    throw new TypeError(`\`${name}\` must be a function`)
  }
}

const assertMinSiblings = value => {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(
      '`sibling.min` must be a positive integer or a function returning one'
    )
  }
  return value
}

const toMinSiblings = min => {
  if (typeof min === 'function') {
    return candidate => assertMinSiblings(min({ ...candidate }))
  }
  assertMinSiblings(min)
  return () => min
}

const createAbusive = ({
  rejectedDomains = [],
  sibling,
  ip,
  secret,
  onAbusive = noop,
  onError = noop
} = {}) => {
  const rejected = toDomainSet(rejectedDomains)
  const { lookup, min = 1 } = sibling ?? {}
  if (sibling != null && typeof lookup !== 'function') {
    throw new TypeError('`sibling.lookup` must be a function')
  }
  const siblingsRequired = toMinSiblings(min)
  assertHook('onAbusive', onAbusive)
  assertHook('onError', onError)
  const ipRule = ip == null ? null : createIpRule({ store: ip.store, secret })

  const isRejectedDomain = domain => {
    const labels = canonicalAddress(domain)
      .replace(TRAILING_DOTS, '')
      .split('.')
    return labels.some((_, index) =>
      rejected.has(labels.slice(index).join('.'))
    )
  }

  const isRejectedEmail = email => {
    const parts = parseEmail(email)
    return parts !== null && isRejectedDomain(parts.domain)
  }

  const registeredSibling = async candidate => {
    const keyword = keywordOf(candidate)
    const required = siblingsRequired(candidate)
    const numberedInboxes = new Set()
    for (const domain of domainsSharingInbox(candidate.domain)) {
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
      }
    }
    return null
  }

  const siblingOf = candidate =>
    isSearchable(candidate) ? registeredSibling(candidate) : null

  const findSibling = async email => {
    if (lookup == null) {
      throw new TypeError('`sibling.lookup` is required to find siblings')
    }
    if (String(email).length > MAX_ADDRESS_LENGTH) return null
    const candidate = parseEmail(email)
    return candidate === null ? null : siblingOf(candidate)
  }

  const reportingFailure = async (email, rule) => {
    try {
      return await rule()
    } catch (error) {
      notifyQuietly(onError, { email, error })
      return null
    }
  }

  const reasonOf = async ({ email, parts, ip }) => {
    if (
      lookup != null &&
      (await reportingFailure(email, () => siblingOf(parts)))
    ) {
      return SIBLING
    }
    if (ipRule === null) return null
    const address = `${parts.local}@${parts.domain}`
    if (!SINGLE_ADDRESS.test(address)) return null
    const isTaken = await reportingFailure(email, () =>
      ipRule.isIpUsedByAnother(address, ip)
    )
    return isTaken ? IP : null
  }

  const isAbusive = async check => {
    try {
      const { email, ip } = check ?? {}
      if (typeof email !== 'string' || email.length > MAX_ADDRESS_LENGTH) {
        return false
      }
      const parts = parseEmail(email)
      if (parts === null) return false
      const reason = await reasonOf({ email, parts, ip })
      if (reason === null) return false
      notifyQuietly(onAbusive, { email, domain: parts.domain, reason })
      return true
    } catch (error) {
      notifyQuietly(onError, { error })
      return false
    }
  }

  return {
    findSibling,
    isAbusive,
    isRejectedEmail,
    isRejectedDomain,
    isSibling,
    parseEmail
  }
}

module.exports = createAbusive
module.exports.createAbusive = createAbusive
module.exports.isSibling = isSibling
module.exports.parseEmail = parseEmail
