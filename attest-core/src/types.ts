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

/** A tier in a creator's offer record. */
export interface OfferTier {
  id: string
  name: string
  description?: string
  price?: { value: number; currency: string; period?: 'month' | 'year' | 'once' }
}

/** The creator's public offer record (`…payments.offer`, rkey `self`). */
export interface OfferRecord {
  $type?: string
  tiers: OfferTier[]
  /** DIDs of issuers whose credentials apps should accept for this creator. */
  authorizedIssuers: string[]
  /** DIDs of services with checkEntitlement query standing. */
  authorizedServices?: string[]
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
