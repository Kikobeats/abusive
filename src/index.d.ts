export interface EmailParts {
  local: string
  domain: string
}

type MaybeEmail = string | null | undefined

export interface LookupTarget {
  domain: string
  keyword: string
}

export type Lookup = (target: LookupTarget) =>
  Iterable<MaybeEmail> | AsyncIterable<MaybeEmail> | Promise<Iterable<MaybeEmail>>

export interface AbusiveStore {
  claim: (key: string, value: string) => Promise<string>
}

export type AbusiveReason = 'ip' | 'sibling'

export interface AbusiveCheck {
  email: string
  ip?: string | null
}

export interface SiblingOptions {
  lookup: Lookup
  min?: number | ((candidate: EmailParts) => number)
}

export interface IpOptions {
  store: AbusiveStore
}

export interface AbusiveOptions {
  rejectedDomains?: Iterable<string>
  sibling?: SiblingOptions
  ip?: IpOptions
  secret?: string
  onAbusive?: (details: { email: string, domain: string, reason: AbusiveReason }) => unknown
  onError?: (details: { email?: string, error: unknown }) => unknown
}

export interface Abusive {
  findSibling: (email: string) => Promise<string | null>
  isAbusive: (check: AbusiveCheck) => Promise<boolean>
  isRejectedEmail: (email: string) => boolean
  isRejectedDomain: (domain: string) => boolean
  isSibling: (candidate: string | EmailParts, existing: string | EmailParts) => boolean
  parseEmail: (email: string) => EmailParts | null
}

export function parseEmail (email: string): EmailParts | null
export function isSibling (candidate: string | EmailParts, existing: string | EmailParts): boolean
export function createAbusive (options?: AbusiveOptions): Abusive

declare const _default: typeof createAbusive & {
  createAbusive: typeof createAbusive
  isSibling: typeof isSibling
  parseEmail: typeof parseEmail
}
export default _default
