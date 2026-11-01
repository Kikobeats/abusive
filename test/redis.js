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
  t.is(await store.claim('ip:a', 'jane'), 'jane')
  t.deepEqual(client.calls[0], [
    'set',
    'abusive:ip:a',
    'jane',
    'PX',
    30 * 24 * 60 * 60 * 1000,
    'NX'
  ])
  t.is(await store.claim('ip:a', 'john'), 'jane')
})

test('ttlMs replaces the 30 day default', async t => {
  const client = fakeRedis()
  await redisStore(client, { ttlMs: 5 }).claim('k', 'v')
  t.deepEqual(client.calls[0], ['set', 'abusive:k', 'v', 'PX', 5, 'NX'])
})

test('the prefix can change', async t => {
  const client = fakeRedis()
  await redisStore(client, { prefix: 'preview:' }).claim('k', 'v')
  t.true(client.values.has('preview:k'))
})

test('claim tries again when the holder lets go between the two reads', async t => {
  const client = fakeRedis()
  const set = client.set
  let attempts = 0
  client.set = (...args) => (++attempts === 1 ? null : set(...args))
  t.is(await redisStore(client).claim('ip:a', 'jane'), 'jane')
  t.is(client.values.get('abusive:ip:a'), 'jane')
})

test('claim never pretends to hold a key it could not store', async t => {
  for (const reply of [null, undefined, 'QUEUED']) {
    const client = fakeRedis()
    client.set = async () => reply
    await t.throwsAsync(redisStore(client).claim('ip:a', 'jane'), {
      message: /could not claim/
    })
  }
})

test('the client can come from a function, resolved on each claim', async t => {
  const client = fakeRedis()
  let calls = 0
  const store = redisStore(async () => {
    calls++
    return client
  })
  t.is(await store.claim('ip:a', 'jane'), 'jane')
  t.is(await store.claim('ip:a', 'john'), 'jane')
  t.is(calls, 2)
})

test('a client function that fails rejects the claim', async t => {
  const store = redisStore(async () => null)
  await t.throwsAsync(store.claim('k', 'v'), { instanceOf: TypeError })
})

test('timeoutMs rejects instead of hanging on a stalled Redis', async t => {
  const stalled = { set: () => new Promise(() => {}) }
  const store = redisStore(stalled, { timeoutMs: 10 })
  await t.throwsAsync(store.claim('k', 'v'), { message: /timed out/ })
})

test('without timeoutMs a slow Redis is waited for', async t => {
  const client = fakeRedis()
  const set = client.set
  client.set = async (...args) => {
    await new Promise(resolve => setTimeout(resolve, 20))
    return set(...args)
  }
  t.is(await redisStore(client).claim('k', 'v'), 'v')
})

test('timeoutMs does not get in the way of a working Redis', async t => {
  const store = redisStore(fakeRedis(), { timeoutMs: 1000 })
  t.is(await store.claim('k', 'v'), 'v')
})

test('a client is required', t => {
  t.throws(() => redisStore(), { instanceOf: TypeError })
  t.throws(() => redisStore(null), { instanceOf: TypeError })
})

const NOT_MILLISECONDS = [null, 0, -1, 1.5, NaN, Infinity, '1000']

test('a timeoutMs that setTimeout would turn into 1ms throws', t => {
  for (const timeoutMs of [...NOT_MILLISECONDS, 2 ** 31]) {
    t.throws(() => redisStore(fakeRedis(), { timeoutMs }), {
      instanceOf: TypeError,
      message: /timeoutMs/
    })
  }
})

test('the longest timeoutMs and the shortest still claim', async t => {
  for (const timeoutMs of [2 ** 31 - 1, 1]) {
    const store = redisStore(fakeRedis(), { timeoutMs })
    t.is(await store.claim('k', 'v'), 'v')
  }
})

test('an explicit undefined timeoutMs and ttlMs mean their defaults', async t => {
  const client = fakeRedis()
  const store = redisStore(client, { timeoutMs: undefined, ttlMs: undefined })
  await store.claim('k', 'v')
  t.is(client.calls[0][4], 30 * 24 * 60 * 60 * 1000)
})

test('a ttlMs Redis would refuse throws', t => {
  for (const ttlMs of [...NOT_MILLISECONDS, 2 ** 53]) {
    t.throws(() => redisStore(fakeRedis(), { ttlMs }), {
      instanceOf: TypeError,
      message: /ttlMs/
    })
  }
})

test('the shortest ttlMs still claims', async t => {
  const client = fakeRedis()
  await redisStore(client, { ttlMs: 1 }).claim('k', 'v')
  t.is(client.calls[0][4], 1)
})
