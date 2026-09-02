# Payment Attestations for ATProto — Draft Specification

**Status:** Draft v0.1 · 2026-08-10 · published for feedback and reconciliation with [attested.network](https://attested.network/). Nothing here is final; §11 lists the open questions.
**Namespace:** `network.eurosky.payments.*` — *provisional.* The final namespace and its steward (proposed: Eurosky as neutral home) are still tbd; nothing in this spec depends on the namespace choice.
**Companion:** [EXPLAINER.md](EXPLAINER.md) — the same design in plain language, with a worked example.

## 1. Overview and terminology

This spec defines how a payment fact — *"this account holds a paid entitlement with that creator"* — is represented, proven, and (optionally) displayed on ATProto **without publishing financial relationships by default**. Design principle: **verifiability ≠ publicity.**

| Term | Meaning |
|---|---|
| **Creator** | Account offering paid tiers (identified by DID). |
| **Supporter** | Account paying for a tier (identified by DID). |
| **Issuer** | A payment service that processes the money and issues credentials (identified by DID). Multiple issuers coexist; the creator designates which ones are authoritative. |
| **Entitlement** | The fact that a supporter currently holds a tier with a creator. |
| **Context (`ctx`)** | What an entitlement grants access to. v1: `{creator, tier}`. Designed to later carry an `ats://` permission-space reference (see §10). |

Three artifacts carry the design (lexicons in [lexicons/](lexicons/)):

1. **Offer record** — public, creator's repo: `network.eurosky.payments.offer`
2. **Entitlement credential** — private signed token, never in a repo (§3)
3. **Badge record** — public, supporter's repo, opt-in: `network.eurosky.payments.badge`

Plus one query API each for obtaining (`getCredentials`) and checking (`checkEntitlement`) entitlements.

## 2. The offer record

`at://{creator}/network.eurosky.payments.offer/self` — at most one per account (rkey `self`).

Normative points beyond the lexicon:

- **`authorizedIssuers` is the root of trust.** A credential from an issuer not on the creator's current list MUST be rejected regardless of signature validity. Consequence: a creator unilaterally revokes a compromised or rogue issuer by editing one record — distrust propagates network-wide at cache speed, with no issuer cooperation needed.
- **`authorizedServices` grants query standing only** (see §5). Listing a service implies no other authority.
- **Display prices are informational.** The issuer's checkout is the billing truth. Apps SHOULD render offer prices but MUST NOT treat them as a quote.
- **Tier `id`s are append-only in spirit:** never reuse an id for a materially different offering; retire and add instead. Credentials reference tier ids, and id reuse would silently change what an outstanding credential means.

## 3. The entitlement credential ("membership card")

A compact JWS. **Never written to any repo.** Held in the supporter's client (secure storage), obtained and renewed via `getCredentials`.

### 3.1 Format

Header:

```json
{ "typ": "ent+jwt", "alg": "ES256K", "kid": "did:web:pay.example.com#payments_attest" }
```

- `alg`: ES256K (secp256k1) or ES256 (p256), matching atproto's cryptography conventions (low-S, compact signatures, base64url).
- `kid`: DID + fragment of the issuer verification method used.

Claims:

| Claim | Required | Content |
|---|---|---|
| `iss` | yes | Issuer DID. MUST match the DID portion of `kid`. |
| `sub` | yes | Supporter DID. |
| `ctx` | yes | Object: `{"creator": "did:...", "tier": "gold"}`. v2 MAY add `space` (§10). |
| `iat` | yes | Issued-at (Unix seconds). |
| `exp` | yes | Expiry. MUST be ≤ `iat` + 7 days AND ≤ end of the currently paid period, whichever is sooner. |
| `jti` | yes | Unique token id (audit/duplicate detection). |

Deliberate exclusions: **no `aud`** (the credential is presented to arbitrary apps — see the binding rule in §6 for why this is safe), and **no amounts, invoice data, or processor references** (data minimization; the ledger stays with the issuer).

### 3.2 Signing keys

The issuer's DID document MUST contain the verification method referenced by `kid`. A dedicated key (fragment RECOMMENDED: `#payments_attest`) SHOULD be used rather than the repo signing key, so key rotation and compromise handling are independent of the issuer's other operations.

### 3.3 Validity, renewal, revocation

**Short validity + silent renewal IS the revocation mechanism.** There are no revocation lists.

- Issuers MUST cap `exp` per §3.1. Seven days bounds the maximum lifetime of a stale entitlement after cancellation or chargeback.
- Clients SHOULD call `getCredentials` when any held credential is within 24 hours of expiry, and on session resume after ≥24h offline.
- On lapse (cancellation, chargeback, failed payment), the issuer simply stops including the credential in `getCredentials` responses. Outstanding tokens age out.
- Services needing tighter-than-7-day accuracy (e.g. high-value gating) SHOULD use `checkEntitlement` instead of accepting presented credentials.

## 4. The badge record and voucher

`network.eurosky.payments.badge` in the supporter's repo. Normative points:

- **Opt-in only.** Issuers and apps MUST NOT create a badge as a side effect of payment. Creation requires an explicit, separate user action ("show my support publicly").
- **Separable.** Deleting a badge MUST NOT affect the entitlement. Apps MUST NOT require a badge for any gating decision.
- **Content-minimal.** No amounts, tier ids, purchase details, or payment references — `tierName` is a display string only.
- **Voucher** (optional field): a compact JWS, header `typ: "entvch+jwt"` (alg/kid as §3.1), claims `iss` (issuer DID), `sub` (supporter DID), `crt` (creator DID), `tn` (tierName, optional), `iat`. Issued only at the supporter's explicit request. No `exp`: a voucher attests the relationship existed at `iat` ("verified supporter since…"), not that it persists. Apps verify: signature against issuer DID document, issuer ∈ subject's current `authorizedIssuers`, `sub` = repo owner, `crt` = badge `subject`. A badge without a voucher MUST be displayed as self-asserted (or undecorated), never as verified.

## 5. Query API and standing

### 5.1 `getCredentials`

Caller: the supporter, via OAuth session with the issuer carrying the payments scope. Returns freshly minted credentials (§3.3). MUST NOT be callable by any other party.

### 5.2 `checkEntitlement`

Caller must have **standing**:

- **(a) The subject themselves** — OAuth session with the issuer, payments scope; or
- **(b) A creator-designated service** — atproto inter-service auth JWT with `lxm = network.eurosky.payments.checkEntitlement`, whose `iss` DID appears in the creator's current offer record `authorizedServices`.

All other callers MUST receive the uniform `NoStanding` error, regardless of whether the subject exists, the creator exists, or any entitlement exists. Response timing SHOULD be uniform across those cases. Issuers SHOULD rate-limit per caller. **Rationale:** without the standing rule, the query endpoint would rebuild — as an API — the public surveillance dataset this design removes from the repos.

## 6. Verification algorithm (presented credentials)

An app or service receiving a presented credential MUST:

1. Parse the compact JWS; check `typ = "ent+jwt"` and a supported `alg`.
2. Check `iat`/`exp` against current time with ≤ 5 minutes clock-skew tolerance.
3. Resolve the `iss` DID document; locate the verification method named by `kid`; verify the signature. On signature failure, re-resolve the DID document once (key may have rotated) before rejecting.
4. Fetch `at://{ctx.creator}/network.eurosky.payments.offer/self`; confirm `iss` ∈ `authorizedIssuers`. (Cacheable, §7.)
5. **Bind the subject:** confirm the party the credential is being honored FOR is `sub`. A credential is a *statement about* `sub`, not an authenticator of the presenter. Concretely: a client app honors it only for its logged-in account = `sub`; a feed generator honors it only when the request's authenticated requester DID = `sub`. Skipping this step lets anyone replay Anna's card and MUST be treated as a broken implementation.
6. Grant per `ctx.tier` (mapped through the creator's offer).

## 7. Caching

- Issuer DID documents: cache ≤ 24h; invalidate on signature failure (§6.3).
- Offer records: cache ≤ 24h. If a cached offer would cause rejection (issuer not listed), re-fetch once before rejecting — the creator may have just added the issuer.
- `checkEntitlement` responses: cache ≤ 5 minutes, keyed per (subject, creator, tier).

## 8. Privacy considerations

- **Default privacy:** paying publishes nothing. The only protocol-visible artifacts of a payment are (optionally) the badge — an explicit user choice — and nothing else. The who-pays-whom graph exists solely in issuer ledgers, which are private, regulated databases that must exist regardless (AML, accounting, chargebacks).
- **Consent by use:** presenting a credential to an app reveals the relationship to that app. That is inherent and proportionate — the supporter is claiming a perk there.
- **The standing rule (§5.2) is a privacy control**, not an availability optimization. Implementations MUST NOT add "public read" modes.
- **GDPR mapping:** badge = consent-based publication, revocable by deletion (Art. 7(3)); credentials expire within days and live client-side; issuer ledger retention runs under its own lawful basis (AML/commercial law), independent of protocol artifacts. Amounts never enter the protocol (data minimization, Art. 5(1)(c)).

## 9. Security considerations

- **Replay/mis-binding:** prevented by §6.5. The absence of `aud` is safe only because of that rule; implementers MUST NOT treat possession as authentication.
- **Issuer compromise:** creator edits `authorizedIssuers` → network-wide distrust at cache speed (≤ 24h worst case, immediate for re-fetching verifiers). Issuers SHOULD additionally rotate `#payments_attest` on compromise.
- **Malicious/lying issuer:** an issuer can only lie about entitlements *for creators that listed it*. It cannot mint valid credentials for any other creator (§6.4 fails). The blast radius of a rogue issuer is its own customers — who chose it and can leave.
- **Offer-record tampering:** the offer lives in the creator's repo under their repo signing key, with ordinary atproto authenticity guarantees.
- **Token theft:** a stolen credential is honored nowhere without also controlling the subject's session (§6.5); worst case it leaks the fact of one relationship — the same fact any app it was presented to already learned — and dies within 7 days.

## 10. Future work (non-normative)

- **Space contexts (ATProto Spaces — alpha as of 2026-08, full launch targeted later in 2026).** The shipped shape (proposal 0016): a space is identified by `at://{spaceDid}/space/{spaceType}/{skey}` (the literal `space` segment — NOT the earlier `ats://` scheme from the diary posts), read access is gated by DPoP-bound space credentials minted by the space authority, and every PDS must support the `com.atproto.simplespace` management implementation. Planned extensions here:
  - `ctx` gains an optional `space` member carrying the space URI a tier unlocks; the offer record's tier gains an optional `grants` array of space URIs. (Not yet added to the v0.1 lexicons — 0016 is explicitly subject to change.)
  - **The direct integration point already exists: `simplespace`'s `managing-app` policy.** A creator anchors their subscriber space with `policy: managing-app` and `managingApp` = the issuer's service identifier; at every credential mint, the space authority calls `com.atproto.simplespace.checkUserAccess` on the issuer, which answers from its ledger. The 0016 proposal's own example for this policy is "paid-subscription status." This makes the issuer's entitlement check the space's access decision in real time — no member-list synchronization, and instantly accurate on lapse/chargeback (tighter than the ≤7-day credential window). Alternative wiring: `policy: member-list` with the issuer holding a `manage=update` grant to call `addMember`/`removeMember` on payment events — survives issuer downtime at the cost of lag. Which is canonical is an open question (§11).
- **Non-subscription shapes:** one-time purchases (tier `period: "once"`), tips with no entitlement at all (pure ledger events — nothing protocol-visible unless the supporter opts into a badge).

## 11. Interop and open questions (for reconciliation with attested.network)

1. Record-shape reconciliation: can attested's existing public attestation records map onto the badge (+voucher) so current PoC data migrates cleanly?
2. Final namespace and steward (Eurosky offered as neutral home) — blocks nothing in this draft.
3. Payments OAuth scope naming — should align with whatever permission-set conventions the atproto OAuth work lands on.
4. Voucher semantics: is "verified at issue time, no expiry" acceptable to Graze's badge UX, or do they want renewable vouchers?
5. `checkEntitlement` standing (b): is offer-record `authorizedServices` enough, or is a delegation chain (creator → service → sub-service) needed for real deployments?
6. Should the entitlement credential adopt DPoP binding (`cnf.jkt`, per RFC 9449) like 0016's space credentials, instead of or in addition to the subject-binding rule (§6.5)? DPoP binding makes cards per-app (each app obtains its own via `getCredentials` with its own key) — stronger against replay, still DID-portable through re-issuance, at the cost of client complexity.
7. Issuer-handoff mechanics to standardize: departing-issuer obligations (answer window for paid periods), successor card-honoring grace windows, and whether a member-list snapshot on switch should be specified for `member-list`-wired spaces.
8. Gated-space wiring: is `managing-app`/`checkUserAccess` (real-time, issuer-availability-dependent) or `member-list` + issuer `manage` grants (laggy, availability-independent) the canonical integration? And should the space authority be the creator's DID or a dedicated DID (0016 supports both; a dedicated DID makes the subscriber space transferable independent of the creator's account)?
8. Issuer discovery from the supporter side: an app resolves *creator → issuers* from the offer record, but nothing defines how it learns *which of those issuers the supporter actually holds an account with*. Absent a rule, a client walks the creator's `authorizedIssuers` and attempts `getCredentials` at each — correct and leak-free (an issuer the supporter has no session with simply cannot be called, and one where she has no entitlement returns an empty list), but it costs an OAuth grant per issuer and O(issuers) round-trips. Options: leave it to clients; a client-local registry of issuers the user has already authorized (probably sufficient in practice); or a supporter-side hint record — which reintroduces a public who-pays-whom signal and should be rejected on §8 grounds.
