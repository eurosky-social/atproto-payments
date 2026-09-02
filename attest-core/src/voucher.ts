import { randomBytes } from 'node:crypto'
import type { Keypair } from '@atproto/crypto'
import { AttestError } from './errors.js'
import { decodeCompact, signCompact, verifyCompact, type SupportedAlg } from './jws.js'
import type { VerifierDeps, VoucherClaims } from './types.js'

export const VCH_TYP = 'entvch+jwt'

const didOfKid = (kid: string): string => {
  const idx = kid.indexOf('#')
  if (idx <= 0 || idx === kid.length - 1) {
    throw new AttestError('MALFORMED', `kid must be "did#fragment", got "${kid}"`)
  }
  return kid.slice(0, idx)
}

const isDid = (s: unknown): s is string => typeof s === 'string' && s.startsWith('did:') && s.length > 8

export interface CreateVoucherInput {
  signer: Keypair
  kid: string
  /** Supporter DID (owner of the repo the badge sits in). */
  sub: string
  /** Creator DID (the badge's `subject`). */
  crt: string
  /** Tier display name, if the badge names one. */
  tn?: string
  now?: Date
  jti?: string
}

/**
 * Mint a badge voucher: an issuer countersignature the supporter explicitly
 * requested for public display. Attests the relationship existed at `iat`;
 * carries no expiry by design (SPEC §4).
 */
export const createVoucher = async (input: CreateVoucherInput): Promise<string> => {
  const { signer, kid, sub, crt, tn } = input
  const iss = didOfKid(kid)
  if (!isDid(iss) || !isDid(sub) || !isDid(crt)) {
    throw new AttestError('INVALID_CLAIMS', 'iss (via kid), sub, and crt must be DIDs')
  }
  const claims: VoucherClaims = {
    iss,
    sub,
    crt,
    ...(tn ? { tn } : {}),
    iat: Math.floor((input.now ?? new Date()).getTime() / 1000),
    jti: input.jti ?? randomBytes(16).toString('hex'),
  }
  return signCompact(
    { typ: VCH_TYP, alg: signer.jwtAlg as SupportedAlg, kid },
    claims as unknown as Record<string, unknown>,
    signer,
  )
}

export interface VerifyVoucherExpectations {
  /** The badge repo's owner. The voucher's `sub` must equal it. */
  supporter: string
  /** The badge record's `subject`. The voucher's `crt` must equal it. */
  creator: string
}

/**
 * Verify a badge voucher against a badge's context. SPEC §4: signature checks
 * against the issuer's DID document, and the issuer must be in the CREATOR'S
 * current authorizedIssuers. A voucher that fails here renders the badge
 * self-asserted, not invalid — display policy is the caller's.
 */
export const verifyVoucher = async (
  token: string,
  expectations: VerifyVoucherExpectations,
  deps: VerifierDeps,
): Promise<VoucherClaims> => {
  const jws = decodeCompact(token)
  if (jws.header.typ !== VCH_TYP) {
    throw new AttestError('BAD_TYP', `expected typ ${VCH_TYP}, got ${jws.header.typ}`)
  }
  const { iss, sub, crt, tn, iat, jti } = jws.payload as Partial<VoucherClaims>
  if (!isDid(iss) || !isDid(sub) || !isDid(crt) || !Number.isInteger(iat) || typeof jti !== 'string') {
    throw new AttestError('INVALID_CLAIMS', 'voucher must carry iss, sub, crt, iat, jti')
  }
  if (didOfKid(jws.header.kid) !== iss) {
    throw new AttestError('ISSUER_KID_MISMATCH', 'kid DID does not match iss')
  }
  if (sub !== expectations.supporter) {
    throw new AttestError('SUBJECT_MISMATCH', 'voucher sub does not match the badge repo owner')
  }
  if (crt !== expectations.creator) {
    throw new AttestError('SUBJECT_MISMATCH', 'voucher crt does not match the badge subject')
  }

  let didKey = await deps.resolveVerificationMethod(iss, jws.header.kid)
  let ok = await verifyCompact(jws, didKey)
  if (!ok) {
    didKey = await deps.resolveVerificationMethod(iss, jws.header.kid, { noCache: true })
    ok = await verifyCompact(jws, didKey)
  }
  if (!ok) throw new AttestError('BAD_SIGNATURE', 'voucher signature verification failed')

  let offer = await deps.getOffer(crt)
  if (!offer || !offer.authorizedIssuers.includes(iss)) {
    offer = await deps.getOffer(crt, { noCache: true })
  }
  if (!offer) throw new AttestError('OFFER_NOT_FOUND', 'creator has no offer record')
  if (!offer.authorizedIssuers.includes(iss)) {
    throw new AttestError('ISSUER_NOT_AUTHORIZED', `${iss} is not in the creator's authorizedIssuers`)
  }

  return { iss, sub, crt, ...(tn ? { tn } : {}), iat: iat as number, jti }
}
