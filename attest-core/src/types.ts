/** What an entitlement grants access to. SPEC §1, §3.1. */
export interface EntitlementContext {
  /** DID of the creator the entitlement is with. */
  creator: string
  /** Tier id from the creator's offer record. */
  tier: string
  /**
   * Space URI a tier unlocks (`at://{spaceDid}/space/{spaceType}/{skey}`).
   * Reserved for the Spaces integration (SPEC §10); absent in v1 credentials.
   */
  space?: string
}

/** Claims of an entitlement credential (`ent+jwt`). SPEC §3.1. */
export interface EntitlementClaims {
  /** Issuer DID. MUST match the DID portion of the header `kid`. */
  iss: string
  /** Supporter DID. */
  sub: string
  ctx: EntitlementContext
  /** Issued-at, Unix seconds. */
  iat: number
  /** Expiry, Unix seconds. ≤ iat + 7 days AND ≤ end of paid period. */
  exp: number
  /** Unique token id. */
  jti: string
}

/** Claims of a badge voucher (`entvch+jwt`). SPEC §4. No `exp` by design. */
export interface VoucherClaims {
  /** Issuer DID. MUST match the DID portion of the header `kid`. */
  iss: string
  /** Supporter DID (the badge's repo owner). */
  sub: string
  /** Creator DID (the badge's `subject`). */
  crt: string
  /** Tier display name, if the badge names one. */
  tn?: string
  iat: number
  jti: string
}

/** Billing period of a display price. */
export type PricePeriod = 'month' | 'year' | 'once'

/** What shape of thing a tier is, so an app picks an interface. SPEC §2. */
export type TierKind = 'membership' | 'support' | 'digital' | 'physical'

/** Pay-what-you-want bounds. SPEC §2. */
export interface CustomAmount {
  enabled: boolean
  /** Smallest acceptable amount in minor units. */
  minimum?: number
  /** Largest acceptable amount in minor units. */
  maximum?: number
}

/**
 * An informational display price. A tier carries several — one per currency
 * and period — so a price can be superseded without repricing existing
 * subscribers. Never authoritative for billing (SPEC §2).
 */
export interface OfferPrice {
  /** Stable id within the tier; what an existing subscriber references. */
  lookupKey?: string
  /** Minor units. With `customAmount.enabled`, the suggested amount. */
  value: number
  currency: string
  period?: PricePeriod
  customAmount?: CustomAmount
  /** Withdrawn from sale. Retained, never deleted (SPEC §2). */
  archived?: boolean
  archivedAt?: string
}

/** One renderable line item of what a tier includes. Never authorization. */
export interface OfferBenefit {
  kind?: string
  label: string
}

/** A tier in a creator's offer record. */
export interface OfferTier {
  id: string
  name: string
  description?: string
  /** Absent means `membership` (SPEC §2). */
  kind?: TierKind
  benefits?: OfferBenefit[]
  prices?: OfferPrice[]
  /** Withdrawn from sale; outstanding credentials must still be honoured. */
  archived?: boolean
  archivedAt?: string
}

/** One gated space, and what opens it. SPEC §2, §2.1. */
export interface GatedSpace {
  /** `at://{authority}/space/{spaceType}/{recordKey}`. */
  space: string
  name: string
  description?: string
  /**
   * Lexicon ids of the record types this space holds. Advisory and
   * creator-declared: never an access rule (SPEC §2.1). Absent means
   * *unknown*, not *empty*.
   */
  contentTypes?: string[]
  /** Tier ids that open this space. Absent/empty means any entitlement does. */
  tiers?: string[]
}

/**
 * What an app earns from payments to this creator (SPEC §2.2).
 *
 * Deliberately silent on whose money it is: an issuer may carve it out of its
 * own take or have the creator fund it on top. A posted price either way —
 * nothing here is matched or auctioned.
 */
export interface AppShare {
  /** Basis points (100 = 1%). Issuers that let creators set it publish a band. */
  rate: number
  /** Months the origination share trails a conversion. Bounded by design. */
  originationWindowMonths?: number
  /** When `rate` begins to apply to delivery, where it can change at all. */
  effectiveFrom?: string
  /** Delivery rate in force until `effectiveFrom`, while a cut is pending.
   *  Absent on issuers whose rate is instance-wide. */
  previousRate?: number
}

/** The creator's public offer record (`…payments.offer`, rkey `self`). */
export interface OfferRecord {
  $type?: string
  tiers: OfferTier[]
  /** DIDs of issuers whose credentials apps should accept for this creator. */
  authorizedIssuers: string[]
  /** DIDs of services with checkEntitlement query standing. */
  authorizedServices?: string[]
  gatedSpaces?: GatedSpace[]
  appShare?: AppShare
  createdAt: string
}

export interface ResolveOptions {
  /**
   * Bypass any cache and fetch fresh. The verifier sets this when retrying
   * after a signature failure (key rotation, SPEC §6.3) or after an
   * authorization miss on a possibly-stale offer (SPEC §7).
   */
  noCache?: boolean
}

/**
 * Environment the verifier runs against. Injected so the library stays
 * transport-free and tests never touch the network.
 */
export interface VerifierDeps {
  /**
   * Resolve a verification method to its public key as a did:key string.
   * `did` is the issuer DID, `kid` the full key id from the JWS header
   * (e.g. "did:web:pay.example.com#payments_attest").
   */
  resolveVerificationMethod(did: string, kid: string, opts?: ResolveOptions): Promise<string>
  /** Fetch a creator's offer record, or null if they have none. */
  getOffer(creatorDid: string, opts?: ResolveOptions): Promise<OfferRecord | null>
  /** Clock override for tests. Defaults to `() => new Date()`. */
  now?: () => Date
  /** Clock-skew tolerance in seconds. Defaults to 300 (SPEC §6.2). */
  skewSeconds?: number
}
