import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  AttestError,
  assertSubjectBinding,
  MAX_TTL_SECONDS,
  verifyEntitlementCredential,
  type OfferRecord,
  type VerifierDeps,
} from '../src/index.js'

/**
 * "Any verifier can check a card" is an assertion until this file passes.
 *
 * The token in the vector was minted by an independent implementation — a
 * Rails issuer, in a different language, with a different crypto library and a
 * different JWS implementation — and is verified here by the reference
 * implementation against the public key that issuer publishes in its DID
 * document. Nothing is mocked but the network.
 *
 * Regenerate it from that implementation after changing its signer — its own
 * `interop:credential` task mints one under the spec's example issuer DID, and
 * keeps its own shape test honest at the same time.
 */
interface Vector {
  token: string
  issuerDidKey: string
  kid: string
  subject: string
  offer: OfferRecord
  verifyAt: string
}

const vector = JSON.parse(
  readFileSync(new URL('../vectors/rails-issuer.json', import.meta.url), 'utf8'),
) as Vector

const depsWith = (offer: OfferRecord | null): VerifierDeps => ({
  resolveVerificationMethod: async (_did, kid) => {
    if (kid !== vector.kid) throw new Error(`unexpected kid ${kid}`)
    return vector.issuerDidKey
  },
  getOffer: async () => offer,
  now: () => new Date(vector.verifyAt),
})

describe('a card minted by a Rails issuer', () => {
  it('verifies against the key that backend publishes', async () => {
    const claims = await verifyEntitlementCredential(vector.token, depsWith(vector.offer))

    expect(claims.sub).toBe(vector.subject)
    expect(claims.iss).toBe(vector.kid.split('#')[0])
    expect(claims.ctx.creator).toMatch(/^did:/)
    expect(claims.ctx.tier).toBeTruthy()
    expect(claims.jti).toBeTruthy()
  })

  it('is short-lived, as the spec requires of every issuer', async () => {
    const claims = await verifyEntitlementCredential(vector.token, depsWith(vector.offer))
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(MAX_TTL_SECONDS)
  })

  // SPEC §6.5: the card is a statement ABOUT a subject, never proof that the
  // presenter is that subject.
  it('is honoured only for its subject', async () => {
    const claims = await verifyEntitlementCredential(vector.token, depsWith(vector.offer))

    expect(() => assertSubjectBinding(claims, vector.subject)).not.toThrow()
    expect(() => assertSubjectBinding(claims, 'did:plc:someoneelse00000000000')).toThrow(AttestError)
  })

  // SPEC §6.4: the creator's list is the root of trust, and it outranks a
  // perfectly good signature.
  it('is rejected once the creator stops authorizing that issuer', async () => {
    const disowned = { ...vector.offer, authorizedIssuers: ['did:web:someone-else.example'] }
    await expect(verifyEntitlementCredential(vector.token, depsWith(disowned))).rejects.toMatchObject({
      code: 'ISSUER_NOT_AUTHORIZED',
    })
  })
})
