'use strict'

const test = require('ava').default

const redisStore = require('../src/redis')

const fakeRedis = () => {
  const calls = []
  const values = new Map()
  const client = {
    calls,
    values,
    set: async (key, value, ...options) => {
      calls.push(['set', key, value, ...options])
      if (values.has(key)) return null
      values.set(key, value)
      return 'OK'
    },
    get: async key => values.get(key) ?? null,
    del: async (...keys) => {
      calls.push(['del', ...keys])
      keys.forEach(key => values.delete(key))
      return keys.length
    },
    multi: () => {
      const queued = []
      const chain = {
        zadd: (...args) => {
          queued.push(['zadd', ...args])
          return chain
        },
        zremrangebyscore: (...args) => {
          queued.push(['zremrangebyscore', ...args])
          return chain
        },
        zcard: (...args) => {
          queued.push(['zcard', ...args])
          return chain
        },
        pexpire: (...args) => {
          queued.push(['pexpire', ...args])
          return chain
        },
        exec: async () => {
          calls.push(...queued)
          return (
            client.execReply ?? [
              [null, 0],
              [null, 1],
              [null, 4],
              [null, 1]
            ]
          )
        }
      }
      return chain
    }
  }
  return client
}

test('claim sets only when absent, with its TTL and prefix', async t => {
  const client = fakeRedis()
  const store = redisStore(client)
  t.is(await store.claim('ip:a', 'jane@acme.com', 1000), 'jane@acme.com')
  t.deepEqual(client.calls[0], [
    'set',
    'abusive:ip:a',
    'jane@acme.com',
    'PX',
    1000,
    'NX'
  ])
  t.is(await store.claim('ip:a', 'john@acme.com', 1000), 'jane@acme.com')
})

test('claim without a TTL never expires', async t => {
  const client = fakeRedis()
  await redisStore(client).claim('blocked:a.com', '1')
  t.deepEqual(client.calls[0], ['set', 'abusive:blocked:a.com', '1', 'NX'])
})

test('claim tries again when the holder lets go between the two reads', async t => {
  const client = fakeRedis()
  const set = client.set
  let attempts = 0
  client.set = (...args) => (++attempts === 1 ? null : set(...args))
  t.is(
    await redisStore(client).claim('ip:a', 'jane@acme.com', 1000),
    'jane@acme.com'
  )
  t.is(client.values.get('abusive:ip:a'), 'jane@acme.com')
})

test('claim never pretends to hold a key it could not store', async t => {
  const client = fakeRedis()
  client.set = async () => null
  await t.throwsAsync(redisStore(client).claim('ip:a', 'jane@acme.com', 1000), {
    message: /could not claim/
  })
})

test('read and remove use the prefix', async t => {
  const client = fakeRedis()
  const store = redisStore(client, { prefix: 'preview:' })
  await store.claim('k', 'v')
  t.is(await store.read('k'), 'v')
  await store.remove('k', 'l')
  t.deepEqual(client.calls.slice(-2), [
    ['del', 'preview:k'],
    ['del', 'preview:l']
  ])
})

test('write overwrites with no expiry', async t => {
  const client = fakeRedis()
  await redisStore(client).write('blocked:a.com', '1')
  t.deepEqual(client.calls[0], ['set', 'abusive:blocked:a.com', '1'])
})

test('countRecent keeps first-seen times and drops old members', async t => {
  const client = fakeRedis()
  const before = Date.now()
  t.is(await redisStore(client).countRecent('burst:a.com', 'a@a.com', 100), 4)
  const [trim, zadd, zcard, pexpire] = client.calls
  t.deepEqual(zadd.slice(0, 3), ['zadd', 'abusive:burst:a.com', 'NX'])
  t.true(zadd[3] >= before)
  t.is(zadd[4], 'a@a.com')
  t.deepEqual(trim.slice(0, 3), ['zremrangebyscore', 'abusive:burst:a.com', 0])
  t.is(trim[3], zadd[3] - 100)
  t.deepEqual(
    client.calls.map(([name]) => name),
    ['zremrangebyscore', 'zadd', 'zcard', 'pexpire']
  )
  t.deepEqual(zcard, ['zcard', 'abusive:burst:a.com'])
  t.deepEqual(pexpire, ['pexpire', 'abusive:burst:a.com', 100])
})

test('countRecent surfaces a failed reply', async t => {
  const client = fakeRedis()
  client.execReply = [
    [null, 0],
    [new Error('oom'), null],
    [null, 4],
    [null, 1]
  ]
  await t.throwsAsync(redisStore(client).countRecent('k', 'm', 100), {
    message: 'oom'
  })
})

test('a client is required', t => {
  t.throws(() => redisStore(), { instanceOf: TypeError })
})
