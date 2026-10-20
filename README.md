# abusive

![Last version](https://img.shields.io/github/tag/kikobeats/abusive.svg?style=flat-square)
[![Coverage Status](https://img.shields.io/coveralls/Kikobeats/abusive.svg?style=flat-square)](https://coveralls.io/github/Kikobeats/abusive)
[![NPM Status](https://img.shields.io/npm/dm/abusive.svg?style=flat-square)](https://www.npmjs.org/package/abusive)

> Detect repeat signups abusing your free plan: numbered, +tag and dotted variants of addresses you already have, plus free email providers.

```
derek@gmail.com      registered
d.erek+3@gmail.com   refused: same inbox
derek2@gmail.com     refused: numbered variant
jane@gmail.com       allowed: different person
john1987@gmail.com   allowed: a year is not a counter
```

- Refuses the next signup without banning the whole domain.
- Tells the same inbox written another way apart from numbered variants that may be a different person.
- Flags free and disposable email providers from the domain list you choose.
- Works with any user store: Stripe, SQL, or anything that can list emails by domain.
- Zero dependencies, with TypeScript types included.

## Install

```bash
$ npm install abusive free-email-domains --save
```

**abusive** ships no domain list. [free-email-domains](https://github.com/Kikobeats/free-email-domains) is one you can use; bring any list you trust.

## Quick start

```js
const Stripe = require('stripe')
const stripeLookup = require('abusive/stripe')

const { findSibling, isFreeEmail } = require('abusive')({
  dataset: require('free-email-domains'),
  lookup: stripeLookup(new Stripe(process.env.STRIPE_SECRET_KEY)),
  limit: 500
})

async function signupRejection (email) {
  if (isFreeEmail(email)) return 'Sign up with your work email.'
  if (await findSibling(email)) return 'This email cannot be used to create an account.'
  return null
}

// signupRejection('someone@yopmail.com') => 'Sign up with your work email.'
// signupRejection('destek6@acme.com')    => 'This email cannot be used to create an account.'
// signupRejection('jane@acme.com')       => null
```

Keep the refusal message neutral. Saying that a similar account exists tells an attacker which addresses are registered.

Customers somewhere else? Swap the `lookup`, see [Lookups](#lookups). To compare two addresses without any setup:

```js
const { isSibling } = require('abusive')

isSibling('d.erek+3@gmail.com', 'derek1@gmail.com') // => true
isSibling('jane@gmail.com', 'john@gmail.com')       // => false
```

## What counts as a sibling

Two different addresses at the same domain are **siblings** in one of two ways:

| Kind | What matches | Same person? |
|---|---|---|
| **Same inbox** | The part before the `@` without its `+tag`. Gmail also ignores dots, and `googlemail.com` is the same inbox as `gmail.com`. | Yes, always refused |
| **Numbered** | The inbox differs only by `.`, `_`, `-` or a counter: one or two digits next to a letter, at the end, or at the start when the end has none. | Maybe, see [minSiblings](#minsiblings) |

| Candidate | Registered | Sibling? |
|---|---|---|
| `derek+promo@gmail.com` | `derek@gmail.com` | yes, same inbox |
| `d.e.r.e.k@gmail.com` | `derek@gmail.com` | yes, same inbox |
| `d.erek@googlemail.com` | `derek@gmail.com` | yes, same inbox |
| `destek+6@acme.com` | `destek@acme.com` | yes, same inbox |
| `derek2@gmail.com` | `derek1@gmail.com` | yes, numbered |
| `destek6@acme.com` | `destek@acme.com` | yes, numbered |
| `john.doe@acme.com` | `johndoe@acme.com` | yes, numbered |
| `john1987@gmail.com` | `john@gmail.com` | no, a year is not a counter |
| `derek1985@gmail.com` | `derek2001@gmail.com` | no |
| `jo2@gmail.com` | `jo@gmail.com` | no, mailbox shorter than 3 characters |
| `jane@gmail.com` | `john@gmail.com` | no, different mailbox |
| `destek1@sub.acme.com` | `destek@acme.com` | no, different domain |

A numbered address is a different inbox, so it can belong to a different person: `derek84@gmail.com` and `derek@gmail.com` may be two Dereks. On a large provider, set [minSiblings](#minsiblings) to `2`: `derek3@` is refused once `derek1@` and `derek2@` exist, while a single `derek@` lets `derek84@` in.

The fine print, such as canonical form and short mailboxes, is in [Edge cases](#edge-cases).

## Lookups

A `lookup` tells **abusive** which addresses you already have. It receives a `domain` and a `keyword` and returns the registered addresses at that domain, as an array, an iterable or an async iterable. The full contract is in [lookup](#lookup).

### Stripe

Uses your Stripe customers as the registered addresses, through the [customer search API](https://docs.stripe.com/api/customers/search). Setup is in [Quick start](#quick-start).

Each lookup searches `email~"@<domain>" AND email~"<keyword>"`. When `keyword` is shorter than the 3 characters Stripe needs, it searches nothing, because scanning a whole domain like `gmail.com` takes seconds. So mailboxes such as `ab+x@` are not checked. A dotted address is still checked: `d.e.r.e.k@gmail.com` is searched as `derek`.

Limits of Stripe search:

- It can take about a minute to see a new customer, so two signups seconds apart can both pass.
- A registered address that splits the keyword, like `d.erek@gmail.com` for the keyword `derek`, is not found.

#### stripeLookup(client, [options])

| Argument | Type | Default | Description |
|---|---|---|---|
| `client` | `Stripe \| () => Stripe` | *required* | A Stripe client, or a function returning one. The function is called on every lookup, so the client can be created lazily. |
| `options.pageSize` | `number` | `100` | Customers per search request. Pair it with `limit` to bound how many customers are read in total. |

### SQL

Any database that can filter emails by pattern works. With [pg](https://node-postgres.com):

```js
const { Pool } = require('pg')
const pool = new Pool()

const sqlLookup = async ({ domain, keyword }) => {
  const { rows } = await pool.query(
    'SELECT email FROM users WHERE lower(email) LIKE $1 AND lower(email) LIKE $2',
    [`%@${domain}`, `%${keyword}%`]
  )
  return rows.map(row => row.email)
}
```

`lower()` matters because `domain` and `keyword` arrive lowercased while your stored addresses may not be. Drop the `keyword` condition to also catch registered addresses that split it, like `d.erek@gmail.com`, at the cost of reading every address at the domain.

## API

### abusive(options)

Returns an object with the methods below. Create it once and reuse it: the dataset is indexed when the object is created.

| Option | Type | Default | Description |
|---|---|---|---|
| [`dataset`](#dataset) | `Iterable<string>` | *required* | Free and disposable email provider domains. |
| [`lookup`](#lookup) | `function` | | Returns the registered addresses at a domain. Required by `findSibling`. |
| [`limit`](#limit) | `number` | `Infinity` | Maximum addresses read per `findSibling` call. |
| [`minSiblings`](#minsiblings) | `number \| function` | `1` | Numbered siblings needed before one is reported. |

#### dataset

The domains used by `isFreeEmail`, for example `require('free-email-domains')`. Domains are compared case-insensitively.

#### lookup

Type: `({ domain: string, keyword: string }) => Iterable<string> | AsyncIterable<string> | Promise<Iterable<string>>`

Returns the addresses already registered at `domain`.

- `domain` is canonical and always a plain hostname (`a-z`, `0-9`, `-` and dots).
- `keyword` is a fragment most siblings contain, so you can narrow a large domain such as `gmail.com`. Returning every address at `domain` and ignoring `keyword` is always correct, just slower. How it is picked is in [Edge cases](#edge-cases).
- It is called for each domain that shares the candidate's inbox, the candidate's own domain first: once for most domains, and up to twice for `gmail.com` and `googlemail.com`. The second call is skipped when the first one already qualifies (a same-inbox sibling, or enough numbered inboxes to reach `minSiblings`) or when `limit` is reached.
- Both arguments are safe to put in a query: `lookup` is never called for a malformed address, for one with characters outside `a-z`, `0-9`, `.`, `_`, `+` and `-`, or for one whose inbox is only separators. `keyword` is never empty.
- Entries that are not strings are skipped. An error it throws rejects `findSibling`; deciding whether to fail open is up to you.

#### limit

The maximum number of addresses `findSibling` reads from `lookup` before giving up, across every call. It bounds the work on domains with many registered users. Once it is reached, no more entries or pages are requested. It must be a non-negative integer or `Infinity`, or a `TypeError` is thrown.

#### minSiblings

Type: `number | (candidate: { local: string, domain: string }) => number`

How many distinct numbered siblings must exist before `findSibling` reports one. A same-inbox sibling is reported regardless. Addresses that reach one inbox, like `derek1@` and `d.erek1+x@`, count once.

Pass a function to choose per candidate, for example strict on work domains and lenient on Gmail:

```js
const { findSibling } = require('abusive')({
  dataset: require('free-email-domains'),
  lookup,
  minSiblings: ({ domain }) =>
    ['gmail.com', 'googlemail.com'].includes(domain) ? 2 : 1
})
```

It must be a positive integer: an invalid value throws a `TypeError`, and an invalid value returned by the function rejects `findSibling` with one.

### Methods

| Method | Returns |
|---|---|
| `.findSibling(email)` | `Promise` of the first registered address that qualifies, in lookup order (a same-inbox sibling, or the numbered sibling that reaches `minSiblings`), or `null`. |
| `.isSibling(candidate, existing)` | `true` when the two addresses are siblings. Each argument is an address string or the result of `parseEmail`. |
| `.isFreeEmail(email)` | `true` when the address is hosted by a provider in `dataset`. |
| `.isFreeEmailDomain(domain)` | `true` when the domain, or any parent of it, is in `dataset`. |
| `.parseEmail(email)` | `{ local, domain }` in canonical form, split at the last `@`, or `null` when the address is malformed. |

`isSibling` and `parseEmail` are also available without an instance, as `require('abusive').isSibling` and `require('abusive').parseEmail`.

## Edge cases

**Canonical form.** Before comparing, every address gets Unicode NFKC, format characters and variation selectors removed, full-width dots (`。．｡`) read as `.`, trailing dots dropped, and everything lowercased.

**Domains** are compared exactly, except for the two Gmail domains: `acme.com` and `sub.acme.com` are different.

**Numbered matches need a real mailbox.** A mailbox shorter than 3 characters or without letters, such as `jo@` or `12345@`, has no numbered siblings, but its same-inbox variants like `12345+x@` are still caught. Only one counter is removed, so `1derek1@` is not a sibling of `derek@`.

**Keyword.** It is the longest run of letters before the `+`, like `destek` for `destek6`. When that run is shorter than 3 characters, it is the mailbox, like `derek` for `d.e.r.e.k`, or the inbox without separators when the mailbox is shorter than 3 characters, like `ab1` for `ab1+x`. A registered address that splits the keyword with separators, like `d.e.r.e.k@acme.com` for the keyword `derek`, is only found by a lookup that ignores the keyword.

## License

**abusive** © [Jose Francisco 'Kiko' Verdú Gambín](https://kikobeats.com), released under the [MIT](https://github.com/kikobeats/abusive/blob/master/LICENSE.md) License.<br>
Authored and maintained by [Jose Francisco 'Kiko' Verdú Gambín](https://kikobeats.com) with help from [contributors](https://github.com/kikobeats/abusive/contributors).

> [kikobeats.com](https://kikobeats.com) · GitHub [Jose Francisco 'Kiko' Verdú Gambín](https://github.com/kikobeats) · Twitter [@kikobeats](https://twitter.com/kikobeats)
