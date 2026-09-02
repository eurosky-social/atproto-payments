# @atproto-payments/mock-issuer

A fake payment issuer for demos and integration tests. It has everything a real issuer has **except money**: a ledger you flip by hand (settle / lapse / chargeback), credential minting via [attest-core](../attest-core/), the `checkEntitlement` query with the spec's standing rules, and the `com.atproto.simplespace.checkUserAccess` socket so it can serve as a **managing app for an ATProto Space** (the Spaces-alpha pilot, PLAN 2.7).

The admin surface is unauthenticated by design and the server binds to `127.0.0.1` — this is a demo tool, never expose it.

```
npm start          # builds and listens on http://127.0.0.1:4025
```

## Walkthrough: the whole story in curl

```bash
BASE=http://127.0.0.1:4025
ANNA=did:plc:aaaaaaaaaaaaaaaaaaaaaaaa   # supporter
BEN=did:plc:bbbbbbbbbbbbbbbbbbbbbbbb    # creator

# Who is the issuer? (DID, kid, and the did:key verifiers resolve the kid to)
curl -s $BASE/admin/identity

# Anna "logs in" (stand-in for OAuth) → bearer token
TOKEN=$(curl -s -X POST $BASE/admin/sessions -d "{\"did\":\"$ANNA\"}" | jq -r .token)

# 1. Anna pays: the ledger flips to active (this is the ONLY record of money)
curl -s -X POST $BASE/admin/entitlements \
  -d "{\"subject\":\"$ANNA\",\"creator\":\"$BEN\",\"tier\":\"gold\"}"

# 2. Anna's app fetches her membership card (silently renewable, exp ≤ 7d)
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE/xrpc/network.eurosky.payments.getCredentials" | jq

# 3. Anna (or a creator-authorized service) checks the entitlement
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE/xrpc/network.eurosky.payments.checkEntitlement?subject=$ANNA&creator=$BEN" | jq

# 4. A stranger asking the same question gets a uniform NoStanding —
#    the endpoint is not an oracle for who subscribes to whom
curl -s "$BASE/xrpc/network.eurosky.payments.checkEntitlement?subject=$ANNA&creator=$BEN" \
  -H "Authorization: Bearer not-a-real-token" | jq

# 5. Spaces: gate Ben's subscriber space on the ledger
curl -s -X POST $BASE/admin/spaces \
  -d "{\"space\":\"at://$BEN/space/network.eurosky.payments.subscribers/self\",\"creator\":\"$BEN\"}"
#    (the space authority then calls POST /xrpc/com.atproto.simplespace.checkUserAccess
#     with inter-service auth; see tests/server.test.ts for the exact shape)

# 6. Chargeback → everything shuts off: cards stop renewing, checks flip,
#    the space door closes. No revocation lists anywhere.
curl -s -X POST $BASE/admin/chargeback -d "{\"subject\":\"$ANNA\",\"creator\":\"$BEN\"}"
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE/xrpc/network.eurosky.payments.getCredentials" | jq   # → { "credentials": [] }
```

## Endpoints

**XRPC (the spec surface):**

| Method | Auth | Behavior |
|---|---|---|
| `GET /xrpc/network.eurosky.payments.getCredentials` | supporter bearer session | Freshly minted `ent+jwt` cards for the caller's active entitlements. Lapsed/chargebacked entitlements simply stop appearing (SPEC §3.3). |
| `GET /xrpc/network.eurosky.payments.checkEntitlement` | subject session OR service JWT (`lxm` bound) from a DID in the creator's `authorizedServices` | `{active, tier?, expiresAt?}`; everyone else gets uniform `NoStanding` (SPEC §5.2). |
| `GET /xrpc/com.atproto.simplespace.checkUserAccess` | service JWT from the space's own authority | `{authorized}` from the ledger, via the space→creator mapping. The managing-app socket, matching the permissioned-data branch lexicon (query with `space`, `user`, `clientId?` params). |

**Admin (demo only):** `GET /admin/identity`, `GET /admin/state`, `POST /admin/sessions` (bearer for a DID), `POST /admin/services` (register a service DID → did:key), `POST /admin/offers` (creator's `authorizedServices`), `POST /admin/entitlements` (settle), `POST /admin/lapse`, `POST /admin/chargeback`, `POST /admin/spaces` (space URI → creator), `POST /admin/voucher` (badge countersignature).

What real infrastructure replaces per piece: sessions → atproto OAuth with the payments scope; `/admin/services` and `/admin/offers` → resolving DID documents and the creator's offer record from their PDS; `/admin/entitlements` → real settlement events from whatever payment rail the issuer runs on. The XRPC surface is what stays.
