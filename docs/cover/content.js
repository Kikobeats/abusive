export const REFUSED = 'refused'
export const ALLOWED = 'allowed'

export const READOUT = Object.freeze([
  ['derek+promo@gmail.com', 'derek@gmail.com', REFUSED],
  ['d.e.r.e.k@gmail.com', 'derek@gmail.com', REFUSED],
  ['d.erek@googlemail.com', 'derek@gmail.com', REFUSED],
  ['destek+6@acme.com', 'destek@acme.com', REFUSED],
  ['derek2@gmail.com', 'derek1@gmail.com', REFUSED],
  ['destek6@acme.com', 'destek@acme.com', REFUSED],
  ['john.doe@acme.com', 'johndoe@acme.com', REFUSED],
  ['john1987@gmail.com', 'john@gmail.com', ALLOWED],
  ['derek1985@gmail.com', 'derek2001@gmail.com', ALLOWED],
  ['jo2@gmail.com', 'jo@gmail.com', ALLOWED],
  ['jane@gmail.com', 'john@gmail.com', ALLOWED],
  ['destek1@sub.acme.com', 'destek@acme.com', ALLOWED]
])

export const SAME_INBOX = Object.freeze([
  'derek@gmail.com',
  'd.erek@gmail.com',
  'derek+promo@gmail.com',
  'de.rek+3@googlemail.com',
  'd.e.r.e.k@gmail.com'
])

export const INBOX_LINES = Object.freeze([
  ['derek', 'gmail.com'],
  ['d.erek', 'gmail.com'],
  ['de.rek', 'googlemail.com'],
  ['d.e.r.e.k', 'gmail.com'],
  ['derek1', 'gmail.com'],
  ['derek2', 'gmail.com'],
  ['destek', 'acme.com'],
  ['destek6', 'acme.com'],
  ['johndoe', 'acme.com'],
  ['john.doe', 'acme.com'],
  ['john_doe', 'acme.com'],
  ['john-doe', 'acme.com'],
  ['jane', 'gmail.com'],
  ['j.ane', 'googlemail.com'],
  ['dere.k', 'gmail.com'],
  ['d.erek1', 'gmail.com']
])

export const TABLE_CHARS = 30
export const VERDICT_GAP = 2

const TEXT_CELLS = 36
const KEY_END_TEXEL = 36
const LINE_LENGTH_TEXEL = 37
const VERDICT_TEXEL = 38
const TEXEL_WIDTH = 40
const SPACE = 32
const AT = '@'

const assertFitsBand = (candidate, verdict) => {
  if (candidate.length + VERDICT_GAP + verdict.length > TABLE_CHARS) {
    throw new RangeError(
      `"${candidate} ${verdict}" does not fit the ${TABLE_CHARS} column band`
    )
  }
}

const assertFitsLine = (local, domain) => {
  if (local.length + AT.length + domain.length > TEXT_CELLS) {
    throw new RangeError(
      `"${local}@${domain}" does not fit ${TEXT_CELLS} cells`
    )
  }
}

const writeRow = (data, row, text, keyEnd, verdict) => {
  for (let i = 0; i < text.length; i++) {
    data[row * TEXEL_WIDTH + i] = text.charCodeAt(i)
  }
  data[row * TEXEL_WIDTH + KEY_END_TEXEL] = keyEnd
  data[row * TEXEL_WIDTH + LINE_LENGTH_TEXEL] = text.length
  data[row * TEXEL_WIDTH + VERDICT_TEXEL] = verdict
}

export function encodeLines (readout = READOUT, inboxLines = INBOX_LINES) {
  const rows = readout.length + inboxLines.length
  const data = new Uint8Array(TEXEL_WIDTH * rows).fill(SPACE)
  readout.forEach(([candidate, , verdict], row) => {
    assertFitsBand(candidate, verdict)
    const text = candidate.padEnd(TABLE_CHARS - verdict.length) + verdict
    writeRow(data, row, text, candidate.length, verdict === REFUSED ? 1 : 0)
  })
  inboxLines.forEach(([local, domain], index) => {
    assertFitsLine(local, domain)
    writeRow(
      data,
      readout.length + index,
      `${local}${AT}${domain}`,
      local.length,
      0
    )
  })
  return { data, width: TEXEL_WIDTH, height: rows }
}
