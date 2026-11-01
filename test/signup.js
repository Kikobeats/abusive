'use strict'

const test = require('ava').default
const { domainToASCII } = require('url')

const dataset = require('free-email-domains')
const createAbusive = require('..')
const networkOf = require('../src/network')

const memoryStore = () => {
  const values = new Map()
  const sets = new Map()
  return {
    values,
    sets,
    ttls: new Map(),
    async claim (key, value, ttlMs) {
      if (!values.has(key)) {
        values.set(key, value)
        this.ttls.set(key, ttlMs)
      }
      return values.get(key)
    },
    read: async key => values.get(key) ?? null,
    countRecent: async (key, member) => {
      if (!sets.has(key)) sets.set(key, new Set())
      sets.get(key).add(member)
      return sets.get(key).size
    },
    remove: async (...keys) => {
      keys.forEach(key => {
        values.delete(key)
        sets.delete(key)
      })
    }
  }
}

const screen = ({ dataset: domains = dataset, ...options } = {}) => {
  const store = options.store ?? memoryStore()
  const reasons = new Map()
  const errors = new Map()
  const { isAbusive } = createAbusive({
    dataset: domains,
    secret: 'secret',
    ...options,
    store,
    onAbusive: ({ email, reason }) => reasons.set(email, reason),
    onError: ({ email, error }) => errors.set(email, error)
  })
  const run = async (email, check) => {
    reasons.delete(email)
    errors.delete(email)
    const abusive = await isAbusive({ email, ...check })
    if (errors.has(email)) throw errors.get(email)
    return abusive ? { reason: reasons.get(email) } : null
  }
  return {
    store,
    admitSignup: (email, context) =>
      run(email, { ip: context?.ip, verified: true }),
    checkSignup: email => run(email, {})
  }
}

const IP = '203.0.113.7'
const block = ({ values }, domain) =>
  values.set(`blocked:${domainToASCII(domain)}`, '1')
const MALFORMED = { reason: 'malformed' }

test('the first signup from an IP is admitted', async t => {
  const { admitSignup } = screen()
  t.is(await admitSignup('jane@acme.com', { ip: IP }), null)
})

test('a second email from the same IP is refused, on any domain', async t => {
  const { admitSignup } = screen()
  await admitSignup('azod738@gmail.com', { ip: IP })
  t.deepEqual(await admitSignup('waliullahshah965@gmail.com', { ip: IP }), {
    reason: 'same-ip'
  })
  t.is((await admitSignup('brittany@other.kr', { ip: IP })).reason, 'same-ip')
})

test('the same email coming back from its IP is admitted', async t => {
  const { admitSignup } = screen()
  await admitSignup('Jane@Acme.com', { ip: IP })
  t.is(await admitSignup('jane@acme.com', { ip: IP }), null)
})

test('a different IP is admitted', async t => {
  const { admitSignup } = screen()
  await admitSignup('jane@acme.com', { ip: IP })
  t.is(await admitSignup('john@other.com', { ip: '203.0.113.8' }), null)
})

test('a missing or malformed IP skips the IP rule', async t => {
  const { admitSignup, store } = screen()
  for (const ip of [undefined, null, '', 'not-an-ip', '999.1.1.1']) {
    t.is(await admitSignup(`user${ip}@acme${ip}.com`, { ip }), null)
  }
  t.false([...store.values.keys()].some(key => key.startsWith('ip:')))
  t.is(await admitSignup('a@acme.com', null), null)
})

test('IPs are stored hashed with the secret, and remembered for 30 days', async t => {
  const { admitSignup, store } = screen()
  await admitSignup('jane@acme.com', { ip: IP })
  const ipKeyOf = ({ values }) =>
    [...values.keys()].find(key => key.startsWith('ip:'))
  const key = ipKeyOf(store)
  t.false(key.includes(IP))
  t.regex(key, /^ip:[0-9a-f]{64}$/)
  t.is(store.ttls.get(key), 30 * 24 * 60 * 60 * 1000)
  const other = screen({ secret: 'other' })
  await other.admitSignup('jane@acme.com', { ip: IP })
  t.not(ipKeyOf(other.store), key)
})

test('checkSignup reads without writing, so anyone can call it', async t => {
  const { checkSignup, store } = screen()
  t.is(await checkSignup('first@acme.com'), null)
  t.is(store.values.size, 0)
  t.is(store.sets.size, 0)
})

test('the third address on a domain is refused and blocks it', async t => {
  const { admitSignup, checkSignup } = screen()
  t.is(await admitSignup('pelita@simasamal.com', { ip: '198.51.100.1' }), null)
  t.is(await admitSignup('pagi@simasamal.com', { ip: '198.51.100.2' }), null)
  t.deepEqual(await admitSignup('arya@simasamal.com', { ip: '198.51.100.3' }), {
    reason: 'domain-burst'
  })
  t.deepEqual(
    await admitSignup('pelita@simasamal.com', { ip: '198.51.100.1' }),
    {
      reason: 'blocked-domain'
    }
  )
  t.deepEqual(await checkSignup('new@simasamal.com'), {
    reason: 'blocked-domain'
  })
})

test('a refused burst does not claim the IP', async t => {
  const { admitSignup } = screen({ burstLimit: 2 })
  await admitSignup('a@acme.com')
  t.is((await admitSignup('b@acme.com', { ip: IP })).reason, 'domain-burst')
  t.is(await admitSignup('jane@other.com', { ip: IP }), null)
})

test('the same address reloading does not count towards the burst', async t => {
  const { admitSignup } = screen()
  for (let index = 0; index < 5; index++) {
    t.is(await admitSignup('jane@acme.com'), null)
  }
})

test('a block covers subdomains, without blocking the parent', async t => {
  const { checkSignup, store } = screen()
  block(store, 'simasamal.com')
  t.is((await checkSignup('a@mail.simasamal.com')).reason, 'blocked-domain')
  block(store, 'sub.acme.com')
  t.is(await checkSignup('a@acme.com'), null)
})

test('a shared domain has no burst rule but keeps the IP rule', async t => {
  const { admitSignup } = screen({
    burstLimit: 1,
    isSharedDomain: domain => domain === 'gmail.com'
  })
  t.is(await admitSignup('a@gmail.com', { ip: IP }), null)
  t.is(await admitSignup('b@gmail.com'), null)
  t.is((await admitSignup('c@gmail.com', { ip: IP })).reason, 'same-ip')
})

test('a trusted domain passes every rule', async t => {
  const { admitSignup, checkSignup, store } = screen({
    burstLimit: 1,
    isTrustedDomain: async domain => domain === 'voiceflow.com'
  })
  await admitSignup('someone@else.com', { ip: IP })
  t.is(await admitSignup('a@voiceflow.com', { ip: IP }), null)
  block(store, 'voiceflow.com')
  t.is(await admitSignup('b@voiceflow.com', { ip: IP }), null)
  t.is(await checkSignup('c@voiceflow.com'), null)
})

test('trust is only asked when a rule would refuse, and once', async t => {
  let asked = 0
  const { admitSignup } = screen({
    isTrustedDomain: () => {
      asked++
      return true
    },
    burstLimit: 1
  })
  await admitSignup('a@acme.com', { ip: IP })
  t.is(asked, 1)
  const quiet = { asked: 0 }
  const second = screen({
    isTrustedDomain: () => {
      quiet.asked++
      return false
    }
  })
  await second.admitSignup('a@acme.com', { ip: IP })
  t.is(quiet.asked, 0)
})

test('a store failure rejects, so the caller decides', async t => {
  const store = memoryStore()
  store.read = async () => {
    throw new Error('redis down')
  }
  const { admitSignup } = screen({ store })
  await t.throwsAsync(admitSignup('a@acme.com'), { message: 'redis down' })
})

test('isAbusive without a store only looks for siblings', async t => {
  const lookup = async function * () {
    yield 'destek@acme.com'
  }
  const { isAbusive } = createAbusive({ dataset, lookup })
  t.true(await isAbusive({ email: 'destek6@acme.com', verified: true }))
  t.false(await isAbusive({ email: 'jane@acme.com', ip: IP, verified: true }))
  t.false(await isAbusive({ email: 'other@acme.com', ip: IP, verified: true }))
})

test('isAbusive with neither store nor lookup still refuses malformed input', async t => {
  const { isAbusive } = createAbusive({ dataset })
  t.true(await isAbusive({ email: 'nope' }))
  t.true(await isAbusive())
  t.false(await isAbusive({ email: 'jane@acme.com' }))
})

test('isAbusive reads by default and only writes when verified', async t => {
  const store = memoryStore()
  const { isAbusive } = createAbusive({ dataset, store, secret: 's' })
  t.false(await isAbusive({ email: 'a@acme.com', ip: IP }))
  t.is(store.values.size, 0)
  t.false(await isAbusive({ email: 'a@acme.com', ip: IP, verified: 'yes' }))
  t.is(store.values.size, 0)
  t.false(await isAbusive({ email: 'a@acme.com', ip: IP, verified: true }))
  t.true(store.values.size > 0)
  t.false(await isAbusive({ email: 'b@other.com', ip: IP }))
  t.true(await isAbusive({ email: 'b@other.com', ip: IP, verified: true }))
})

test('a sibling is refused before it can take an IP', async t => {
  const store = memoryStore()
  const lookup = async function * () {
    yield 'destek@acme.com'
  }
  const { isAbusive } = createAbusive({ dataset, lookup, store, secret: 's' })
  t.true(await isAbusive({ email: 'destek6@acme.com', ip: IP, verified: true }))
  t.is(store.values.size, 0)
})

test('isAbusive never rejects: a failed check is not abusive and is reported', async t => {
  const store = memoryStore()
  store.read = async () => {
    throw new Error('redis down')
  }
  const reported = []
  const lookup = async () => {
    throw new Error('stripe down')
  }
  const { isAbusive } = createAbusive({
    dataset,
    lookup,
    store,
    secret: 's',
    onError: ({ error }) => reported.push(error.message)
  })
  t.false(await isAbusive({ email: 'jane@acme.com', ip: IP, verified: true }))
  t.deepEqual(reported, ['redis down', 'stripe down', 'redis down'])
})

test('one failed check does not skip the next', async t => {
  const lookup = async () => {
    throw new Error('stripe down')
  }
  const { isAbusive } = createAbusive({
    dataset,
    lookup,
    store: memoryStore(),
    secret: 's'
  })
  await isAbusive({ email: 'a@acme.com', ip: IP, verified: true })
  t.true(await isAbusive({ email: 'b@other.com', ip: IP, verified: true }))
})

test('hooks report why, and a failing hook changes nothing', async t => {
  const seen = []
  const { isAbusive } = createAbusive({
    dataset,
    onAbusive: details => seen.push(details)
  })
  t.true(await isAbusive({ email: 'nope' }))
  t.deepEqual(seen, [{ email: 'nope', domain: undefined, reason: 'malformed' }])
  t.true(await isAbusive({ email: 'a b@acme.com' }))
  t.is(seen[1].domain, 'acme.com')
  t.true(await isAbusive({ email: 7 }))
  for (const onAbusive of [
    () => {
      throw new Error('boom')
    },
    async () => {
      throw new Error('boom')
    }
  ]) {
    t.true(
      await createAbusive({ dataset, onAbusive }).isAbusive({ email: 'nope' })
    )
  }
  const onError = () => {
    throw new Error('boom')
  }
  const lookup = async () => {
    throw new Error('down')
  }
  t.false(
    await createAbusive({ dataset, lookup, onError }).isAbusive({
      email: 'a@acme.com'
    })
  )
})

test('an oversized domain sends nothing to the store', async t => {
  const store = memoryStore()
  let reads = 0
  const read = store.read
  store.read = key => {
    reads++
    return read(key)
  }
  const { admitSignup, checkSignup } = screen({ store })
  const huge = `a@${'a.'.repeat(50000)}com`
  t.deepEqual(await checkSignup(huge), MALFORMED)
  t.deepEqual(await admitSignup(huge, { ip: IP }), MALFORMED)
  t.deepEqual(
    await admitSignup(`${'a'.repeat(65)}@acme.com`, { ip: IP }),
    MALFORMED
  )
  t.deepEqual(
    await admitSignup(`a@${'a.'.repeat(8)}com`, { ip: IP }),
    MALFORMED
  )
  t.is(reads, 0)
})

test('a free provider can never be blocked by a burst', async t => {
  const { admitSignup } = screen({ burstLimit: 1 })
  for (const domain of ['outlook.com', 'gmail.com']) {
    t.is(await admitSignup(`a@${domain}`), null)
    t.is(await admitSignup(`b@${domain}`), null)
  }
})

test('Gmail stays shared even if the dataset leaves it out', async t => {
  const { admitSignup } = screen({ dataset: [], burstLimit: 1 })
  t.is(await admitSignup('a@gmail.com'), null)
  t.is(await admitSignup('b@googlemail.com'), null)
})

test('an admitted inbox comes back from any IP without taking it', async t => {
  const { admitSignup } = screen()
  await admitSignup('jane@acme.com', { ip: '198.51.100.1' })
  await admitSignup('bob@other.com', { ip: '198.51.100.2' })
  t.is(await admitSignup('jane@acme.com', { ip: '198.51.100.2' }), null)
  t.is(await admitSignup('jane@acme.com', { ip: '198.51.100.3' }), null)
  t.is(await admitSignup('stranger@third.com', { ip: '198.51.100.3' }), null)
})

test('a block still refuses an admitted inbox', async t => {
  const { admitSignup, store } = screen()
  await admitSignup('jane@acme.com')
  block(store, 'acme.com')
  t.is((await admitSignup('jane@acme.com')).reason, 'blocked-domain')
})

test('an address the IP rule refuses does not count towards its domain', async t => {
  const { admitSignup, checkSignup } = screen()
  await admitSignup('a@acme.com', { ip: IP })
  t.is((await admitSignup('b@acme.com', { ip: IP })).reason, 'same-ip')
  t.is((await admitSignup('c@acme.com', { ip: IP })).reason, 'same-ip')
  t.is(await checkSignup('d@acme.com', { ip: '198.51.100.9' }), null)
  t.is(await admitSignup('d@acme.com', { ip: '198.51.100.9' }), null)
})

test('an inbox comes back only as it was first spelled', async t => {
  const { admitSignup } = screen()
  t.is(await admitSignup('jane+1@acme.com'), null)
  t.is(await admitSignup('JANE+1@acme.com'), null)
  for (const local of ['jane+2', 'jane']) {
    t.deepEqual(await admitSignup(`${local}@acme.com`), {
      reason: 'same-inbox'
    })
  }
  await admitSignup('jane@gmail.com', { ip: IP })
  t.is(await admitSignup('jane@gmail.com', { ip: '198.51.100.9' }), null)
  for (const email of [
    'j.a.n.e@gmail.com',
    'jane+x@gmail.com',
    'jane@googlemail.com'
  ]) {
    t.deepEqual(await admitSignup(email), { reason: 'same-inbox' })
  }
})

test('tags and odd mailboxes give one account, whatever findSibling can search', async t => {
  const { admitSignup } = screen()
  const results = []
  for (const tag of [1, 2, 3, 4, 5, 6]) {
    results.push(await admitSignup(`o'brien+${tag}@evil-corp.com`))
    results.push(await admitSignup(`jane+${tag}@bücher-evil.com`))
  }
  t.is(results.filter(result => result === null).length, 2)
})

test('losing to another spelling of the inbox takes no IP', async t => {
  const { admitSignup } = screen()
  const results = await Promise.all([
    admitSignup('jane+1@acme.com', { ip: '198.51.100.1' }),
    admitSignup('jane+2@acme.com', { ip: '198.51.100.2' })
  ])
  t.deepEqual(results, [null, { reason: 'same-inbox' }])
  t.is(await admitSignup('bob@other.com', { ip: '198.51.100.2' }), null)
})

test('a refused signup leaves its inbox free to come back', async t => {
  const { admitSignup, store } = screen({ burstLimit: 2 })
  await admitSignup('owner@acme.com', { ip: IP })
  t.is((await admitSignup('late@other.com', { ip: IP })).reason, 'same-ip')
  t.is(await admitSignup('late@other.com', { ip: '198.51.100.1' }), null)
  await admitSignup('a@burst.com')
  t.is(
    (await admitSignup('b@burst.com', { ip: '198.51.100.2' })).reason,
    'domain-burst'
  )
  t.is(await admitSignup('someone@else.com', { ip: '198.51.100.2' }), null)
  t.is(store.values.size, 8)
})

test('a failed IP claim frees the inbox', async t => {
  const store = memoryStore()
  const claim = store.claim.bind(store)
  store.claim = (key, ...rest) => {
    if (key.startsWith('ip:')) throw new Error('redis down')
    return claim(key, ...rest)
  }
  const { admitSignup } = screen({ store })
  await t.throwsAsync(admitSignup('a@acme.com', { ip: IP }), {
    message: 'redis down'
  })
  t.is(store.values.size, 0)
})

test('signup-safe internationalised punctuation is allowed', async t => {
  const { checkSignup } = screen()
  for (const email of [
    'jo@col·legi.cat',
    'jo@ア・イ.jp',
    'jo@ש׳א.co.il',
    'jo@κ͵α.gr'
  ]) {
    t.is(await checkSignup(email), null)
  }
})

test('simultaneous re-spellings of one inbox give one account', async t => {
  const { admitSignup } = screen()
  const results = await Promise.all(
    [1, 2, 3, 4, 5].map(tag =>
      admitSignup(`victim+${tag}@gmail.com`, { ip: IP })
    )
  )
  t.is(results.filter(result => result === null).length, 1)
  t.is(results.filter(result => result?.reason === 'same-inbox').length, 4)
  const reloads = await Promise.all([
    admitSignup('jane@acme.com'),
    admitSignup('jane@acme.com')
  ])
  t.deepEqual(reloads, [null, null])
})

test('invisible characters in a domain cannot reach another domain', async t => {
  const { admitSignup, checkSignup } = screen({
    isTrustedDomain: domain => domain === domainToASCII('نامهای.ir')
  })
  const joined = 'a@نامه\u200cای.ir'
  t.deepEqual(await admitSignup(joined), MALFORMED)
  t.deepEqual(await checkSignup(joined), MALFORMED)
})

test('a block on a parent refuses subdomains without asking for trust', async t => {
  let asked = 0
  const { admitSignup, checkSignup, store } = screen({
    isTrustedDomain: () => {
      asked++
      return true
    }
  })
  block(store, 'acme.com')
  for (const email of ['a@r1.acme.com', 'a@r2.acme.com']) {
    t.is((await checkSignup(email)).reason, 'blocked-domain')
    t.is((await admitSignup(email)).reason, 'blocked-domain')
  }
  t.is(asked, 0)
  t.is(await checkSignup('a@acme.com'), null)
  t.is(asked, 1)
})

test('simultaneous signups blocking a domain notify once', async t => {
  let fired = 0
  const { admitSignup } = screen({
    burstLimit: 1,
    onBlock: () => {
      fired++
    }
  })
  await Promise.all(
    ['a', 'b', 'c', 'd'].map(local => admitSignup(`${local}@acme.com`))
  )
  await new Promise(resolve => setImmediate(resolve))
  t.is(fired, 1)
})

test('no address or IP is stored in the clear', async t => {
  const { admitSignup, store } = screen()
  await admitSignup('jane@acme.com', { ip: IP })
  const stored = JSON.stringify([
    ...store.values.entries(),
    ...[...store.sets.entries()].map(([key, members]) => [key, [...members]])
  ])
  t.false(stored.includes('jane'))
  t.false(stored.includes(IP))
})

test('trust never applies to a shared domain', async t => {
  const trust = []
  const { admitSignup } = screen({
    isTrustedDomain: domain => {
      trust.push(domain)
      return true
    },
    isSharedDomain: domain => domain === 'uni.example'
  })
  await admitSignup('azod738@gmail.com', { ip: IP })
  t.deepEqual(await admitSignup('wali@gmail.com', { ip: IP }), {
    reason: 'same-ip'
  })
  t.deepEqual(await admitSignup('a@uni.example', { ip: IP }), {
    reason: 'same-ip'
  })
  t.deepEqual(trust, [])
})

test('subdomains of a dataset domain still have the burst rule', async t => {
  const { admitSignup } = screen({ dataset: ['mooo.com'], burstLimit: 2 })
  t.is(await admitSignup('a@mooo.com'), null)
  t.is(await admitSignup('b@mooo.com'), null)
  t.is(await admitSignup('a@attacker.mooo.com'), null)
  t.is((await admitSignup('b@attacker.mooo.com')).reason, 'domain-burst')
})

test('a failed count gives the IP back', async t => {
  const store = memoryStore()
  store.countRecent = async () => {
    throw new Error('redis down')
  }
  const { admitSignup } = screen({ store })
  await t.throwsAsync(admitSignup('a@acme.com', { ip: IP }), {
    message: 'redis down'
  })
  t.is(store.values.size, 0)
})

test('a failed trust check after taking the IP gives it back', async t => {
  const { admitSignup, store } = screen({
    burstLimit: 1,
    isTrustedDomain: () => {
      throw new Error('stripe down')
    }
  })
  await t.throwsAsync(admitSignup('a@acme.com', { ip: IP }), {
    message: 'stripe down'
  })
  t.is(store.values.size, 0)
})

test('a failed block claim still tells you', async t => {
  let fired = 0
  const store = memoryStore()
  const claim = store.claim.bind(store)
  store.claim = (key, ...rest) => {
    if (key.startsWith('blocked:')) return Promise.reject(new Error('timeout'))
    return claim(key, ...rest)
  }
  const { admitSignup } = screen({
    store,
    burstLimit: 1,
    onBlock: () => {
      fired++
    }
  })
  await t.throwsAsync(admitSignup('a@acme.com'), { message: 'timeout' })
  await new Promise(resolve => setImmediate(resolve))
  t.is(fired, 1)
})

test('a failed shared check takes nothing', async t => {
  const { admitSignup, store } = screen({
    isSharedDomain: () => {
      throw new Error('boom')
    }
  })
  await t.throwsAsync(admitSignup('a@acme.com', { ip: IP }), {
    message: 'boom'
  })
  t.is(store.values.size, 0)
})

test('a hung onBlock never stalls the signup, and fires once', async t => {
  let fired = 0
  const { admitSignup } = screen({
    burstLimit: 1,
    onBlock: () => {
      fired++
      return new Promise(() => {})
    }
  })
  t.is((await admitSignup('a@acme.com')).reason, 'domain-burst')
  await new Promise(resolve => setImmediate(resolve))
  t.is(fired, 1)
})

test('findSibling ignores an address too long to be real', async t => {
  const { findSibling } = createAbusive({
    dataset: [],
    lookup: async () => {
      t.fail('lookup must not run')
    }
  })
  t.is(await findSibling(`a@${'.'.repeat(1000)}x`), null)
})

test('googlemail.com and gmail.com share a block', async t => {
  const { checkSignup, store } = screen()
  block(store, 'gmail.com')
  t.is((await checkSignup('a@googlemail.com')).reason, 'blocked-domain')
})

test('an internationalised domain is one domain in both spellings', async t => {
  const { checkSignup, admitSignup, store } = screen({ burstLimit: 2 })
  await admitSignup('a@münchen-test.de')
  t.is(
    (await admitSignup(`b@${domainToASCII('münchen-test.de')}`)).reason,
    'domain-burst'
  )
  block(store, 'münchen.de')
  t.is((await checkSignup('a@xn--mnchen-3ya.de')).reason, 'blocked-domain')
})

test('callbacks only ever receive a clean hostname', async t => {
  const seen = []
  const remember = domain => {
    seen.push(domain)
    return false
  }
  const { admitSignup, checkSignup } = screen({
    isTrustedDomain: remember,
    isSharedDomain: remember
  })
  await admitSignup('owner@acme.com', { ip: IP })
  t.deepEqual(await checkSignup('x@a" OR email~"paying.com'), MALFORMED)
  t.deepEqual(await admitSignup("y@a' OR 1=1 -- .com", { ip: IP }), MALFORMED)
  t.deepEqual([...new Set(seen)], ['acme.com'])
})

test('a returning inbox cannot fire a block when trust lapses', async t => {
  let trusted = true
  const { admitSignup } = screen({
    burstLimit: 2,
    isTrustedDomain: () => trusted
  })
  for (const local of ['a', 'b', 'c', 'd', 'e']) {
    await admitSignup(`${local}@acme.com`)
  }
  trusted = false
  t.is(await admitSignup('a@acme.com'), null)
})

test('losing a race for an IP refuses', async t => {
  const store = memoryStore()
  const claim = store.claim.bind(store)
  store.claim = (key, value, ttlMs) =>
    claim(key, key.startsWith('ip:') ? 'winner' : value, ttlMs)
  const { admitSignup } = screen({ store })
  t.deepEqual(await admitSignup('loser@acme.com', { ip: IP }), {
    reason: 'same-ip'
  })
  t.false([...store.values.keys()].some(key => key.startsWith('admitted:')))
})

test('a mailbox that is only a tag still counts as itself', async t => {
  const { admitSignup } = screen()
  await admitSignup('+a@acme.com', { ip: IP })
  t.is((await admitSignup('+b@acme.com', { ip: IP })).reason, 'same-ip')
})

test('an address no real inbox could have is refused', async t => {
  const { admitSignup, store } = screen()
  block(store, 'evil.com')
  const addresses = [
    'nope',
    'a@evil.com,x@victim-corp.com',
    'x@evil.com,',
    '<x@evil.com>',
    'Bob <x@evil.com>',
    'x@evil.com;',
    'x@evil.com (c)',
    'x@evil.com/path',
    'x@evil.com#',
    'x@evil%2ecom',
    'x@0x7f.1',
    'x@1.2.3.4',
    'x@-.-',
    `x@${'a'.repeat(64)}.com`,
    '<img src=x onerror=alert(1)>@evil.com',
    'a\r\nset-cookie: b@acme.com',
    'a\ud800@acme.com',
    { toString: 1 },
    null
  ]
  for (const email of addresses) {
    t.deepEqual(
      await admitSignup(email, { ip: IP }),
      MALFORMED,
      String(email?.length)
    )
  }
  t.is(store.sets.size, 0)
})

test('whitespace inside the address is refused, around it is ignored', async t => {
  const { admitSignup } = screen()
  t.deepEqual(await admitSignup('a@ acme.com'), MALFORMED)
  t.deepEqual(await admitSignup('a@\tacme.com'), MALFORMED)
  t.is(await admitSignup(' a@acme.com '), null)
  t.is(await admitSignup('a@acme.com'), null)
})

test('internationalised mailboxes and domains are allowed', async t => {
  const { admitSignup } = screen()
  t.is(await admitSignup('josé@münchen.de'), null)
})

test('an internationalised provider in the dataset is one provider', async t => {
  const { admitSignup } = screen({ dataset: ['почта.рф'], burstLimit: 1 })
  t.is(await admitSignup('a@почта.рф'), null)
})

test('simultaneous signups from one IP count only the winner', async t => {
  const { admitSignup, store } = screen()
  const results = await Promise.all(
    ['a', 'b', 'c', 'd', 'e'].map(local =>
      admitSignup(`${local}@acme.com`, { ip: IP })
    )
  )
  t.is(results.filter(result => result === null).length, 1)
  t.is(store.sets.get('burst:acme.com').size, 1)
  t.is(store.values.get('blocked:acme.com'), undefined)
})

test('a failed IP claim counts nothing', async t => {
  const store = memoryStore()
  store.claim = async () => {
    throw new Error('redis down')
  }
  const { admitSignup } = screen({ store })
  await t.throwsAsync(admitSignup('a@acme.com', { ip: IP }))
  t.is(store.sets.size, 0)
})

test('a burst block expires and tells you', async t => {
  const blocked = []
  const { admitSignup, store } = screen({
    burstLimit: 1,
    burstBlockMs: 1000,
    onBlock: domain => {
      blocked.push(domain)
      throw new Error('alert failed')
    }
  })
  t.is((await admitSignup('a@acme.com')).reason, 'domain-burst')
  t.deepEqual(blocked, ['acme.com'])
  t.is(store.ttls.get('blocked:acme.com'), 1000)
})

test('checkSignup cannot tell who is registered or trusted', async t => {
  const { admitSignup, checkSignup } = screen({
    isTrustedDomain: domain => domain === 'paying.com'
  })
  await admitSignup('victim@acme.com', { ip: IP })
  for (const email of [
    'victim@acme.com',
    'nobody@acme.com',
    'x@paying.com',
    'x@unknown.com'
  ]) {
    t.is(await checkSignup(email), null)
  }
})

test('invalid options throw', t => {
  const options = extra => () =>
    createAbusive({ dataset, store: memoryStore(), secret: 's', ...extra })
  for (const [extra, message] of [
    [{ onAbusive: 1 }, /onAbusive/],
    [{ onError: 1 }, /onError/],
    [{ store: {} }, /store/],
    [{ secret: '' }, /secret/],
    [{ secret: undefined }, /secret/],
    [{ burstLimit: 0 }, /burstLimit/],
    [{ ipMemoryMs: 1.5 }, /ipMemoryMs/],
    [{ ipMemoryMs: 1e30 }, /ipMemoryMs/],
    [{ burstWindowMs: -1 }, /burstWindowMs/],
    [{ burstBlockMs: 0 }, /burstBlockMs/],
    [{ onBlock: 1 }, /onBlock/],
    [{ isTrustedDomain: null }, /isTrustedDomain/],
    [{ isSharedDomain: 'gmail.com' }, /isSharedDomain/]
  ]) {
    t.throws(options(extra), { instanceOf: TypeError, message })
  }
})

const networks = [
  ['203.0.113.7', '203.0.113.7'],
  [' 203.0.113.7 ', '203.0.113.7'],
  ['::ffff:203.0.113.7', '203.0.113.7'],
  ['::ffff:cb00:7107', '203.0.113.7'],
  ['2001:db8:1:2:3:4:5:6', '2001:db8:1:2::/64'],
  ['2001:DB8:1:2:aaaa::1', '2001:db8:1:2::/64'],
  ['2001:db8::1', '2001:db8:0:0::/64'],
  ['::1', '0:0:0:0::/64'],
  ['fe80::1%eth0', 'fe80:0:0:0::/64'],
  ['2001:db8:1:2:3:4:1.2.3.4', '2001:db8:1:2::/64']
]

for (const [input, expected] of networks) {
  test(`networkOf(${input})`, t => t.is(networkOf(input), expected))
}

for (const input of [
  '',
  'nope',
  '999.1.1.1',
  '1.2.3',
  '1.2.3.4%eth0',
  '1.2.3.4, 10.0.0.1',
  null,
  undefined,
  7
]) {
  test(`networkOf rejects ${input}`, t => t.is(networkOf(input), null))
}

test('one IPv6 network is one signup', async t => {
  const { admitSignup } = screen()
  await admitSignup('a@acme.com', { ip: '2001:db8:1:2::a' })
  t.is(
    (await admitSignup('b@other.com', { ip: '2001:db8:1:2::b' })).reason,
    'same-ip'
  )
  t.is(await admitSignup('c@third.com', { ip: '2001:db8:1:3::a' }), null)
})
