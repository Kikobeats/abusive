'use strict'

const { writeFileSync } = require('fs')
const { join } = require('path')
const { setFlagsFromString } = require('v8')
const { runInNewContext } = require('vm')

const dataset = require('free-email-domains')
const createAbusive = require('..')
const pairs = require('../test/fixtures/pairs')

const RUNS = 7
const DATASET_BUILDS = 5
const PAIR_ROUNDS = 2000
const CUSTOM_DOMAINS = 30000
const SIBLING_SEARCHES = 200
const STRANGERS_PER_DOMAIN = 500

const median = values => {
  const sorted = values.slice().sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

setFlagsFromString('--expose-gc')
const collectGarbage = runInNewContext('gc')

const now = () => process.hrtime.bigint()

const elapsed = started => Number(now() - started) / 1e6

const LABELED_PAIRS = [
  ...pairs.sameInbox.map(pair => [pair, true]),
  ...pairs.numbered.map(pair => [pair, true]),
  ...pairs.strangers.map(pair => [pair, false])
]

const EXPECTED_SIBLINGS =
  LABELED_PAIRS.filter(([, sibling]) => sibling).length * PAIR_ROUNDS

const freeEmails = () =>
  dataset.map((domain, index) => `user${index}@mail.${domain}`)

const customEmails = () =>
  Array.from(
    { length: CUSTOM_DOMAINS },
    (_, index) => `jane.doe+${index}@team${index}.acme-corp.dev`
  )

const strangersOf = domain =>
  Array.from(
    { length: STRANGERS_PER_DOMAIN },
    (_, index) => `derek${1900 + index}@${domain}`
  )

const SIBLING_CANDIDATE = 'D.erek7+promo@gmail.com'
const REGISTERED_SIBLING = 'derek@googlemail.com'

const LOOKUP_RESULTS = {
  'gmail.com': strangersOf('gmail.com'),
  'googlemail.com': [...strangersOf('googlemail.com'), REGISTERED_SIBLING]
}

const siblingLookup = ({ domain }) => LOOKUP_RESULTS[domain]

const buildDatasetCase = {
  name: 'createAbusive free-email-domains',
  extra: `${DATASET_BUILDS} builds of ${dataset.length} domains`,
  setup: () => {},
  timed: () => {
    let built = 0
    for (let build = 0; build < DATASET_BUILDS; build++) {
      if (createAbusive({ dataset }).isFreeEmailDomain('gmail.com')) built++
    }
    return built
  },
  verify: built => built === DATASET_BUILDS
}

const isSiblingCase = {
  name: 'isSibling fixture pairs',
  extra: `${LABELED_PAIRS.length * PAIR_ROUNDS} pairs`,
  setup: state => {
    state.isSibling = createAbusive({ dataset }).isSibling
  },
  timed: ({ isSibling }) => {
    let siblings = 0
    for (let round = 0; round < PAIR_ROUNDS; round++) {
      for (const [[candidate, existing]] of LABELED_PAIRS) {
        if (isSibling(candidate, existing)) siblings++
      }
    }
    return siblings
  },
  verify: siblings => siblings === EXPECTED_SIBLINGS
}

const isFreeEmailCase = {
  name: 'isFreeEmail subdomains',
  extra: `${dataset.length} free + ${CUSTOM_DOMAINS} custom addresses`,
  setup: state => {
    state.isFreeEmail = createAbusive({ dataset }).isFreeEmail
    state.emails = [...freeEmails(), ...customEmails()]
  },
  timed: ({ isFreeEmail, emails }) => {
    let free = 0
    for (const email of emails) {
      if (isFreeEmail(email)) free++
    }
    return free
  },
  verify: free => free === dataset.length
}

const findSiblingCase = {
  name: 'findSibling gmail scan',
  extra: `${SIBLING_SEARCHES} searches over ${
    STRANGERS_PER_DOMAIN * 2 + 1
  } lookup results`,
  setup: state => {
    state.findSibling = createAbusive({
      dataset,
      lookup: siblingLookup
    }).findSibling
  },
  timed: async ({ findSibling }) => {
    let found = 0
    for (let search = 0; search < SIBLING_SEARCHES; search++) {
      if ((await findSibling(SIBLING_CANDIDATE)) === REGISTERED_SIBLING) {
        found++
      }
    }
    return found
  },
  verify: found => found === SIBLING_SEARCHES
}

const CASES = [
  buildDatasetCase,
  isSiblingCase,
  isFreeEmailCase,
  findSiblingCase
]

const fmt = value => value.toFixed(1)

const report = slot => {
  const med = slot.walls.length ? median(slot.walls) : Number.NaN
  const min = slot.walls.length ? Math.min(...slot.walls) : Number.NaN
  const max = slot.walls.length ? Math.max(...slot.walls) : Number.NaN
  const extra = `${slot.entry.extra}, errors ${slot.errors}, runs ${RUNS}`
  console.log(
    `${slot.entry.name}  median ${fmt(med)}ms  range ${fmt(min)}-${fmt(
      max
    )}  ${extra}`
  )
  return {
    name: slot.entry.name,
    unit: 'ms',
    value: Number(med.toFixed(1)),
    range: `${fmt(min)}-${fmt(max)}`,
    extra
  }
}

const takeSample = async (slot, run) => {
  try {
    collectGarbage()
    const started = now()
    const outcome = await slot.entry.timed(slot.state)
    const wall = elapsed(started)
    if (!slot.entry.verify(outcome)) {
      console.error(`${slot.entry.name} run ${run} produced unexpected output`)
      slot.errors++
      return
    }
    slot.walls.push(wall)
  } catch (error) {
    console.error(error)
    slot.errors++
  }
}

const main = async () => {
  const slots = []
  for (const entry of CASES) {
    const state = {}
    await entry.setup(state)
    await entry.timed(state)
    slots.push({ entry, state, walls: [], errors: 0 })
  }
  for (let run = 0; run < RUNS; run++) {
    for (const slot of slots) await takeSample(slot, run)
  }
  const results = slots.map(report)
  writeFileSync(
    join(__dirname, '..', 'benchmark-output.json'),
    JSON.stringify(results, null, 2) + '\n'
  )
  const errors = slots.reduce((total, slot) => total + slot.errors, 0)
  if (errors > 0 || results.some(result => !Number.isFinite(result.value))) {
    process.exitCode = 1
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
