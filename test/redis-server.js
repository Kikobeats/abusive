'use strict'

const { randomUUID } = require('crypto')
const { setTimeout: sleep } = require('timers/promises')
const test = require('ava').default
const Redis = require('ioredis')

const createAbusive = require('..')
const redisStore = require('../src/redis')

const ROUNDS = 100
const SIMULTANEOUS_SIGNUPS = 20
const CLOSED_PORT = 1

const client = new Redis({ maxRetriesPerRequest: 1 })
const prefix = `abusive-test:${randomUUID()}:`

const keysOf = testPrefix => client.keys(`${testPrefix}*`)

const signupsOn = (options = {}) => {
  const errors = []
  const { isAbusive } = createAbusive({
    ip: { store: redisStore(client, { prefix, ...options }) },
    secret: 'secret',
    onError: ({ error }) => errors.push(error.message)
  })
  return {
    errors,
    signup: (email, ip) => isAbusive({ email, ip })
  }
}

test.after.always(async () => {
  try {
    const keys = await keysOf(prefix)
    if (keys.length > 0) await client.del(keys)
  } finally {
    client.disconnect()
  }
})

test('simultaneous signups from one IP give one winner, every round', async t => {
  const { signup, errors } = signupsOn()
  for (let round = 0; round < ROUNDS; round++) {
    const ip = `198.51.${round}.1`
    const results = await Promise.all(
      Array.from({ length: SIMULTANEOUS_SIGNUPS }, (_, index) =>
        signup(`user${index}@acme.com`, ip)
      )
    )
    t.is(results.filter(isRefused => !isRefused).length, 1, ip)
  }
  t.deepEqual(errors, [])
})

test('the same address keeps its IP, and another address is refused', async t => {
  const { signup } = signupsOn()
  t.false(await signup('jane@acme.com', '203.0.113.1'))
  t.false(await signup('Jane@Acme.com', '203.0.113.1'))
  t.true(await signup('john@acme.com', '203.0.113.1'))
})

test('Redis holds nothing in the clear', async t => {
  const ownPrefix = `${prefix}clear:`
  const { signup } = signupsOn({ prefix: ownPrefix })
  await signup('jane@acme.com', '203.0.113.2')
  const keys = await keysOf(ownPrefix)
  t.is(keys.length, 1)
  t.regex(keys[0].slice(ownPrefix.length), /^ip:[0-9a-f]{64}$/)
  t.regex(await client.get(keys[0]), /^[0-9a-f]{64}$/)
})

test('a claim never expires by default', async t => {
  const ownPrefix = `${prefix}ttl:`
  const { signup } = signupsOn({ prefix: ownPrefix })
  await signup('jane@acme.com', '203.0.113.3')
  const [key] = await keysOf(ownPrefix)
  t.is(await client.pttl(key), -1)
})

test('the IP is free again once ttlMs has passed', async t => {
  const { signup } = signupsOn({ prefix: `${prefix}expiry:`, ttlMs: 50 })
  t.false(await signup('jane@acme.com', '203.0.113.4'))
  t.true(await signup('john@acme.com', '203.0.113.4'))
  await sleep(120)
  t.false(await signup('john@acme.com', '203.0.113.4'))
})

test('a client from a function works the same', async t => {
  const store = redisStore(async () => client, { prefix: `${prefix}lazy:` })
  t.is(await store.claim('k', 'jane'), 'jane')
  t.is(await store.claim('k', 'john'), 'jane')
})

test('an unreachable Redis is a failed check once timeoutMs passes', async t => {
  const unreachable = new Redis({
    port: CLOSED_PORT,
    maxRetriesPerRequest: null,
    retryStrategy: () => 1000
  })
  unreachable.on('error', () => {})
  const errors = []
  const { isAbusive } = createAbusive({
    ip: { store: redisStore(unreachable, { timeoutMs: 100 }) },
    secret: 'secret',
    onError: ({ error }) => errors.push(error.message)
  })
  t.false(
    await isAbusive({
      email: 'jane@acme.com',
      ip: '203.0.113.5'
    })
  )
  t.deepEqual(errors, ['redis store timed out'])
  unreachable.disconnect()
})
