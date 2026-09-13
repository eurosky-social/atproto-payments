import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Secp256k1Keypair } from '@atproto/crypto'
import {
  assertSubjectBinding,
  verifyEntitlementCredential,
  verifyVoucher,
  type VerifierDeps,
} from '@atproto-payments/attest-core'
import { createIdentity, createMockIssuer, type MockIssuer } from '../src/index.js'

const ANNA = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa'
const BEN = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb'
const FEEDGEN = 'did:web:feed.example.com'
const SPACE = `at://${BEN}/space/network.eurosky.payments.subscribers/self`

let issuer: MockIssuer
let base: string
let annaToken: string
let feedgenKey: Secp256k1Keypair
let authorityKey: Secp256k1Keypair

const b64url = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url')

/** Mint an atproto-style inter-service JWT signed by `key`. */
const serviceJwt = async (key: Secp256k1Keypair, iss: string, aud: string, lxm: string) => {
  const h = b64url({ typ: 'JWT', alg: key.jwtAlg })
  const p = b64url({ iss, aud, lxm, exp: Math.floor(Date.now() / 1000) + 60, jti: 'test-nonce' })
  const sig = await key.sign(new TextEncoder().encode(`${h}.${p}`))
  return `${h}.${p}.${Buffer.from(sig).toString('base64url')}`
}

const get = async (path: string, token?: string) => {
  const res = await fetch(`${base}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
  return { status: res.status, body: (await res.json()) as any }
}

const post = async (path: string, body: unknown, token?: string) => {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: (await res.json()) as any }
}

const verifierDeps = (): VerifierDeps => ({
  resolveVerificationMethod: async () => issuer.identity.didKey,
  getOffer: async () => ({
    tiers: [{ id: 'gold', name: 'Gold' }],
    authorizedIssuers: [issuer.identity.did],
    createdAt: '2026-08-01T00:00:00.000Z',
  }),
})

beforeAll(async () => {
  issuer = createMockIssuer(await createIdentity())
  await new Promise<void>((resolve) => issuer.server.listen(0, '127.0.0.1', resolve))
  const addr = issuer.server.address()
  if (addr === null || typeof addr === 'string') throw new Error('no port')
  base = `http://127.0.0.1:${addr.port}`

  annaToken = issuer.createSession(ANNA)
  feedgenKey = await Secp256k1Keypair.create()
  authorityKey = await Secp256k1Keypair.create()
  issuer.registerService(FEEDGEN, feedgenKey.did())
  issuer.registerService(BEN, authorityKey.did()) // Ben's DID is also his space's authority
  issuer.registerOffer(BEN, { authorizedServices: [FEEDGEN] })
})

afterAll(() => {
  issuer.server.close()
})

describe('settle → getCredentials → verify with attest-core', () => {
  it('returns a card that verifies end to end and binds to Anna', async () => {
    await post('/admin/entitlements', { subject: ANNA, creator: BEN, tier: 'gold' })
    const { status, body } = await get(
      `/xrpc/network.eurosky.payments.getCredentials?creator=${BEN}`,
      annaToken,
    )
    expect(status).toBe(200)
    expect(body.credentials).toHaveLength(1)
    expect(body.credentials[0].creator).toBe(BEN)

    const claims = await verifyEntitlementCredential(body.credentials[0].token, verifierDeps())
    expect(claims.iss).toBe(issuer.identity.did)
    expect(() => assertSubjectBinding(claims, ANNA)).not.toThrow()
    expect(() => assertSubjectBinding(claims, BEN)).toThrow()
  })

  it('requires a supporter session', async () => {
    const { status } = await get('/xrpc/network.eurosky.payments.getCredentials')
    expect(status).toBe(401)
  })

  // SPEC §5.0: the proof an issuer must accept is the one the supporter's own
  // PDS mints, so an app can ask on their behalf without ever registering here.
  it('accepts a token the supporter\'s own PDS signed', async () => {
    const annaKey = await Secp256k1Keypair.create()
    issuer.registerService(ANNA, annaKey.did())
    const jwt = await serviceJwt(
      annaKey, ANNA, issuer.identity.did, 'network.eurosky.payments.getCredentials',
    )

    const { status, body } = await get('/xrpc/network.eurosky.payments.getCredentials', jwt)
    expect(status).toBe(200)
    expect(body.credentials).toHaveLength(1)
    const claims = await verifyEntitlementCredential(body.credentials[0].token, verifierDeps())
    expect(() => assertSubjectBinding(claims, ANNA)).not.toThrow()
  })
})

describe('checkEntitlement standing rules', () => {
  const path = `/xrpc/network.eurosky.payments.checkEntitlement?subject=${ANNA}&creator=${BEN}`

  it('answers the subject themselves', async () => {
    const { status, body } = await get(path, annaToken)
    expect(status).toBe(200)
    expect(body).toMatchObject({ active: true, tier: 'gold' })
  })

  it('answers the subject proving themselves with their own PDS', async () => {
    const annaKey = await Secp256k1Keypair.create()
    issuer.registerService(ANNA, annaKey.did())
    const jwt = await serviceJwt(
      annaKey, ANNA, issuer.identity.did, 'network.eurosky.payments.checkEntitlement',
    )
    const { status, body } = await get(path, jwt)
    expect(status).toBe(200)
    expect(body).toMatchObject({ active: true, tier: 'gold' })
  })

  it('answers a creator-authorized service via service auth', async () => {
    const jwt = await serviceJwt(
      feedgenKey, FEEDGEN, issuer.identity.did, 'network.eurosky.payments.checkEntitlement',
    )
    const { status, body } = await get(path, jwt)
    expect(status).toBe(200)
    expect(body.active).toBe(true)
  })

  it('is uniform NoStanding for everyone else', async () => {
    // Unauthenticated-but-well-formed bearer, another user's session, an
    // unauthorized service, and a wrong-lxm token all get the same answer.
    const otherSession = issuer.createSession('did:plc:cccccccccccccccccccccccc')
    const strangerKey = await Secp256k1Keypair.create()
    issuer.registerService('did:web:stranger.example', strangerKey.did())
    const strangerJwt = await serviceJwt(
      strangerKey, 'did:web:stranger.example', issuer.identity.did, 'network.eurosky.payments.checkEntitlement',
    )
    const wrongLxm = await serviceJwt(feedgenKey, FEEDGEN, issuer.identity.did, 'com.example.other')

    for (const token of [otherSession, strangerJwt, wrongLxm, 'garbage']) {
      const { status, body } = await get(path, token)
      expect(status).toBe(400)
      expect(body.error).toBe('NoStanding')
    }
  })

  it('reports inactive for a non-existent entitlement to a caller WITH standing', async () => {
    const { body } = await get(
      `/xrpc/network.eurosky.payments.checkEntitlement?subject=${ANNA}&creator=did:plc:dddddddddddddddddddddddd`,
      annaToken,
    )
    expect(body).toEqual({ active: false })
  })
})

describe('lapse and chargeback', () => {
  it('lapse: cards stop renewing and checks flip to inactive', async () => {
    await post('/admin/lapse', { subject: ANNA, creator: BEN })
    const creds = await get(`/xrpc/network.eurosky.payments.getCredentials`, annaToken)
    expect(creds.body.credentials).toHaveLength(0)
    const check = await get(
      `/xrpc/network.eurosky.payments.checkEntitlement?subject=${ANNA}&creator=${BEN}`,
      annaToken,
    )
    expect(check.body).toEqual({ active: false })
  })

  it('re-settle then chargeback behaves the same', async () => {
    await post('/admin/entitlements', { subject: ANNA, creator: BEN, tier: 'gold' })
    await post('/admin/chargeback', { subject: ANNA, creator: BEN })
    const creds = await get(`/xrpc/network.eurosky.payments.getCredentials`, annaToken)
    expect(creds.body.credentials).toHaveLength(0)
  })
})

describe('checkUserAccess — the Spaces managing-app socket', () => {
  const path = (space: string) =>
    `/xrpc/com.atproto.simplespace.checkUserAccess?space=${encodeURIComponent(space)}&user=${ANNA}`

  it('grants and revokes space access on payment state', async () => {
    await post('/admin/spaces', { space: SPACE, creator: BEN })
    await post('/admin/entitlements', { subject: ANNA, creator: BEN, tier: 'gold' })
    const jwt = await serviceJwt(authorityKey, BEN, issuer.identity.did, 'com.atproto.simplespace.checkUserAccess')

    const yes = await get(path(SPACE), jwt)
    expect(yes.body).toEqual({ authorized: true })

    await post('/admin/lapse', { subject: ANNA, creator: BEN })
    const no = await get(path(SPACE), jwt)
    expect(no.body).toEqual({ authorized: false })
  })

  it('answers only the space authority', async () => {
    const jwt = await serviceJwt(
      feedgenKey, FEEDGEN, issuer.identity.did, 'com.atproto.simplespace.checkUserAccess',
    )
    const { status } = await get(path(SPACE), jwt)
    expect(status).toBe(401)
  })

  // Since 2026-09-10 the authority asks about reading and writing separately.
  // An issuer that answers both from the ledger hands every paying supporter a
  // writer's seat in the creator's space.
  it('admits a paying supporter to read and still refuses the write', async () => {
    await post('/admin/spaces', { space: SPACE, creator: BEN })
    await post('/admin/entitlements', { subject: ANNA, creator: BEN, tier: 'gold' })
    const jwt = await serviceJwt(authorityKey, BEN, issuer.identity.did, 'com.atproto.simplespace.checkUserAccess')

    const read = await get(`${path(SPACE)}&access=read`, jwt)
    expect(read.body).toEqual({ authorized: true })

    const write = await get(`${path(SPACE)}&access=write`, jwt)
    expect(write.body).toEqual({ authorized: false })

    // A door we do not understand is a door we keep shut.
    const other = await get(`${path(SPACE)}&access=administer`, jwt)
    expect(other.body).toEqual({ authorized: false })
  })

  it('denies unknown spaces without leaking why', async () => {
    const unknownSpace = `at://${BEN}/space/network.eurosky.payments.subscribers/other`
    const jwt = await serviceJwt(authorityKey, BEN, issuer.identity.did, 'com.atproto.simplespace.checkUserAccess')
    const { body } = await get(path(unknownSpace), jwt)
    expect(body).toEqual({ authorized: false })
  })
})

describe('admin voucher', () => {
  it('mints a voucher that verifies against the badge context', async () => {
    const { body } = await post('/admin/voucher', { subject: ANNA, creator: BEN, tierName: 'Gold' })
    const claims = await verifyVoucher(body.token, { supporter: ANNA, creator: BEN }, verifierDeps())
    expect(claims.tn).toBe('Gold')
  })
})
