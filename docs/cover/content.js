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

export const LINE_ENCODING = Object.freeze({
  textCells: 36,
  keyEndTexel: 36,
  lineLengthTexel: 37,
  texelWidth: 40
})
const {
  textCells: TEXT_CELLS,
  keyEndTexel: KEY_END_TEXEL,
  lineLengthTexel: LINE_LENGTH_TEXEL,
  texelWidth: TEXEL_WIDTH
} = LINE_ENCODING
const SPACE = 32
const AT = '@'

const assertFitsLine = (local, domain) => {
  if (local.length + AT.length + domain.length > TEXT_CELLS) {
    throw new RangeError(
      `"${local}@${domain}" does not fit ${TEXT_CELLS} cells`
    )
  }
}

const writeRow = (data, row, text, keyEnd) => {
  for (let i = 0; i < text.length; i++) {
    data[row * TEXEL_WIDTH + i] = text.charCodeAt(i)
  }
  data[row * TEXEL_WIDTH + KEY_END_TEXEL] = keyEnd
  data[row * TEXEL_WIDTH + LINE_LENGTH_TEXEL] = text.length
}

export function encodeLines (inboxLines = INBOX_LINES) {
  const data = new Uint8Array(TEXEL_WIDTH * inboxLines.length).fill(SPACE)
  inboxLines.forEach(([local, domain], row) => {
    assertFitsLine(local, domain)
    writeRow(data, row, `${local}${AT}${domain}`, local.length)
  })
  return { data, width: TEXEL_WIDTH, height: inboxLines.length }
}
