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
    async write (key, value) {
      values.set(key, value)
      this.ttls.delete(key)
    },
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

const screen = (signup = {}) => {
  const store = signup.store ?? memoryStore()
  return {
    store,
    ...createAbusive({
      dataset,
      signup: { store, secret: 'secret', ...signup }
    })
  }
}

const IP = '203.0.113.7'
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
  const { blockDomain, checkSignup } = screen()
  await blockDomain('simasamal.com')
  t.is((await checkSignup('a@mail.simasamal.com')).reason, 'blocked-domain')
  await blockDomain('sub.acme.com')
  t.is(await checkSignup('a@acme.com'), null)
})

test('a block never expires', async t => {
  const { blockDomain, store } = screen()
  await blockDomain('simasamal.com')
  t.is(store.ttls.get('blocked:simasamal.com'), undefined)
})

test('unblockDomain clears the block and its count', async t => {
  const { admitSignup, unblockDomain } = screen({ burstLimit: 2 })
  await admitSignup('a@acme.com')
  await admitSignup('b@acme.com')
  await unblockDomain('acme.com')
  t.is(await admitSignup('c@acme.com'), null)
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
  const { admitSignup, blockDomain, checkSignup } = screen({
    burstLimit: 1,
    isTrustedDomain: async domain => domain === 'voiceflow.com'
  })
  await admitSignup('someone@else.com', { ip: IP })
  t.is(await admitSignup('a@voiceflow.com', { ip: IP }), null)
  await blockDomain('voiceflow.com')
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

test('signup methods are absent without the option', t => {
  const abusive = createAbusive({ dataset })
  t.is(abusive.admitSignup, undefined)
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
  const store = memoryStore()
  const { admitSignup } = createAbusive({
    dataset: [],
    signup: { store, secret: 's', burstLimit: 1 }
  })
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
  const { admitSignup, blockDomain } = screen()
  await admitSignup('jane@acme.com')
  await blockDomain('acme.com')
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
  const { admitSignup, blockDomain, checkSignup } = screen({
    isTrustedDomain: domain => domain === domainToASCII('نامهای.ir')
  })
  const joined = 'a@نامه\u200cای.ir'
  t.deepEqual(await admitSignup(joined), MALFORMED)
  t.deepEqual(await checkSignup(joined), MALFORMED)
  await t.throwsAsync(blockDomain('نامه\u200cای.ir'), { instanceOf: TypeError })
})

test('a block on a parent refuses subdomains without asking for trust', async t => {
  let asked = 0
  const { admitSignup, blockDomain, checkSignup } = screen({
    isTrustedDomain: () => {
      asked++
      return true
    }
  })
  await blockDomain('acme.com')
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
  const { admitSignup } = createAbusive({
    dataset: ['mooo.com'],
    signup: { store: memoryStore(), secret: 's', burstLimit: 2 }
  })
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

test('a failing manual block keeps the previous block', async t => {
  const store = memoryStore()
  const { blockDomain, checkSignup } = screen({ store })
  await blockDomain('acme.com')
  store.write = async () => {
    throw new Error('redis down')
  }
  await t.throwsAsync(blockDomain('acme.com'))
  t.is((await checkSignup('a@acme.com')).reason, 'blocked-domain')
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
  const { blockDomain, checkSignup } = screen()
  await blockDomain('gmail.com')
  t.is((await checkSignup('a@googlemail.com')).reason, 'blocked-domain')
})

test('an internationalised domain is one domain in both spellings', async t => {
  const { blockDomain, checkSignup, admitSignup } = screen({ burstLimit: 2 })
  await admitSignup('a@münchen-test.de')
  t.is(
    (await admitSignup(`b@${domainToASCII('münchen-test.de')}`)).reason,
    'domain-burst'
  )
  await blockDomain('münchen.de')
  t.is((await checkSignup('a@xn--mnchen-3ya.de')).reason, 'blocked-domain')
})

test('manual block and unblock accept any spelling and refuse non-domains', async t => {
  const { blockDomain, unblockDomain, checkSignup } = screen()
  await blockDomain('Acme.COM.')
  t.is((await checkSignup('a@acme.com')).reason, 'blocked-domain')
  await unblockDomain('ACME.com')
  t.is(await checkSignup('a@acme.com'), null)
  await t.throwsAsync(blockDomain('localhost'), { instanceOf: TypeError })
  await t.throwsAsync(unblockDomain('a b.com'), { instanceOf: TypeError })
  await t.throwsAsync(blockDomain('evil.com/path'), { instanceOf: TypeError })
  await t.throwsAsync(blockDomain('1.2.3.4'), { instanceOf: TypeError })
  await t.throwsAsync(blockDomain(['evil.com']), { instanceOf: TypeError })
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
  for (const local of ['a', 'b', 'c', 'd', 'e']) { await admitSignup(`${local}@acme.com`) }
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
  const { admitSignup, blockDomain, store } = screen()
  await blockDomain('evil.com')
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

test('internationalised mailboxes and domains are allowed', async t => {
  const { admitSignup } = screen()
  t.is(await admitSignup('josé@münchen.de'), null)
})

test('an internationalised provider in the dataset is one provider', async t => {
  const { admitSignup } = createAbusive({
    dataset: ['почта.рф'],
    signup: { store: memoryStore(), secret: 's', burstLimit: 1 }
  })
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

test('a burst block expires and tells you, a manual block stays', async t => {
  const blocked = []
  const { admitSignup, blockDomain, store } = screen({
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
  await blockDomain('acme.com')
  t.is(store.ttls.get('blocked:acme.com'), undefined)
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

test('forgetSignup frees a refused person', async t => {
  const { admitSignup, forgetSignup } = screen()
  await admitSignup('owner@acme.com', { ip: IP })
  t.is((await admitSignup('wrong@other.com', { ip: IP })).reason, 'same-ip')
  await forgetSignup('wrong@other.com', { ip: IP })
  t.is(await admitSignup('wrong@other.com', { ip: IP }), null)
  await admitSignup('jane+1@third.com')
  await forgetSignup('jane+1@third.com')
  t.is(await admitSignup('jane+2@third.com'), null)
  await forgetSignup('nope')
})

test('invalid signup options throw', t => {
  const options = signup => () =>
    createAbusive({
      dataset,
      signup: { store: memoryStore(), secret: 's', ...signup }
    })
  t.throws(options({ store: {} }), { instanceOf: TypeError, message: /store/ })
  t.throws(options({ store: null }), {
    instanceOf: TypeError,
    message: /store/
  })
  t.throws(options({ secret: '' }), {
    instanceOf: TypeError,
    message: /secret/
  })
  t.throws(options({ burstLimit: 0 }), {
    instanceOf: TypeError,
    message: /burstLimit/
  })
  t.throws(options({ ipMemoryMs: 1.5 }), {
    instanceOf: TypeError,
    message: /ipMemoryMs/
  })
  t.throws(options({ burstWindowMs: -1 }), {
    instanceOf: TypeError,
    message: /burstWindowMs/
  })
  t.throws(options({ ipMemoryMs: 1e30 }), {
    instanceOf: TypeError,
    message: /ipMemoryMs/
  })
  t.throws(options({ burstBlockMs: 0 }), {
    instanceOf: TypeError,
    message: /burstBlockMs/
  })
  t.throws(options({ onBlock: 1 }), {
    instanceOf: TypeError,
    message: /onBlock/
  })
  t.throws(options({ isTrustedDomain: null }), {
    instanceOf: TypeError,
    message: /isTrustedDomain/
  })
  t.throws(options({ isSharedDomain: 'gmail.com' }), {
    instanceOf: TypeError,
    message: /isSharedDomain/
  })
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
