'use strict'

const DEFAULT_PAGE_SIZE = 100
const MIN_KEYWORD_LENGTH = 3

const resolveClient = client =>
  typeof client === 'function' ? client() : client

const stripeLookup = (
  client,
  { pageSize = DEFAULT_PAGE_SIZE, limit = Infinity } = {}
) => {
  if (client == null) {
    throw new TypeError(
      '`client` must be a Stripe client or a function returning one'
    )
  }
  if (limit !== Infinity && (!Number.isInteger(limit) || limit < 1)) {
    throw new TypeError('`limit` must be a positive integer or Infinity')
  }
  return async function * ({ domain, keyword }) {
    if (keyword.length < MIN_KEYWORD_LENGTH) return
    const query = `email~"@${domain}" AND email~"${keyword}"`
    let read = 0
    for await (const customer of resolveClient(client).customers.search({
      query,
      limit: pageSize
    })) {
      if (read++ >= limit) return
      yield customer.email
    }
  }
}

module.exports = stripeLookup
module.exports.stripeLookup = stripeLookup
