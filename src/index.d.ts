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

export interface SignupOptions {
  store: SignupStore
  secret: string
  ipMemoryMs?: number
  burstLimit?: number
  burstWindowMs?: number
  burstBlockMs?: number
  onBlock?: (domain: string) => unknown
  isTrustedDomain?: (domain: string) => boolean | Promise<boolean>
  isSharedDomain?: (domain: string) => boolean | Promise<boolean>
}

export interface SignupContext {
  ip?: string | null
}

export type SignupRefusal =
  | { reason: 'blocked-domain' }
  | { reason: 'domain-burst' }
  | { reason: 'same-ip' }
  | { reason: 'same-inbox' }
  | { reason: 'malformed' }

export interface AbusiveOptions {
  dataset: Iterable<string>
  lookup?: Lookup
  limit?: number
  minSiblings?: number | ((candidate: EmailParts) => number)
  signup?: SignupOptions
}

export interface Abusive {
  findSibling: (email: string) => Promise<string | null>
  isFreeEmail: (email: string) => boolean
  isFreeEmailDomain: (domain: string) => boolean
  isSibling: (candidate: string | EmailParts, existing: string | EmailParts) => boolean
  parseEmail: (email: string) => EmailParts | null
}

export interface AbusiveWithSignup extends Abusive {
  admitSignup: (email: string, context?: SignupContext) => Promise<SignupRefusal | null>
  checkSignup: (email: string) => Promise<{ reason: 'blocked-domain' | 'malformed' } | null>
}

export function parseEmail (email: string): EmailParts | null
export function isSibling (candidate: string | EmailParts, existing: string | EmailParts): boolean
export function createAbusive (options: AbusiveOptions & { signup: SignupOptions }): AbusiveWithSignup
export function createAbusive (options: AbusiveOptions): Abusive

declare const _default: typeof createAbusive & {
  createAbusive: typeof createAbusive
  isSibling: typeof isSibling
  parseEmail: typeof parseEmail
}
export default _default
