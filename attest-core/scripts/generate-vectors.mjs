// Generates the committed interop test vectors in vectors/v0.json.
// Run via `npm run vectors`. Keys and timestamps are fixed so the vector
// *inputs* are stable; ECDSA signatures are not deterministic across runs,
// so tokens are whatever this script produced when the file was committed —
// consumers verify the committed tokens, they do not re-derive them.
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { P256Keypair, Secp256k1Keypair } from '@atproto/crypto'
import { createEntitlementCredential, createVoucher } from '../dist/index.js'

const ISSUER = 'did:web:pay.example.com'
const KID = `${ISSUER}#payments_attest`
const ANNA = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa'
const BEN = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb'
const NOW = new Date('2026-08-01T00:00:00Z')

const SECP_PRIV = '1f9c6dcecf0429dcbf0be8db6d0d91b1f2c3d4e5f60718293a4b5c6d7e8f9012'
const P256_PRIV = '2a8b7c6d5e4f30211203f4e5d6c7b8a99887766554433221100ffeeddccbbaa0'

const offer = (issuers) => ({
  tiers: [{ id: 'gold', name: 'Gold' }],
  authorizedIssuers: issuers,
  createdAt: '2026-08-01T00:00:00.000Z',
})

const main = async () => {
  const secp = await Secp256k1Keypair.import(SECP_PRIV)
  const p256 = await P256Keypair.import(P256_PRIV)
  const base = { kid: KID, sub: ANNA, ctx: { creator: BEN, tier: 'gold' }, now: NOW }

  const vectors = {
    description:
      'Interop vectors for the payment attestation draft spec. Verify each token with resolveVerificationMethod -> issuerDidKey and getOffer -> offer, at validation time verifyAt. Expected: OK or the listed error code.',
    spec: 'spec/SPEC.md v0.1',
    issuer: ISSUER,
    kid: KID,
    supporter: ANNA,
    creator: BEN,
    cases: [
      {
        name: 'valid-es256k',
        token: await createEntitlementCredential({ ...base, signer: secp, ttlSeconds: 7 * 24 * 3600, jti: 'vec-es256k-0001' }),
        issuerDidKey: secp.did(),
        offer: offer([ISSUER]),
        verifyAt: '2026-08-01T12:00:00Z',
        expected: 'OK',
      },
      {
        name: 'valid-es256',
        token: await createEntitlementCredential({ ...base, signer: p256, ttlSeconds: 7 * 24 * 3600, jti: 'vec-es256-0001' }),
        issuerDidKey: p256.did(),
        offer: offer([ISSUER]),
        verifyAt: '2026-08-01T12:00:00Z',
        expected: 'OK',
      },
      {
        name: 'expired',
        token: await createEntitlementCredential({ ...base, signer: secp, ttlSeconds: 3600, jti: 'vec-expired-0001' }),
        issuerDidKey: secp.did(),
        offer: offer([ISSUER]),
        verifyAt: '2026-08-02T00:00:00Z',
        expected: 'EXPIRED',
      },
      {
        name: 'issuer-not-authorized',
        token: await createEntitlementCredential({ ...base, signer: secp, ttlSeconds: 7 * 24 * 3600, jti: 'vec-unauth-0001' }),
        issuerDidKey: secp.did(),
        offer: offer(['did:web:other-issuer.example']),
        verifyAt: '2026-08-01T12:00:00Z',
        expected: 'ISSUER_NOT_AUTHORIZED',
      },
      {
        name: 'voucher-valid-es256k',
        token: await createVoucher({ signer: secp, kid: KID, sub: ANNA, crt: BEN, tn: 'Gold', now: NOW, jti: 'vec-voucher-0001' }),
        issuerDidKey: secp.did(),
        offer: offer([ISSUER]),
        badge: { repoOwner: ANNA, subject: BEN },
        verifyAt: '2026-08-01T12:00:00Z',
        expected: 'OK',
      },
    ],
  }

  const out = fileURLToPath(new URL('../vectors/v0.json', import.meta.url))
  await mkdir(fileURLToPath(new URL('../vectors/', import.meta.url)), { recursive: true })
  await writeFile(out, JSON.stringify(vectors, null, 2) + '\n')
  console.log(`wrote ${vectors.cases.length} vectors to ${out}`)
}

await main()
