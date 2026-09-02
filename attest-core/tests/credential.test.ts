import { describe, expect, it, vi } from 'vitest'
import { P256Keypair, Secp256k1Keypair } from '@atproto/crypto'
import {
  AttestError,
  MAX_TTL_SECONDS,
  assertSubjectBinding,
  createEntitlementCredential,
  createVoucher,
  decodeCompact,
  verifyEntitlementCredential,
  verifyVoucher,
  type OfferRecord,
  type VerifierDeps,
} from '../src/index.js'

const ISSUER = 'did:web:pay.example.com'
const KID = `${ISSUER}#payments_attest`
const ANNA = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa'
const BEN = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb'
const NOW = new Date('2026-08-10T12:00:00Z')

const offerFor = (issuers: string[]): OfferRecord => ({
  tiers: [{ id: 'gold', name: 'Gold' }],
  authorizedIssuers: issuers,
  createdAt: '2026-08-01T00:00:00.000Z',
})

const depsFor = (didKey: string, offer: OfferRecord | null): VerifierDeps => ({
  resolveVerificationMethod: async () => didKey,
  getOffer: async () => offer,
  now: () => NOW,
})

const mint = async (signer: Secp256k1Keypair | P256Keypair, over: Record<string, unknown> = {}) =>
  createEntitlementCredential({
    signer,
    kid: KID,
    sub: ANNA,
    ctx: { creator: BEN, tier: 'gold' },
    now: NOW,
    ...over,
  })

const code = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p
    return 'OK'
  } catch (err) {
    if (err instanceof AttestError) return err.code
    throw err
  }
}

describe('createEntitlementCredential', () => {
  it('caps exp at 7 days and at periodEnd, whichever is sooner', async () => {
    const key = await Secp256k1Keypair.create()
    const nowSec = Math.floor(NOW.getTime() / 1000)

    const week = decodeCompact(await mint(key))
    expect(week.payload.exp).toBe(nowSec + MAX_TTL_SECONDS)

    const periodEnd = new Date(NOW.getTime() + 24 * 3600 * 1000)
    const capped = decodeCompact(await mint(key, { periodEnd }))
    expect(capped.payload.exp).toBe(nowSec + 24 * 3600)
  })

  it('rejects a ttl beyond 7 days and a lapsed periodEnd', async () => {
    const key = await Secp256k1Keypair.create()
    await expect(code(mint(key, { ttlSeconds: MAX_TTL_SECONDS + 1 }))).resolves.toBe('INVALID_CLAIMS')
    await expect(code(mint(key, { periodEnd: new Date(NOW.getTime() - 1000) }))).resolves.toBe('INVALID_CLAIMS')
  })

  it('never includes amounts or unknown fields', async () => {
    const key = await Secp256k1Keypair.create()
    const { payload } = decodeCompact(await mint(key))
    expect(Object.keys(payload).sort()).toEqual(['ctx', 'exp', 'iat', 'iss', 'jti', 'sub'])
  })
})

describe('verifyEntitlementCredential', () => {
  it('verifies a valid ES256K credential end to end', async () => {
    const key = await Secp256k1Keypair.create()
    const token = await mint(key)
    const claims = await verifyEntitlementCredential(token, depsFor(key.did(), offerFor([ISSUER])))
    expect(claims.iss).toBe(ISSUER)
    expect(claims.sub).toBe(ANNA)
    expect(claims.ctx).toEqual({ creator: BEN, tier: 'gold' })
  })

  it('verifies a valid ES256 credential end to end', async () => {
    const key = await P256Keypair.create()
    const token = await mint(key)
    const claims = await verifyEntitlementCredential(token, depsFor(key.did(), offerFor([ISSUER])))
    expect(claims.ctx.tier).toBe('gold')
  })

  it('rejects an expired credential, honoring skew', async () => {
    const key = await Secp256k1Keypair.create()
    const token = await mint(key, { ttlSeconds: 3600 })
    const deps = depsFor(key.did(), offerFor([ISSUER]))

    const withinSkew = { ...deps, now: () => new Date(NOW.getTime() + (3600 + 200) * 1000) }
    await expect(verifyEntitlementCredential(token, withinSkew)).resolves.toBeTruthy()

    const beyondSkew = { ...deps, now: () => new Date(NOW.getTime() + (3600 + 400) * 1000) }
    await expect(code(verifyEntitlementCredential(token, beyondSkew))).resolves.toBe('EXPIRED')
  })

  it('rejects a future-dated credential beyond skew', async () => {
    const key = await Secp256k1Keypair.create()
    const token = await mint(key, { now: new Date(NOW.getTime() + 600 * 1000) })
    const deps = depsFor(key.did(), offerFor([ISSUER]))
    await expect(code(verifyEntitlementCredential(token, deps))).resolves.toBe('NOT_YET_VALID')
  })

  it('rejects a tampered payload', async () => {
    const key = await Secp256k1Keypair.create()
    const [h, p, s] = (await mint(key)).split('.')
    const doctored = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'))
    doctored.ctx.tier = 'platinum'
    const forged = [h, Buffer.from(JSON.stringify(doctored)).toString('base64url'), s].join('.')
    const deps = depsFor(key.did(), offerFor([ISSUER]))
    await expect(code(verifyEntitlementCredential(forged, deps))).resolves.toBe('BAD_SIGNATURE')
  })

  it('rejects the wrong typ', async () => {
    const key = await Secp256k1Keypair.create()
    const voucher = await createVoucher({ signer: key, kid: KID, sub: ANNA, crt: BEN, now: NOW })
    const deps = depsFor(key.did(), offerFor([ISSUER]))
    await expect(code(verifyEntitlementCredential(voucher, deps))).resolves.toBe('BAD_TYP')
  })

  it('rejects an issuer the creator has not authorized — after an uncached re-check', async () => {
    const key = await Secp256k1Keypair.create()
    const token = await mint(key)
    const getOffer = vi.fn(async () => offerFor(['did:web:other-issuer.example']))
    const deps: VerifierDeps = { ...depsFor(key.did(), null), getOffer, now: () => NOW }
    await expect(code(verifyEntitlementCredential(token, deps))).resolves.toBe('ISSUER_NOT_AUTHORIZED')
    expect(getOffer).toHaveBeenCalledTimes(2)
    expect(getOffer.mock.calls[1][1]).toEqual({ noCache: true })
  })

  it('recovers from key rotation by re-resolving once uncached', async () => {
    const oldKey = await Secp256k1Keypair.create()
    const newKey = await Secp256k1Keypair.create()
    const token = await mint(newKey)
    const resolve = vi.fn(async (_did: string, _kid: string, opts?: { noCache?: boolean }) =>
      opts?.noCache ? newKey.did() : oldKey.did(),
    )
    const deps: VerifierDeps = {
      resolveVerificationMethod: resolve,
      getOffer: async () => offerFor([ISSUER]),
      now: () => NOW,
    }
    const claims = await verifyEntitlementCredential(token, deps)
    expect(claims.sub).toBe(ANNA)
    expect(resolve).toHaveBeenCalledTimes(2)
  })

  it('rejects a kid whose DID does not match iss', async () => {
    const key = await Secp256k1Keypair.create()
    const token = await createEntitlementCredential({
      signer: key,
      kid: 'did:web:evil.example.com#payments_attest',
      sub: ANNA,
      ctx: { creator: BEN, tier: 'gold' },
      now: NOW,
    })
    // Forge iss back to the real issuer without re-signing.
    const [h, p, s] = token.split('.')
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'))
    payload.iss = ISSUER
    const forged = [h, Buffer.from(JSON.stringify(payload)).toString('base64url'), s].join('.')
    const deps = depsFor(key.did(), offerFor([ISSUER]))
    await expect(code(verifyEntitlementCredential(forged, deps))).resolves.toBe('ISSUER_KID_MISMATCH')
  })
})

describe('assertSubjectBinding', () => {
  it('passes for the credential subject and rejects anyone else', async () => {
    const key = await Secp256k1Keypair.create()
    const token = await mint(key)
    const claims = await verifyEntitlementCredential(token, depsFor(key.did(), offerFor([ISSUER])))
    expect(() => assertSubjectBinding(claims, ANNA)).not.toThrow()
    expect(() => assertSubjectBinding(claims, BEN)).toThrow(AttestError)
  })
})

describe('vouchers', () => {
  it('verifies a valid voucher against the badge context', async () => {
    const key = await Secp256k1Keypair.create()
    const token = await createVoucher({ signer: key, kid: KID, sub: ANNA, crt: BEN, tn: 'Gold', now: NOW })
    const claims = await verifyVoucher(
      token,
      { supporter: ANNA, creator: BEN },
      depsFor(key.did(), offerFor([ISSUER])),
    )
    expect(claims.tn).toBe('Gold')
  })

  it('rejects a voucher pasted into someone else’s badge', async () => {
    const key = await Secp256k1Keypair.create()
    const token = await createVoucher({ signer: key, kid: KID, sub: ANNA, crt: BEN, now: NOW })
    const deps = depsFor(key.did(), offerFor([ISSUER]))
    await expect(
      code(verifyVoucher(token, { supporter: 'did:plc:cccccccccccccccccccccccc', creator: BEN }, deps)),
    ).resolves.toBe('SUBJECT_MISMATCH')
  })

  it('rejects a voucher from a de-authorized issuer', async () => {
    const key = await Secp256k1Keypair.create()
    const token = await createVoucher({ signer: key, kid: KID, sub: ANNA, crt: BEN, now: NOW })
    const deps = depsFor(key.did(), offerFor(['did:web:someone-else.example']))
    await expect(code(verifyVoucher(token, { supporter: ANNA, creator: BEN }, deps))).resolves.toBe(
      'ISSUER_NOT_AUTHORIZED',
    )
  })
})
