# abusive

![Last version](https://img.shields.io/github/tag/kikobeats/abusive.svg?style=flat-square)
[![Coverage Status](https://img.shields.io/coveralls/Kikobeats/abusive.svg?style=flat-square)](https://coveralls.io/github/Kikobeats/abusive)
[![NPM Status](https://img.shields.io/npm/dm/abusive.svg?style=flat-square)](https://www.npmjs.org/package/abusive)

> Detect repeat signups abusing your free plan: numbered, +tag and dotted variants of addresses you already have, plus free email providers.

Free plans attract people who sign up again and again with addresses like these:

```
derek1@gmail.com
derek2@gmail.com
d.erek+3@gmail.com
destek1@acme.com
destek2@acme.com
```

**abusive** recognizes each as a **sibling** of an address you already have, so you can refuse the next one without banning the whole domain. Different people still sign up as usual: `jane@acme.com` and `john@acme.com`, or `jane@gmail.com` and `john@gmail.com`.

- Tells the same inbox written another way (`+tag`, Gmail dots, `googlemail.com`) apart from numbered variants that may be a different person.
- Leaves years and short mailboxes alone: `john1987@` is not a sibling of `john@`.
- Flags free and disposable email providers from the domain list you choose.
- Works with any user store: your database, Stripe, or anything that can list emails by domain.
- Zero dependencies, with TypeScript types included.

## Install

```bash
$ npm install abusive --save
```

**abusive** ships no domain list. Bring the one you trust, for example [free-email-domains](https://github.com/Kikobeats/free-email-domains):

```bash
$ npm install free-email-domains --save
```

## Usage

Compare two addresses, no setup needed:

```js
const { isSibling } = require('abusive')

isSibling('d.erek+3@gmail.com', 'derek1@gmail.com') // => true
isSibling('jane@gmail.com', 'john@gmail.com')       // => false
```

To check a signup, create an instance with a domain list and a `lookup` that returns the addresses you already have at a domain:

```js
const { findSibling, isFreeEmail } = require('abusive')({
  dataset: require('free-email-domains'),
  lookup: ({ domain, keyword }) => db.emailsAtDomain(domain, keyword)
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

Your customers already live in Stripe? Use the built-in [Stripe lookup](#stripe) instead of writing one:

```js
const Stripe = require('stripe')
const stripeLookup = require('abusive/stripe')

const { findSibling } = require('abusive')({
  dataset: require('free-email-domains'),
  lookup: stripeLookup(new Stripe(process.env.STRIPE_SECRET_KEY)),
  limit: 500
})
```

## How it works

Two different addresses at the same domain are **siblings** in one of two ways.

**Same inbox.** The address reaches the same mailbox, so it is the same person for sure. The inbox is the part before the `@` without its `+tag`. Gmail also ignores dots, and `googlemail.com` delivers to the same inbox as `gmail.com`:

| Candidate | Registered | Sibling? |
|---|---|---|
| `derek+promo@gmail.com` | `derek@gmail.com` | yes |
| `d.e.r.e.k@gmail.com` | `derek@gmail.com` | yes |
| `d.erek@googlemail.com` | `derek@gmail.com` | yes |
| `destek+6@acme.com` | `destek@acme.com` | yes |

**Numbered.** The inbox differs only by a counter or a separator. The counter is one or two digits next to a letter at the end of the mailbox, or at the start when the end has none, and the separators are `.`, `_` and `-`:

| Address | Mailbox |
|---|---|
| `derek@gmail.com` | `derek` |
| `derek2@gmail.com` | `derek` |
| `d.erek7+x@gmail.com` | `derek` |
| `destek-12@acme.com` | `destek` |
| `john.doe@acme.com` | `johndoe` |
| `john1987@gmail.com` | `john1987` |

| Candidate | Registered | Sibling? |
|---|---|---|
| `derek2@gmail.com` | `derek1@gmail.com` | yes |
| `destek6@acme.com` | `destek@acme.com` | yes |
| `john.doe@acme.com` | `johndoe@acme.com` | yes |
| `john1987@gmail.com` | `john@gmail.com` | no, a year is not a counter |
| `derek1985@gmail.com` | `derek2001@gmail.com` | no |
| `jo2@gmail.com` | `jo@gmail.com` | no, mailbox shorter than 3 characters |
| `jane@gmail.com` | `john@gmail.com` | no, different mailbox |
| `destek1@sub.acme.com` | `destek@acme.com` | no, different domain |

A numbered address is a different inbox, so it can belong to a different person: `derek84@gmail.com` and `derek@gmail.com` may be two Dereks. On a large provider, use [minSiblings](#minsiblings) to refuse only when several numbered siblings already exist. Same-inbox siblings are always refused.

Domains are compared exactly, except for the two Gmail domains: `acme.com` and `sub.acme.com` are different. A mailbox shorter than 3 characters or without letters, such as `jo@` or `12345@`, has no numbered siblings, and only one counter is removed, so `1derek1@` is not a sibling of `derek@`, but its same-inbox variants like `12345+x@` are still caught.

Before comparing, every address is put in canonical form: Unicode NFKC, format characters and variation selectors removed, full-width dots (`。．｡`) read as `.`, trailing dots dropped, and everything lowercased.

## API

### abusive(options)

Returns an object with the methods below. Create it once and reuse it: the dataset is indexed when the object is created.

#### options

##### dataset

*Required*<br>
Type: `Iterable<string>`

The free and disposable email provider domains used by `isFreeEmail`, for example `require('free-email-domains')`. Domains are compared case-insensitively.

##### lookup

Type: `({ domain: string, keyword: string }) => Iterable<string> | AsyncIterable<string> | Promise<Iterable<string>>`

Returns the addresses already registered at `domain`. Required by `findSibling`.

It is called once per domain that shares the candidate's inbox: once for most domains, and twice for `gmail.com` and `googlemail.com`, starting with the candidate's own domain. The second call is skipped when the first one already finds a sibling.

- `domain` is canonical and always a plain hostname (`a-z`, `0-9`, `-` and dots).
- `keyword` is the longest run of letters before the `+`, like `destek` for `destek6`. When that run is shorter than 3 characters, `keyword` is the [mailbox](#how-it-works), like `derek` for `d.e.r.e.k`, or the inbox without separators when the mailbox is shorter than 3 characters, like `ab1` for `ab1+x`. Most siblings contain it, so you can use it to narrow a large domain such as `gmail.com`. Returning every address at `domain` and ignoring `keyword` is always correct, just slower. A registered address that splits the keyword with separators, like `d.e.r.e.k@acme.com` for the keyword `derek`, is only found that way.

Both are safe to put in a query: `lookup` is never called for a malformed address, for one with characters outside `a-z`, `0-9`, `.`, `_`, `+` and `-`, or for one whose inbox is only separators. `keyword` is never empty.

Entries that are not strings are skipped. An error it throws rejects `findSibling`; deciding whether to fail open is up to you.

##### limit

Type: `number`<br>
Default: `Infinity`

The maximum number of addresses `findSibling` reads from `lookup` before giving up, across every call. Once it is reached, no more entries or pages are requested. It must be a non-negative integer or `Infinity`, or a `TypeError` is thrown. It bounds the work on domains with many registered users.

##### minSiblings

Type: `number | (candidate: { local: string, domain: string }) => number`<br>
Default: `1`

How many distinct numbered siblings must exist before `findSibling` reports one. A same-inbox sibling is reported regardless. It must be a positive integer: an invalid value throws a `TypeError`, and an invalid value returned by the function rejects `findSibling` with one.

With `2`, `derek3@gmail.com` is refused when `derek1@` and `derek2@` exist, while a single `derek@` lets a different Derek sign up as `derek84@`. Addresses that reach one inbox, like `derek1@` and `d.erek1+x@`, count once.

Pass a function to choose per candidate, for example strict on work domains and lenient on Gmail:

```js
const { findSibling } = require('abusive')({
  dataset: require('free-email-domains'),
  lookup,
  minSiblings: ({ domain }) =>
    ['gmail.com', 'googlemail.com'].includes(domain) ? 2 : 1
})
```

### .findSibling(email)

Returns a `Promise` that resolves to a registered sibling of `email`, or `null`. It resolves to the first address that qualifies, in lookup order: a same-inbox sibling, or the numbered sibling that reaches [minSiblings](#minsiblings).

### .isSibling(candidate, existing)

Returns `true` when the two addresses are siblings. Each argument is an address string or the result of `parseEmail`.

Available on the instance and as `require('abusive').isSibling`.

### .isFreeEmail(email)

Returns `true` when the address is hosted by a provider in `dataset`.

### .isFreeEmailDomain(domain)

Returns `true` when the domain, or any parent of it, is in `dataset`.

### parseEmail(email)

Returns `{ local, domain }` in canonical form, split at the last `@`, or `null` when the address is malformed.

Available on the instance and as `require('abusive').parseEmail`.

## Lookups

A `lookup` tells **abusive** which addresses you already have. It receives a `domain` and a `keyword` and returns the registered addresses at that domain, as an array, an iterable or an async iterable. See [lookup](#lookup) for the full contract.

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

### Stripe

Uses your Stripe customers as the registered addresses, through the [customer search API](https://docs.stripe.com/api/customers/search). The setup is shown in [Usage](#usage).

Each lookup searches `email~"@<domain>" AND email~"<keyword>"`. When `keyword` is shorter than the 3 characters Stripe needs, it searches nothing: scanning a whole domain like `gmail.com` takes seconds, so mailboxes such as `ab+x@` are not checked. A dotted address is still checked: `d.e.r.e.k@gmail.com` is searched as `derek`.

#### stripeLookup(client, [options])

##### client

*Required*<br>
Type: `Stripe | () => Stripe`

A Stripe client, or a function that returns one. The function is called on every lookup, so the client can be created lazily.

##### options

###### pageSize

Type: `number`<br>
Default: `100`

How many customers each search request returns. Pair it with `limit` to bound how many customers are read in total.

Stripe search can take about a minute to see a new customer, so two signups seconds apart can both pass. A registered address that splits the keyword, like `d.erek@gmail.com` for the keyword `derek`, is not found by the search.

## License

**abusive** © [Jose Francisco 'Kiko' Verdú Gambín](https://kikobeats.com), released under the [MIT](https://github.com/kikobeats/abusive/blob/master/LICENSE.md) License.<br>
Authored and maintained by [Jose Francisco 'Kiko' Verdú Gambín](https://kikobeats.com) with help from [contributors](https://github.com/kikobeats/abusive/contributors).

> [kikobeats.com](https://kikobeats.com) · GitHub [Jose Francisco 'Kiko' Verdú Gambín](https://github.com/kikobeats) · Twitter [@kikobeats](https://twitter.com/kikobeats)
