import { randomBytes } from 'node:crypto'
import type { Keypair } from '@atproto/crypto'
import { AttestError } from './errors.js'
import { decodeCompact, signCompact, verifyCompact, type SupportedAlg } from './jws.js'
import type { EntitlementClaims, EntitlementContext, VerifierDeps } from './types.js'

export const ENT_TYP = 'ent+jwt'

/** Hard cap on credential lifetime. SPEC §3.1. */
export const MAX_TTL_SECONDS = 7 * 24 * 60 * 60

const DEFAULT_SKEW_SECONDS = 300

const didOfKid = (kid: string): string => {
  const idx = kid.indexOf('#')
  if (idx <= 0 || idx === kid.length - 1) {
    throw new AttestError('MALFORMED', `kid must be "did#fragment", got "${kid}"`)
  }
  return kid.slice(0, idx)
}

const isDid = (s: unknown): s is string => typeof s === 'string' && s.startsWith('did:') && s.length > 8

export interface CreateCredentialInput {
  /** Signer for the issuer's verification method named by `kid`. */
  signer: Keypair
  /** Full key id, e.g. "did:web:pay.example.com#payments_attest". Determines `iss`. */
  kid: string
  /** Supporter DID. */
  sub: string
  ctx: EntitlementContext
  /** Requested lifetime in seconds. Capped at 7 days. Default: 7 days. */
  ttlSeconds?: number
  /** End of the currently paid period. `exp` never exceeds it. */
  periodEnd?: Date
  now?: Date
  jti?: string
}

/** Mint an entitlement credential ("membership card"). SPEC §3. */
export const createEntitlementCredential = async (input: CreateCredentialInput): Promise<string> => {
  const { signer, kid, sub, ctx } = input
  const iss = didOfKid(kid)
  if (!isDid(iss)) throw new AttestError('INVALID_CLAIMS', 'kid must begin with the issuer DID')
  if (!isDid(sub)) throw new AttestError('INVALID_CLAIMS', 'sub must be a DID')
  if (!isDid(ctx.creator)) throw new AttestError('INVALID_CLAIMS', 'ctx.creator must be a DID')
  if (typeof ctx.tier !== 'string' || ctx.tier.length === 0 || ctx.tier.length > 64) {
    throw new AttestError('INVALID_CLAIMS', 'ctx.tier must be a non-empty string of at most 64 chars')
  }
  const ttl = input.ttlSeconds ?? MAX_TTL_SECONDS
  if (!Number.isInteger(ttl) || ttl <= 0 || ttl > MAX_TTL_SECONDS) {
    throw new AttestError('INVALID_CLAIMS', `ttlSeconds must be within (0, ${MAX_TTL_SECONDS}]`)
  }
  const now = input.now ?? new Date()
  const iat = Math.floor(now.getTime() / 1000)
  let exp = iat + ttl
  if (input.periodEnd) {
    const periodEndSec = Math.floor(input.periodEnd.getTime() / 1000)
    if (periodEndSec <= iat) {
      throw new AttestError('INVALID_CLAIMS', 'periodEnd is in the past — the entitlement has lapsed')
    }
    exp = Math.min(exp, periodEndSec)
  }
  const claims: EntitlementClaims = {
    iss,
    sub,
    ctx: { creator: ctx.creator, tier: ctx.tier, ...(ctx.space ? { space: ctx.space } : {}) },
    iat,
    exp,
    jti: input.jti ?? randomBytes(16).toString('hex'),
  }
  return signCompact(
    { typ: ENT_TYP, alg: signer.jwtAlg as SupportedAlg, kid },
    claims as unknown as Record<string, unknown>,
    signer,
  )
}

const parseClaims = (payload: Record<string, unknown>): EntitlementClaims => {
  const { iss, sub, ctx, iat, exp, jti } = payload as Partial<EntitlementClaims>
  if (!isDid(iss) || !isDid(sub)) throw new AttestError('INVALID_CLAIMS', 'iss and sub must be DIDs')
  if (typeof ctx !== 'object' || ctx === null || !isDid(ctx.creator) || typeof ctx.tier !== 'string') {
    throw new AttestError('INVALID_CLAIMS', 'ctx must carry creator (DID) and tier')
  }
  if (!Number.isInteger(iat) || !Number.isInteger(exp) || typeof jti !== 'string' || jti.length === 0) {
    throw new AttestError('INVALID_CLAIMS', 'iat, exp, jti are required')
  }
  return { iss, sub, ctx, iat: iat as number, exp: exp as number, jti }
}

/**
 * Verify a presented entitlement credential. SPEC §6 steps 1–4 and 6.
 *
 * Step 5 (subject binding) is deliberately NOT part of this function because
 * it needs the caller's authentication context: call `assertSubjectBinding`
 * with the DID you authenticated by other means. Skipping it is a broken
 * implementation (SPEC §6.5).
 */
export const verifyEntitlementCredential = async (
  token: string,
  deps: VerifierDeps,
): Promise<EntitlementClaims> => {
  const skew = deps.skewSeconds ?? DEFAULT_SKEW_SECONDS
  const nowSec = Math.floor((deps.now?.() ?? new Date()).getTime() / 1000)

  // 1. Parse; typ and alg checks.
  const jws = decodeCompact(token)
  if (jws.header.typ !== ENT_TYP) {
    throw new AttestError('BAD_TYP', `expected typ ${ENT_TYP}, got ${jws.header.typ}`)
  }
  const claims = parseClaims(jws.payload)

  // iss MUST match the DID portion of kid (SPEC §3.1).
  if (didOfKid(jws.header.kid) !== claims.iss) {
    throw new AttestError('ISSUER_KID_MISMATCH', 'kid DID does not match iss')
  }

  // 2. Time window with skew tolerance.
  if (claims.exp < nowSec - skew) throw new AttestError('EXPIRED', 'credential has expired')
  if (claims.iat > nowSec + skew) throw new AttestError('NOT_YET_VALID', 'credential iat is in the future')

  // 3. Resolve issuer key and verify signature; re-resolve once on failure (key rotation).
  let didKey = await deps.resolveVerificationMethod(claims.iss, jws.header.kid)
  let ok = await verifyCompact(jws, didKey)
  if (!ok) {
    didKey = await deps.resolveVerificationMethod(claims.iss, jws.header.kid, { noCache: true })
    ok = await verifyCompact(jws, didKey)
  }
  if (!ok) throw new AttestError('BAD_SIGNATURE', 'signature verification failed')

  // 4. Issuer must be authorized by the creator's current offer record.
  //    On a miss, refetch once uncached before rejecting (SPEC §7).
  let offer = await deps.getOffer(claims.ctx.creator)
  if (!offer || !offer.authorizedIssuers.includes(claims.iss)) {
    offer = await deps.getOffer(claims.ctx.creator, { noCache: true })
  }
  if (!offer) throw new AttestError('OFFER_NOT_FOUND', 'creator has no offer record')
  if (!offer.authorizedIssuers.includes(claims.iss)) {
    throw new AttestError('ISSUER_NOT_AUTHORIZED', `${claims.iss} is not in the creator's authorizedIssuers`)
  }

  // 6. Hand the caller the claims; tier→perk mapping is theirs.
  return claims
}

/**
 * SPEC §6.5: a credential is a statement about `sub`, not an authenticator of
 * the presenter. Call with the DID you authenticated independently.
 */
export const assertSubjectBinding = (claims: EntitlementClaims, authenticatedDid: string): void => {
  if (claims.sub !== authenticatedDid) {
    throw new AttestError(
      'SUBJECT_MISMATCH',
      `credential subject ${claims.sub} does not match authenticated DID ${authenticatedDid}`,
    )
  }
}
