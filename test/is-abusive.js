'use strict'

const test = require('ava').default

const dataset = require('free-email-domains')
const createAbusive = require('..')
const networkOf = require('../src/network')

const IP = '203.0.113.7'

const memoryStore = () => {
  const values = new Map()
  return {
    values,
    claim: async (key, value) => {
      if (!values.has(key)) values.set(key, value)
      return values.get(key)
    },
    peek: async key => values.get(key) ?? null
  }
}

const abusive = ({ lookup, store = memoryStore(), ...rest } = {}) => {
  const reasons = []
  const errors = []
  const { isAbusive, takeIp } = createAbusive({
    rejectedDomains: dataset,
    secret: 'secret',
    onAbusive: ({ reason }) => reasons.push(reason),
    onError: ({ error }) => errors.push(error.message),
    ...rest,
    ...(lookup && { sibling: { lookup } }),
    ip: { store }
  })
  return {
    store,
    reasons,
    errors,
    isAbusive,
    takeIp,
    signup: (email, ip = IP) => isAbusive({ email, ip, verified: true })
  }
}

test('the first signup from an IP is not abusive', async t => {
  t.false(await abusive().signup('jane@acme.com'))
})

test('a different address from a used IP is abusive, on any domain', async t => {
  const { signup, reasons } = abusive()
  await signup('azod738@gmail.com')
  t.true(await signup('waliullahshah965@gmail.com'))
  t.true(await signup('brittany@other.kr'))
  t.deepEqual(reasons, ['ip', 'ip'])
})

test('the same address coming back to its IP is not abusive', async t => {
  const { signup } = abusive()
  await signup('Jane@Acme.com')
  t.false(await signup('jane@acme.com'))
})

test('tagged and dotted spellings are different addresses', async t => {
  const { signup } = abusive()
  await signup('jane@gmail.com')
  for (const email of [
    'jane+1@gmail.com',
    'j.ane@gmail.com',
    'jane@googlemail.com'
  ]) {
    t.true(await signup(email))
  }
})

test('a different IP is not abusive', async t => {
  const { signup } = abusive()
  await signup('jane@acme.com')
  t.false(await signup('john@other.com', '203.0.113.8'))
})

test('a missing or malformed IP skips the rule and stores nothing', async t => {
  const { isAbusive, store, errors } = abusive()
  for (const ip of [undefined, null, '', 'not-an-ip', '999.1.1.1']) {
    t.false(await isAbusive({ email: 'a@acme.com', ip, verified: true }))
  }
  t.is(store.values.size, 0)
  t.deepEqual(errors, [])
})

test('a missing or malformed IP is never read from the store', async t => {
  const store = memoryStore()
  const peeked = []
  store.peek = async key => {
    peeked.push(key)
    return 'someone else'
  }
  const { isAbusive, errors } = abusive({ store })
  for (const ip of [undefined, null, '', 'not-an-ip', '999.1.1.1']) {
    t.false(await isAbusive({ email: 'a@acme.com', ip }))
  }
  t.deepEqual(peeked, [])
  t.deepEqual(errors, [])
})

test('a peek that resolves undefined is a free IP', async t => {
  const store = memoryStore()
  store.peek = async () => undefined
  const { isAbusive, errors } = abusive({ store })
  t.false(await isAbusive({ email: 'a@acme.com', ip: IP }))
  t.deepEqual(errors, [])
})

test('an unverified address never takes an IP', async t => {
  const { isAbusive, store } = abusive()
  for (const verified of [undefined, false, 'true', 1]) {
    t.false(await isAbusive({ email: 'a@acme.com', ip: IP, verified }))
  }
  t.is(store.values.size, 0)
})

test('an unverified address is abusive on an IP another address took', async t => {
  const { isAbusive, signup, store, reasons } = abusive()
  await signup('a@acme.com')
  for (const verified of [undefined, false, 'true', 1]) {
    t.true(await isAbusive({ email: 'b@other.com', ip: IP, verified }))
  }
  t.false(await isAbusive({ email: 'A@Acme.com', ip: IP }))
  t.false(await isAbusive({ email: 'b@other.com', ip: '203.0.113.8' }))
  t.is(store.values.size, 1)
  t.deepEqual(reasons, ['ip', 'ip', 'ip', 'ip'])
})

test('an unverified address is judged by its IPv6 network', async t => {
  const { isAbusive, signup } = abusive()
  await signup('a@acme.com', '2001:db8:1:2::a')
  t.true(await isAbusive({ email: 'b@other.com', ip: '2001:db8:1:2::b' }))
  t.false(await isAbusive({ email: 'b@other.com', ip: '2001:db8:1:3::a' }))
})

test('a store without peek skips the unverified IP check', async t => {
  const store = memoryStore()
  delete store.peek
  const { isAbusive, signup, errors } = abusive({ store })
  await signup('a@acme.com')
  t.false(await isAbusive({ email: 'b@other.com', ip: IP }))
  t.true(await signup('b@other.com'))
  t.deepEqual(errors, [])
})

test('a failed peek is not abusive and is reported', async t => {
  const store = memoryStore()
  store.peek = async () => {
    throw new Error('redis down')
  }
  const { isAbusive, errors } = abusive({ store })
  t.false(await isAbusive({ email: 'b@other.com', ip: IP }))
  t.deepEqual(errors, ['redis down'])
})

test('takeIp takes a free IP for the address, and never takes it from another', async t => {
  const { takeIp, isAbusive, store } = abusive()
  t.is(await takeIp({ email: 'a@acme.com', ip: IP }), undefined)
  t.is(store.values.size, 1)
  await takeIp({ email: 'b@other.com', ip: IP })
  t.is(store.values.size, 1)
  t.false(await isAbusive({ email: 'a@acme.com', ip: IP }))
  t.true(await isAbusive({ email: 'b@other.com', ip: IP }))
})

test('takeIp never reports the address as abusive and never looks for siblings', async t => {
  let lookups = 0
  const lookup = async function * () {
    lookups++
    yield 'destek@acme.com'
  }
  const { takeIp, reasons, store } = abusive({ lookup })
  await takeIp({ email: 'a@acme.com', ip: IP })
  await takeIp({ email: 'destek6@acme.com', ip: IP })
  t.is(lookups, 0)
  t.deepEqual(reasons, [])
  t.is(store.values.size, 1)
})

test('takeIp skips a missing or malformed IP or address', async t => {
  const { takeIp, store, errors } = abusive()
  for (const ip of [undefined, null, '', 'not-an-ip', '999.1.1.1']) {
    await takeIp({ email: 'a@acme.com', ip })
  }
  for (const email of [
    undefined,
    null,
    7,
    'nope',
    'a@b@acme.com',
    'a b@acme.com',
    addressOfLength(321)
  ]) {
    await takeIp({ email, ip: IP })
  }
  t.is(store.values.size, 0)
  t.deepEqual(errors, [])
})

test('takeIp never rejects, and reports a failure', async t => {
  const failing = abusive({
    store: {
      claim: async () => {
        throw new Error('redis down')
      }
    }
  })
  t.is(await failing.takeIp({ email: 'a@acme.com', ip: IP }), undefined)
  t.is(await failing.takeIp(undefined), undefined)
  t.is(await failing.takeIp(null), undefined)
  t.is(
    await failing.takeIp({
      get email () {
        throw new Error('boom')
      }
    }),
    undefined
  )
  t.deepEqual(failing.errors, ['redis down', 'boom'])
})

test('a failed takeIp tells onError which address it was', async t => {
  const seen = []
  const failure = new Error('redis down')
  const { takeIp } = createAbusive({
    ip: {
      store: {
        claim: async () => {
          throw failure
        }
      }
    },
    secret: 'secret',
    onError: details => seen.push(details)
  })
  await takeIp({ email: 'jane@acme.com', ip: IP })
  t.deepEqual(seen, [{ email: 'jane@acme.com', error: failure }])
})

test('takeIp without an IP rule does nothing, and that is no error', async t => {
  const errors = []
  const { takeIp } = createAbusive({
    onError: ({ error }) => errors.push(error)
  })
  t.is(await takeIp({ email: 'a@acme.com', ip: IP }), undefined)
  t.deepEqual(errors, [])
})

test('takeIp without an IP rule still reports a check it cannot read', async t => {
  const failure = new Error('boom')
  const errors = []
  const { takeIp } = createAbusive({
    onError: ({ error }) => errors.push(error)
  })
  const check = {
    get email () {
      throw failure
    }
  }
  t.is(await takeIp(check), undefined)
  t.deepEqual(errors, [failure])
})

test('nothing is stored in the clear', async t => {
  const { signup, store } = abusive()
  await signup('jane@acme.com')
  const [[key, value]] = store.values
  t.regex(key, /^ip:[0-9a-f]{64}$/)
  t.regex(value, /^[0-9a-f]{64}$/)
  const other = abusive({ secret: 'other' })
  await other.signup('jane@acme.com')
  t.false(other.store.values.has(key))
})

test('simultaneous signups from one IP give one account', async t => {
  const { signup } = abusive()
  const results = await Promise.all(
    ['a', 'b', 'c', 'd', 'e'].map(local => signup(`${local}@acme.com`))
  )
  t.is(results.filter(result => result === false).length, 1)
})

test('one IPv6 network is one signup', async t => {
  const { signup } = abusive()
  await signup('a@acme.com', '2001:db8:1:2::a')
  t.true(await signup('b@other.com', '2001:db8:1:2::b'))
  t.false(await signup('c@third.com', '2001:db8:1:3::a'))
})

test('a sibling is abusive before it can take an IP, verified or not', async t => {
  const lookup = async function * () {
    yield 'destek@acme.com'
  }
  const { isAbusive, signup, store, reasons } = abusive({ lookup })
  t.true(await isAbusive({ email: 'destek6@acme.com' }))
  t.true(await signup('destek6@acme.com'))
  t.is(store.values.size, 0)
  t.deepEqual(reasons, ['sibling', 'sibling'])
})

test('without a store it only looks for siblings, and that is no error', async t => {
  const lookup = async function * () {
    yield 'destek@acme.com'
  }
  const errors = []
  const { isAbusive } = createAbusive({
    sibling: { lookup },
    onError: ({ error }) => errors.push(error)
  })
  t.true(await isAbusive({ email: 'destek6@acme.com', verified: true }))
  t.false(await isAbusive({ email: 'jane@acme.com', ip: IP, verified: true }))
  t.false(await isAbusive({ email: 'other@acme.com', ip: IP, verified: true }))
  t.deepEqual(errors, [])
})

test('without a lookup it only applies the IP rule, and that is no error', async t => {
  const { signup, errors } = abusive()
  await signup('a@acme.com')
  t.true(await signup('b@acme.com'))
  t.deepEqual(errors, [])
})

test('a failed check tells onError which address it was', async t => {
  const seen = []
  const failure = new Error('stripe down')
  const { isAbusive } = createAbusive({
    sibling: {
      lookup: () => {
        throw failure
      }
    },
    onError: details => seen.push(details)
  })
  await isAbusive({ email: 'jane@acme.com' })
  t.deepEqual(seen, [{ email: 'jane@acme.com', error: failure }])
})

test('a failed check is not abusive, is reported and skips nothing', async t => {
  const failing = abusive({
    lookup: async () => {
      throw new Error('stripe down')
    },
    store: {
      claim: async () => {
        throw new Error('redis down')
      }
    }
  })
  t.false(await failing.signup('jane@acme.com'))
  t.deepEqual(failing.errors, ['stripe down', 'redis down'])
  const siblingDown = abusive({
    lookup: async () => {
      throw new Error('stripe down')
    }
  })
  await siblingDown.signup('a@acme.com')
  t.true(await siblingDown.signup('b@other.com'))
})

test('it never rejects, whatever it is given', async t => {
  const { isAbusive, errors } = abusive()
  for (const check of [
    undefined,
    null,
    {},
    { email: 7 },
    { email: 'nope' },
    { email: `a@${'.'.repeat(1000)}x` }
  ]) {
    t.false(await isAbusive(check))
  }
  t.false(await isAbusive({ email: 'nope', ip: IP, verified: true }))
  t.false(
    await isAbusive({
      get email () {
        throw new Error('boom')
      }
    })
  )
  t.deepEqual(errors, ['boom'])
})

test('onAbusive reports why, and a failing hook changes nothing', async t => {
  const seen = []
  const { signup } = abusive({ onAbusive: details => seen.push(details) })
  await signup('a@acme.com')
  await signup('b@Other.com')
  t.deepEqual(seen, [
    { email: 'b@Other.com', domain: 'other.com', reason: 'ip' }
  ])
  for (const onAbusive of [
    () => {
      throw new Error('boom')
    },
    async () => {
      throw new Error('boom')
    }
  ]) {
    const quiet = abusive({ onAbusive })
    await quiet.signup('a@acme.com')
    t.true(await quiet.signup('b@other.com'))
  }
})

test('invalid options throw', t => {
  const options = extra => () =>
    createAbusive({ ip: { store: memoryStore() }, secret: 's', ...extra })
  for (const [extra, message] of [
    [{ onAbusive: 1 }, /onAbusive/],
    [{ onError: 1 }, /onError/],
    [{ ip: {} }, /ip\.store/],
    [{ ip: false }, /ip\.store/],
    [{ ip: 7 }, /ip\.store/],
    [{ ip: { store: {} } }, /ip\.store/],
    [{ secret: '' }, /secret/],
    [{ secret: undefined }, /secret/],
    [{ sibling: { lookup: 1 } }, /sibling\.lookup/],
    [{ sibling: { lookup: null } }, /sibling\.lookup/],
    [{ sibling: {} }, /sibling\.lookup/],
    [{ sibling: { min: 2 } }, /sibling\.lookup/],
    [{ sibling: false }, /sibling\.lookup/],
    [{ sibling: 7 }, /sibling\.lookup/],
    [{ sibling: { lookup: () => [], min: 0 } }, /sibling\.min/],
    [{ rejectedDomains: 'a.com' }, /rejectedDomains/],
    [{ rejectedDomains: 7 }, /rejectedDomains/]
  ]) {
    t.throws(options(extra), { instanceOf: TypeError, message })
  }
})

test('no options at all is valid, and every rule is off', async t => {
  const { isAbusive, isRejectedEmail } = createAbusive()
  t.false(await isAbusive({ email: 'jane@acme.com', ip: IP, verified: true }))
  t.false(isRejectedEmail('jane@yopmail.com'))
})

test('a null group is the same as no group', async t => {
  const { isAbusive, findSibling } = createAbusive({ sibling: null, ip: null })
  t.false(await isAbusive({ email: 'jane@acme.com', ip: IP, verified: true }))
  await t.throwsAsync(findSibling('jane@acme.com'), { message: /lookup/ })
})

const addressOfLength = length => `${'a'.repeat(length - 9)}@acme.com`

test('findSibling looks up to 320 characters and ignores anything longer', async t => {
  const targets = []
  const { findSibling } = createAbusive({
    sibling: {
      lookup: target => {
        targets.push(target)
        return []
      }
    }
  })
  t.is(await findSibling(addressOfLength(321)), null)
  t.is(targets.length, 0)
  t.is(await findSibling(addressOfLength(320)), null)
  t.is(targets.length, 1)
})

test('an address over 320 characters is not abusive and takes no IP', async t => {
  const { signup, store } = abusive()
  t.false(await signup(addressOfLength(321)))
  t.is(store.values.size, 0)
  t.false(await signup(addressOfLength(320)))
  t.is(store.values.size, 1)
})

test('an address with two @ or whitespace cannot take an IP or be judged by it', async t => {
  const { isAbusive, signup, store, errors } = abusive()
  const malformed = [
    'a@@acme.com',
    'a@b@acme.com',
    'a@ acme.com',
    'a b@acme.com',
    'a\t@acme.com',
    'a\u00a0b@acme.com',
    'a@acme.com,b@acme.com',
    'a@acme.com, b@acme.com',
    'Jane <jane@acme.com>'
  ]
  for (const email of malformed) {
    t.false(await signup(email), email)
  }
  t.is(store.values.size, 0)
  await signup('jane@acme.com')
  for (const email of malformed) {
    t.false(await signup(email), email)
    t.false(await isAbusive({ email, ip: IP }), email)
  }
  t.is(store.values.size, 1)
  t.deepEqual(errors, [])
})

test('an unusual well-formed address still takes an IP', async t => {
  for (const email of [
    "o'brien@acme.com",
    'josé@acme.com',
    'a@münchen.de',
    'a@localhost',
    '"a"@acme.com'
  ]) {
    const { signup, store } = abusive()
    t.false(await signup(email), email)
    t.is(store.values.size, 1, email)
    t.true(await signup('other@acme.com'), email)
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
  ['2001:db8:1:2:3:4:1.2.3.4', '2001:db8:1:2::/64'],
  ['0:0:0:0:0:FFFF:1.2.3.4', '1.2.3.4'],
  ['::ffff:1.2.3.4%eth0', '1.2.3.4'],
  ['1::ffff:1.2.3.4', '1:0:0:0::/64'],
  ['::1:ffff:1.2.3.4', '0:0:0:0::/64'],
  ['::ffff:0:1.2.3.4', '0:0:0:0::/64'],
  ['2001:db8:1:2::', '2001:db8:1:2::/64'],
  ['::', '0:0:0:0::/64']
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
