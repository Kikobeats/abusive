'use strict'

const test = require('ava').default

const redisStore = require('../src/redis')

const fakeRedis = () => {
  const calls = []
  const values = new Map()
  return {
    calls,
    values,
    set: async (key, value, ...options) => {
      calls.push(['set', key, value, ...options])
      if (values.has(key)) return null
      values.set(key, value)
      return 'OK'
    },
    get: async key => values.get(key) ?? null
  }
}

test('claim sets only when absent, with its TTL and prefix', async t => {
  const client = fakeRedis()
  const store = redisStore(client)
  t.is(await store.claim('ip:a', 'jane', 1000), 'jane')
  t.deepEqual(client.calls[0], [
    'set',
    'abusive:ip:a',
    'jane',
    'PX',
    1000,
    'NX'
  ])
  t.is(await store.claim('ip:a', 'john', 1000), 'jane')
})

test('the prefix can change', async t => {
  const client = fakeRedis()
  await redisStore(client, { prefix: 'preview:' }).claim('k', 'v', 1)
  t.true(client.values.has('preview:k'))
})

test('claim tries again when the holder lets go between the two reads', async t => {
  const client = fakeRedis()
  const set = client.set
  let attempts = 0
  client.set = (...args) => (++attempts === 1 ? null : set(...args))
  t.is(await redisStore(client).claim('ip:a', 'jane', 1000), 'jane')
  t.is(client.values.get('abusive:ip:a'), 'jane')
})

test('claim never pretends to hold a key it could not store', async t => {
  const client = fakeRedis()
  client.set = async () => null
  await t.throwsAsync(redisStore(client).claim('ip:a', 'jane', 1000), {
    message: /could not claim/
  })
})

test('the client can come from a function, resolved on each claim', async t => {
  const client = fakeRedis()
  let calls = 0
  const store = redisStore(async () => {
    calls++
    return client
  })
  t.is(await store.claim('ip:a', 'jane', 1000), 'jane')
  t.is(await store.claim('ip:a', 'john', 1000), 'jane')
  t.is(calls, 2)
})

test('a client function that fails rejects the claim', async t => {
  const store = redisStore(async () => null)
  await t.throwsAsync(store.claim('k', 'v', 1), { instanceOf: TypeError })
})

test('timeoutMs rejects instead of hanging on a stalled Redis', async t => {
  const stalled = { set: () => new Promise(() => {}) }
  const store = redisStore(stalled, { timeoutMs: 10 })
  await t.throwsAsync(store.claim('k', 'v', 1), { message: /timed out/ })
})

test('timeoutMs does not get in the way of a working Redis', async t => {
  const store = redisStore(fakeRedis(), { timeoutMs: 1000 })
  t.is(await store.claim('k', 'v', 1), 'v')
})

test('a client is required', t => {
  t.throws(() => redisStore(), { instanceOf: TypeError })
})
