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

export interface SignupStore {
  claim: (key: string, value: string, ttlMs?: number) => Promise<string>
  read: (key: string) => Promise<string | null | undefined>
  countRecent: (key: string, member: string, windowMs: number) => Promise<number>
  remove: (...keys: string[]) => Promise<unknown>
}

export type AbusiveReason =
  | 'blocked-domain'
  | 'domain-burst'
  | 'malformed'
  | 'same-inbox'
  | 'same-ip'
  | 'sibling'

export interface AbusiveCheck {
  email: string
  ip?: string | null
  verified?: boolean
}

export interface AbusiveOptions {
  dataset: Iterable<string>
  lookup?: Lookup
  limit?: number
  minSiblings?: number | ((candidate: EmailParts) => number)
  store?: SignupStore
  secret?: string
  ipMemoryMs?: number
  burstLimit?: number
  burstWindowMs?: number
  burstBlockMs?: number
  isTrustedDomain?: (domain: string) => boolean | Promise<boolean>
  isSharedDomain?: (domain: string) => boolean | Promise<boolean>
  onBlock?: (domain: string) => unknown
  onAbusive?: (details: { email: string, domain?: string, reason: AbusiveReason }) => unknown
  onError?: (details: { email: string, error: unknown }) => unknown
}

export interface Abusive {
  findSibling: (email: string) => Promise<string | null>
  isAbusive: (check: AbusiveCheck) => Promise<boolean>
  isFreeEmail: (email: string) => boolean
  isFreeEmailDomain: (domain: string) => boolean
  isSibling: (candidate: string | EmailParts, existing: string | EmailParts) => boolean
  parseEmail: (email: string) => EmailParts | null
}

export function parseEmail (email: string): EmailParts | null
export function isSibling (candidate: string | EmailParts, existing: string | EmailParts): boolean
export function createAbusive (options: AbusiveOptions): Abusive

declare const _default: typeof createAbusive & {
  createAbusive: typeof createAbusive
  isSibling: typeof isSibling
  parseEmail: typeof parseEmail
}
export default _default
