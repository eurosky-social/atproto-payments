# @atproto-payments/attest-core

Reference implementation of the [payment attestation draft spec](../spec/SPEC.md): entitlement credentials (`ent+jwt`), badge vouchers (`entvch+jwt`), and the verification algorithm (SPEC §6). TypeScript, transport-free — DID resolution and offer-record fetching are injected, so it runs identically in a client, a feed generator, or a test.

> Working package name. The final name follows the namespace decision (SPEC §11 Q2).

```ts
import {
  createEntitlementCredential, verifyEntitlementCredential, assertSubjectBinding,
} from '@atproto-payments/attest-core'

// Issuer side: mint a membership card when a payment settles.
const token = await createEntitlementCredential({
  signer,                                   // @atproto/crypto Keypair for the issuer's #payments_attest key
  kid: 'did:web:pay.example.com#payments_attest',
  sub: 'did:plc:…anna…',
  ctx: { creator: 'did:plc:…ben…', tier: 'gold' },
  periodEnd: subscriptionPeriodEnd,         // exp = min(now + 7d, periodEnd)
})

// Verifier side (app or feed generator):
const claims = await verifyEntitlementCredential(token, {
  resolveVerificationMethod,                // (did, kid) -> did:key of the issuer's published key
  getOffer,                                 // (creatorDid) -> the creator's …payments.offer record
})
assertSubjectBinding(claims, authenticatedRequesterDid) // SPEC §6.5 — never skip
```

What the verifier enforces, per the spec: typ/alg checks, the time window with ±5 min skew, signature against the issuer's DID-document key (with one uncached re-resolve on failure, for key rotation), `iss` ↔ `kid` consistency, and issuer membership in the creator's current `authorizedIssuers` (with one uncached re-fetch on a miss). Subject binding is a separate explicit call because it requires the caller's own authentication context.

- `npm test` — 21 tests including the committed-vectors round-trip
- `npm run vectors` — regenerate [vectors/v0.json](vectors/v0.json), the interop contract for other implementations (tokens are committed artifacts; ECDSA signing is not deterministic across runs)
