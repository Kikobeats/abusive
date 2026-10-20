'use strict'

const test = require('ava').default

const dataset = require('free-email-domains')
const createAbusive = require('..')
const pairs = require('./fixtures/pairs')

const FULLWIDTH_GMAIL = String.fromCodePoint(
  0xff27,
  0xff2d,
  0xff21,
  0xff29,
  0xff2c
)
const IDEOGRAPHIC_DOT = String.fromCodePoint(0x3002)
const FULLWIDTH_DOT = String.fromCodePoint(0xff0e)
const HALFWIDTH_DOT = String.fromCodePoint(0xff61)
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b)
const LEFT_TO_RIGHT_MARK = String.fromCodePoint(0x200e)
const SOFT_HYPHEN = String.fromCodePoint(0xad)
const VARIATION_SELECTOR = String.fromCodePoint(0xfe0f)
const VARIATION_SELECTOR_SUPPLEMENT = String.fromCodePoint(0xe0100)

const { isFreeEmail, isFreeEmailDomain, isSibling, parseEmail } = createAbusive(
  { dataset }
)

async function * asyncEmails (...emails) {
  yield * emails
}

const recordingLookup = (...emails) => {
  const targets = []
  const lookup = target => {
    targets.push(target)
    return emails
  }
  return { targets, lookup }
}

test('parseEmail splits the canonical address at the last @', t => {
  t.deepEqual(parseEmail('Kiko@Microlink.io'), {
    local: 'kiko',
    domain: 'microlink.io'
  })
  t.deepEqual(parseEmail('  kiko@microlink.io.  '), {
    local: 'kiko',
    domain: 'microlink.io'
  })
  t.deepEqual(parseEmail(`KIKO+1@${FULLWIDTH_GMAIL}.COM`), {
    local: 'kiko+1',
    domain: 'gmail.com'
  })
  t.deepEqual(parseEmail(`kiko@gmail${IDEOGRAPHIC_DOT}com`), {
    local: 'kiko',
    domain: 'gmail.com'
  })
  t.deepEqual(parseEmail(`kiko@gmail${HALFWIDTH_DOT}com`), {
    local: 'kiko',
    domain: 'gmail.com'
  })
  t.deepEqual(parseEmail(`${LEFT_TO_RIGHT_MARK}kiko@gmail.com`), {
    local: 'kiko',
    domain: 'gmail.com'
  })
  t.deepEqual(parseEmail(`ki${VARIATION_SELECTOR}ko@gmail.com`), {
    local: 'kiko',
    domain: 'gmail.com'
  })
  t.deepEqual(parseEmail(`ki${VARIATION_SELECTOR_SUPPLEMENT}ko@gmail.com`), {
    local: 'kiko',
    domain: 'gmail.com'
  })
  t.deepEqual(parseEmail(`kiko@yopmail.com${ZERO_WIDTH_SPACE}`), {
    local: 'kiko',
    domain: 'yopmail.com'
  })
  t.deepEqual(parseEmail('"a@microlink.io"@yopmail.com'), {
    local: '"a@microlink.io"',
    domain: 'yopmail.com'
  })
})

test('parseEmail returns null for malformed input', t => {
  for (const email of ['', 'not-an-email', '@gmail.com', 'kiko@', 'kiko@...']) {
    t.is(parseEmail(email), null, email)
  }
})

test('parseEmail is also exported without a dataset', t => {
  t.is(createAbusive.parseEmail, parseEmail)
  t.is(createAbusive.createAbusive, createAbusive)
})

test('isFreeEmailDomain matches a provider and its subdomains', t => {
  for (const domain of [
    'gmail.com',
    'hotmail.com',
    'yopmail.com',
    'YOPMAIL.COM',
    'yopmail.com.',
    'sub.mailinator.com',
    'kiko.33mail.com'
  ]) {
    t.true(isFreeEmailDomain(domain), domain)
  }
  for (const domain of [
    'microlink.io',
    'company.co.uk',
    'aramamotorukayit.com',
    'gmail.com.evil.io'
  ]) {
    t.false(isFreeEmailDomain(domain), domain)
  }
})

test('isFreeEmail reads the domain of an address', t => {
  t.true(isFreeEmail('someone@yopmail.com'))
  t.true(isFreeEmail(`someone@yopmail${FULLWIDTH_DOT}com`))
  t.true(isFreeEmail(`someone@yo${SOFT_HYPHEN}pmail.com`))
  t.true(isFreeEmail('"a@microlink.io"@yopmail.com'))
  t.false(isFreeEmail('kiko@microlink.io'))
  t.false(isFreeEmail('not-an-email'))
})

test('createAbusive uses only the provided dataset', t => {
  const abusive = createAbusive({ dataset: new Set(['Corp-Mail.example.']) })
  t.true(abusive.isFreeEmail('someone@corp-mail.example'))
  t.true(abusive.isFreeEmailDomain('sub.corp-mail.example'))
  t.false(abusive.isFreeEmail('someone@gmail.com'))
})

test('createAbusive validates its options', t => {
  for (const invalid of [undefined, null, 42, 'gmail.com', {}]) {
    t.throws(
      () => createAbusive({ dataset: invalid }),
      { instanceOf: TypeError, message: /dataset/ },
      String(invalid)
    )
  }
  t.throws(() => createAbusive(), { instanceOf: TypeError })
  t.throws(() => createAbusive({ dataset, lookup: [] }), {
    instanceOf: TypeError,
    message: /lookup/
  })
  for (const invalid of [null, -1, 1.5, Number.NaN, '2']) {
    t.throws(
      () => createAbusive({ dataset, limit: invalid }),
      { instanceOf: TypeError, message: /limit/ },
      String(invalid)
    )
  }
  for (const invalid of [0, -1, 1.5, '2', null]) {
    t.throws(
      () => createAbusive({ dataset, minSiblings: invalid }),
      { instanceOf: TypeError, message: /minSiblings/ },
      String(invalid)
    )
  }
})

test('isSibling catches the same inbox written another way', t => {
  for (const [a, b] of pairs.sameInbox) t.true(isSibling(a, b), `${a} ~ ${b}`)
})

test('isSibling catches numbered and separated variants', t => {
  for (const [a, b] of pairs.numbered) t.true(isSibling(a, b), `${a} ~ ${b}`)
})

test('isSibling ignores format characters hiding a variant', t => {
  for (const hidden of [
    VARIATION_SELECTOR,
    VARIATION_SELECTOR_SUPPLEMENT,
    LEFT_TO_RIGHT_MARK
  ]) {
    t.true(isSibling(`destek${hidden}6@acme.com`, 'destek@acme.com'))
  }
})

test('isSibling is also exported without a dataset', t => {
  t.is(createAbusive.isSibling, isSibling)
})

test('isSibling keeps different people, the same address and other domains apart', t => {
  for (const [a, b] of pairs.strangers) t.false(isSibling(a, b), `${a} !~ ${b}`)
  t.true(
    isSibling(parseEmail('destek6@acme.com'), parseEmail('destek@acme.com'))
  )
})

test('findSibling returns the first registered sibling', async t => {
  const { lookup } = recordingLookup(
    'boss@gmail.com',
    null,
    'derek1@gmail.com',
    'derek2@gmail.com'
  )
  const { findSibling } = createAbusive({ dataset, lookup })
  t.is(await findSibling('derek3@gmail.com'), 'derek1@gmail.com')
  t.is(await findSibling('jane@gmail.com'), null)
  t.is(await findSibling('derek1@gmail.com'), 'derek2@gmail.com')
})

test('findSibling passes the canonical domain and a keyword to the lookup', async t => {
  const { targets, lookup } = recordingLookup()
  const { findSibling } = createAbusive({ dataset, lookup })
  await findSibling('Destek6@AramaMotoruKayit.COM.')
  await findSibling('derek.smithson7@gmail.com')
  await findSibling('derek+promotions@gmail.com')
  await findSibling('42ab@acme.com')
  await findSibling('smithson.derek@gmail.com')
  await findSibling('d.e.r.e.k@gmail.com')
  await findSibling('a1b2c@acme.com')
  await findSibling('abc.def@hotmail.com')
  t.deepEqual(targets, [
    { domain: 'aramamotorukayit.com', keyword: 'destek' },
    { domain: 'gmail.com', keyword: 'smithson' },
    { domain: 'googlemail.com', keyword: 'smithson' },
    { domain: 'gmail.com', keyword: 'derek' },
    { domain: 'googlemail.com', keyword: 'derek' },
    { domain: 'acme.com', keyword: '42ab' },
    { domain: 'gmail.com', keyword: 'smithson' },
    { domain: 'googlemail.com', keyword: 'smithson' },
    { domain: 'gmail.com', keyword: 'derek' },
    { domain: 'googlemail.com', keyword: 'derek' },
    { domain: 'acme.com', keyword: 'a1b2c' },
    { domain: 'hotmail.com', keyword: 'abc' }
  ])
})

test('findSibling skips lookup entries that are not strings', async t => {
  const { findSibling } = createAbusive({
    dataset,
    lookup: () => [{ email: 'destek@acme.com' }, 42, 'destek@acme.com']
  })
  t.is(await findSibling('destek6@acme.com'), 'destek@acme.com')
})

test('findSibling still matches when format characters hide the mailbox', async t => {
  const { targets, lookup } = recordingLookup('destek@acme.com')
  const { findSibling } = createAbusive({ dataset, lookup })
  t.is(
    await findSibling(`destek${LEFT_TO_RIGHT_MARK}6@acme.com`),
    'destek@acme.com'
  )
  t.deepEqual(targets, [{ domain: 'acme.com', keyword: 'destek' }])
})

test('findSibling reads sync, async and promised iterables', async t => {
  const email = 'destek6@acme.com'
  t.is(
    await createAbusive({
      dataset,
      lookup: () => ['destek@acme.com']
    }).findSibling(email),
    'destek@acme.com'
  )
  t.is(
    await createAbusive({
      dataset,
      lookup: () => asyncEmails('destek@acme.com')
    }).findSibling(email),
    'destek@acme.com'
  )
  t.is(
    await createAbusive({
      dataset,
      lookup: async () => ['destek@acme.com']
    }).findSibling(email),
    'destek@acme.com'
  )
})

test('findSibling never looks up what cannot be safely queried or matched', async t => {
  const { targets, lookup } = recordingLookup('destek@acme.com')
  const { findSibling } = createAbusive({ dataset, lookup })
  const unsafe = [
    'destek1@acme".com',
    'destek1@acme',
    'destek1@exa mple.com',
    'destek1@acme.com/x',
    `destek1@m${String.fromCodePoint(0xfc)}nchen.de`,
    'destek1@acme.com" OR email~"x',
    'des"tek1@acme.com',
    '"destek1"@acme.com',
    'destek\\1@acme.com',
    '+promo@acme.com',
    '.-_@acme.com',
    'not-an-email',
    ''
  ]
  for (const email of unsafe) t.is(await findSibling(email), null, email)
  t.deepEqual(targets, [])
})

test('findSibling without a lookup rejects', async t => {
  await t.throwsAsync(
    createAbusive({ dataset }).findSibling('destek1@acme.com'),
    { instanceOf: TypeError, message: /lookup/ }
  )
})

test('findSibling stops after `limit` addresses', async t => {
  const strangers = Array.from({ length: 500 }, (_, index) =>
    `person${index}x@big.com`.replace(/\d/g, digit => 'abcdefghij'[digit])
  )
  const lookup = () => asyncEmails(...strangers, 'destek@big.com')
  t.is(
    await createAbusive({ dataset, lookup, limit: 500 }).findSibling(
      'destek1@big.com'
    ),
    null
  )
  t.is(
    await createAbusive({ dataset, lookup, limit: 501 }).findSibling(
      'destek1@big.com'
    ),
    'destek@big.com'
  )
  t.is(
    await createAbusive({ dataset, lookup }).findSibling('destek1@big.com'),
    'destek@big.com'
  )
})

test('findSibling lets a lookup failure reach the caller', async t => {
  const { findSibling } = createAbusive({
    dataset,
    lookup: () => {
      throw new Error('store down')
    }
  })
  await t.throwsAsync(findSibling('destek1@acme.com'), {
    message: 'store down'
  })
})

test('findSibling looks up both Gmail domains, own domain first', async t => {
  const registered = {
    'gmail.com': ['derek@gmail.com'],
    'googlemail.com': ['jane@googlemail.com']
  }
  const targets = []
  const { findSibling } = createAbusive({
    dataset,
    lookup: target => {
      targets.push(target.domain)
      return registered[target.domain]
    }
  })
  t.is(await findSibling('d.erek@googlemail.com'), 'derek@gmail.com')
  t.deepEqual(targets, ['googlemail.com', 'gmail.com'])
  t.is(await findSibling('derek9@gmail.com'), 'derek@gmail.com')
})

test('findSibling refuses a numbered variant only after `minSiblings` of them', async t => {
  const lookup = () => [
    'derek1@gmail.com',
    'derek1+x@gmail.com',
    'derek2@gmail.com',
    'derek+old@gmail.com'
  ]
  const siblingWith = minSiblings =>
    createAbusive({ dataset, lookup, minSiblings }).findSibling(
      'derek3@gmail.com'
    )
  t.is(await siblingWith(1), 'derek1@gmail.com')
  t.is(await siblingWith(2), 'derek2@gmail.com')
  t.is(await siblingWith(3), 'derek+old@gmail.com')
  t.is(await siblingWith(4), null)
})

test('findSibling counts each numbered inbox once', async t => {
  const lookup = () => [
    'derek1@gmail.com',
    'd.erek1@gmail.com',
    'derek1+promo@googlemail.com'
  ]
  const { findSibling } = createAbusive({ dataset, lookup, minSiblings: 2 })
  t.is(await findSibling('derek3@gmail.com'), null)
})

test('findSibling refuses the same inbox whatever `minSiblings` is', async t => {
  const { findSibling } = createAbusive({
    dataset,
    lookup: () => ['derek@gmail.com'],
    minSiblings: 10
  })
  t.is(await findSibling('d.erek+3@gmail.com'), 'derek@gmail.com')
  t.is(await findSibling('derek3@gmail.com'), null)
})

test('findSibling reads `minSiblings` per candidate when it is a function', async t => {
  const seen = []
  const { findSibling } = createAbusive({
    dataset,
    lookup: ({ domain }) => [`destek1@${domain}`],
    minSiblings: candidate => {
      seen.push(candidate)
      return candidate.domain === 'gmail.com' ? 2 : 1
    }
  })
  t.is(await findSibling('destek2@acme.com'), 'destek1@acme.com')
  t.is(await findSibling('destek2@gmail.com'), null)
  t.deepEqual(seen, [
    { local: 'destek2', domain: 'acme.com' },
    { local: 'destek2', domain: 'gmail.com' }
  ])
})

test('findSibling finds the same inbox behind a short or letterless mailbox', async t => {
  const { targets, lookup } = recordingLookup(
    'ab1@gmail.com',
    '12345@gmail.com',
    '12345@acme.com'
  )
  const { findSibling } = createAbusive({ dataset, lookup })
  t.is(await findSibling('ab1+x@gmail.com'), 'ab1@gmail.com')
  t.is(await findSibling('1.2.3.4.5@gmail.com'), '12345@gmail.com')
  t.is(await findSibling('12345+x@acme.com'), '12345@acme.com')
  t.deepEqual(
    targets.map(({ keyword }) => keyword),
    ['ab1', '12345', '12345']
  )
})

test('findSibling rejects when a `minSiblings` function returns a bad value', async t => {
  for (const invalid of [undefined, Number.NaN, Infinity, 0, -1, null, '2']) {
    const { findSibling } = createAbusive({
      dataset,
      lookup: () => ['derek1@acme.com'],
      minSiblings: () => invalid
    })
    await t.throwsAsync(
      findSibling('derek3@acme.com'),
      { instanceOf: TypeError, message: /minSiblings/ },
      String(invalid)
    )
  }
})

test('findSibling searches the other Gmail domain until `minSiblings` numbered inboxes exist', async t => {
  const domains = []
  const { findSibling } = createAbusive({
    dataset,
    lookup: ({ domain }) => {
      domains.push(domain)
      return domain === 'gmail.com'
        ? ['derek1@gmail.com']
        : ['derek2@googlemail.com']
    },
    minSiblings: 2
  })
  t.is(await findSibling('derek3@gmail.com'), 'derek2@googlemail.com')
  t.deepEqual(domains, ['gmail.com', 'googlemail.com'])
})

test('findSibling skips the second Gmail lookup once `limit` is spent', async t => {
  const domains = []
  const { findSibling } = createAbusive({
    dataset,
    lookup: ({ domain }) => {
      domains.push(domain)
      return ['jane@gmail.com']
    },
    limit: 1
  })
  t.is(await findSibling('derek+x@gmail.com'), null)
  t.deepEqual(domains, ['gmail.com'])
})

test('isSibling reads counters next to any letter', t => {
  t.true(isSibling('derê1@acme.com', 'derê2@acme.com'))
  t.false(isSibling('derê1985@acme.com', 'derê@acme.com'))
})

test('isSibling numbers a mailbox of exactly 3 characters and ignores a shorter one', t => {
  t.true(isSibling('bob1@acme.com', 'bob@acme.com'))
  t.false(isSibling('bo1@acme.com', 'bo@acme.com'))
})

test('isSibling removes the counter at the end when both ends have one', t => {
  t.true(isSibling('1derek1@acme.com', '1derek2@acme.com'))
  t.false(isSibling('1derek1@acme.com', 'derek1@acme.com'))
})

test('isSibling ignores an empty inbox', t => {
  t.false(isSibling('+a@acme.com', '+b@acme.com'))
  t.false(isSibling('...@gmail.com', '..@googlemail.com'))
})

test('findSibling never pulls more than `limit` addresses from the lookup', async t => {
  let pulled = 0
  async function * strangers () {
    for (const name of ['jane', 'john', 'mary', 'paul', 'anna']) {
      pulled++
      yield `${name}@acme.com`
    }
  }
  const { findSibling } = createAbusive({
    dataset,
    lookup: strangers,
    limit: 3
  })
  t.is(await findSibling('destek1@acme.com'), null)
  t.is(pulled, 3)
})

test('findSibling gives a `minSiblings` function a copy of the candidate', async t => {
  const targets = []
  const { findSibling } = createAbusive({
    dataset,
    lookup: target => {
      targets.push(target)
      return []
    },
    minSiblings: candidate => {
      candidate.domain = 'evil" OR 1=1'
      return 1
    }
  })
  await findSibling('destek1@acme.com')
  t.deepEqual(targets, [{ domain: 'acme.com', keyword: 'destek' }])
})

test('findSibling never calls the lookup with a `limit` of 0', async t => {
  const domains = []
  const { findSibling } = createAbusive({
    dataset,
    lookup: ({ domain }) => {
      domains.push(domain)
      return ['derek@gmail.com']
    },
    limit: 0
  })
  t.is(await findSibling('derek+x@gmail.com'), null)
  t.deepEqual(domains, [])
})
