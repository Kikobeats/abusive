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
    }
  }
}

const abusive = ({ lookup, store = memoryStore(), ...rest } = {}) => {
  const reasons = []
  const errors = []
  const { isAbusive } = createAbusive({
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
  const { isAbusive, store } = abusive()
  for (const ip of [undefined, null, '', 'not-an-ip', '999.1.1.1']) {
    t.false(await isAbusive({ email: 'a@acme.com', ip, verified: true }))
  }
  t.is(store.values.size, 0)
})

test('only a verified address takes an IP or is judged by it', async t => {
  const { isAbusive, store, signup } = abusive()
  for (const verified of [undefined, false, 'true', 1]) {
    t.false(await isAbusive({ email: 'a@acme.com', ip: IP, verified }))
  }
  t.is(store.values.size, 0)
  await signup('a@acme.com')
  t.false(await isAbusive({ email: 'b@other.com', ip: IP }))
  t.true(await signup('b@other.com'))
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

test('without a store it only looks for siblings', async t => {
  const lookup = async function * () {
    yield 'destek@acme.com'
  }
  const { isAbusive } = createAbusive({ sibling: { lookup } })
  t.true(await isAbusive({ email: 'destek6@acme.com', verified: true }))
  t.false(await isAbusive({ email: 'jane@acme.com', ip: IP, verified: true }))
  t.false(await isAbusive({ email: 'other@acme.com', ip: IP, verified: true }))
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
  const { signup, store } = abusive()
  for (const email of [
    'a@@acme.com',
    'a@b@acme.com',
    'a@ acme.com',
    'a b@acme.com',
    'a\t@acme.com',
    'a\u00a0b@acme.com',
    'a@acme.com,b@acme.com',
    'a@acme.com, b@acme.com',
    'Jane <jane@acme.com>'
  ]) {
    t.false(await signup(email), email)
  }
  t.is(store.values.size, 0)
  await signup('jane@acme.com')
  t.false(await signup('a@@acme.com'))
  t.is(store.values.size, 1)
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
