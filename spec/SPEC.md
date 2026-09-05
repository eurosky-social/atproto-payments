# Payment Attestations for ATProto — Draft Specification

**Status:** Draft v0.2 · 2026-09-04 · published for feedback and reconciliation with [attested.network](https://attested.network/). Nothing here is final; §11 lists the open questions.
**Namespace:** `network.eurosky.payments.*` — *provisional.* The final namespace and its steward (proposed: Eurosky as neutral home) are still tbd; nothing in this spec depends on the namespace choice.

## 1. Overview and terminology

This spec defines how a payment fact — *"this account holds a paid entitlement with that creator"* — is represented, proven, and (optionally) displayed on ATProto **without publishing financial relationships by default**. Design principle: **verifiability ≠ publicity.**

| Term | Meaning |
|---|---|
| **Creator** | Account offering paid tiers (identified by DID). |
| **Supporter** | Account paying for a tier (identified by DID). |
| **Issuer** | A payment service that processes the money and issues credentials (identified by DID). Multiple issuers coexist; the creator designates which ones are authoritative. |
| **Entitlement** | The fact that a supporter currently holds a tier with a creator. |
| **Context (`ctx`)** | What an entitlement grants access to. v1: `{creator, tier}`. Designed to later carry an `ats://` permission-space reference (see §10). |
| **App** | A client that sells, displays, or both. It may **originate** a subscription (convert it) and **deliver** it (put the content in front of the supporter over time); these are separately compensated (§2.2). |
| **Coverage** | The fraction of a gated space's declared content types that a given app can render (§2.1). Coverage below 1 is legitimate and must be disclosed, not hidden. |

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
- **`gatedSpaces` is how a viewer finds a creator's gated spaces at all.** `com.atproto.space.listSpaces` answers only for the account making the call, so an app holding a supporter's session cannot enumerate the creator's spaces; the offer is the index. It is also where a space gets a human name, which the protocol does not give it (a space is addressed by type and record key alone). The list is informational: the space's own policy decides access, and an app MUST NOT infer entitlement from a space appearing here.
- **`gatedSpaces[].tiers` is a resolved list, not a rule.** An issuer whose tiers form a ladder (each dearer tier including everything below it) MUST publish the tier that opens the space *and every tier above it*, rather than the floor alone. An app then decides access by plain membership and never has to know the issuer's pricing model. Ours does exactly this: the creator names one minimum tier and the record carries what it resolves to.
- **Model spaces by the kind of content they hold, not by audience.** One `subscribers` space holding everything makes the audience part of the container, duplicating what the policy already says and freezing it: re-gating later means moving records and breaking their URIs. Separate spaces per modality also keep OAuth space scopes meaningful — a client granted `space:<type>` gets that content and not the rest. All of a creator's spaces SHOULD be gated by the same issuer; `gatedSpaces[].tiers` is what varies between them.
- **Tier `id`s are append-only in spirit:** never reuse an id for a materially different offering; retire and add instead. Credentials reference tier ids, and id reuse would silently change what an outstanding credential means.
- **Withdraw by archiving, never by deleting.** A tier or price is removed from sale with `archived`, and retained. Deleting a tier makes every outstanding credential referencing its id uninterpretable; deleting a price silently repriceable. Apps MUST NOT offer an archived tier or price for new purchases, and MUST continue to honour entitlements that reference an archived tier.
- **A tier carries several prices, one per currency and period.** This is what makes a price replaceable without breaking existing subscribers: publish the new price, archive the old, and supporters on the old `lookupKey` keep it. A tier with no unarchived price is not purchasable and SHOULD be hidden rather than shown as unavailable.
- **`kind` tells an app which interface to build** before it knows anything else about the tier — a recurring membership, a one-off tip, a digital good, a physical good the creator must fulfil. Absent means `membership`. An app that cannot fulfil a kind (no shipping flow for `physical`) SHOULD hide that tier rather than sell something it cannot complete.
- **`benefits` is for rendering, never for authorization.** It exists so any app can show a consistent summary without parsing prose. Access is decided by the issuer and the space policy; a benefit label grants nothing.

### 2.1 Renderability — deciding whether an app should offer this at all

An entitlement says *"this account may open that door."* It says nothing about whether the app holding the key can display what is behind it. A photo client selling access to a space of long-form documents produces a supporter who paid for content that client cannot show. The offer record therefore carries the missing half.

**The mechanism is content-type negotiation by lexicon id** — an `Accept` header, for records.

1. The creator declares, per gated space, the record types it contains: `gatedSpaces[].contentTypes`.
2. The app declares the types it can render. Where an issuer knows the app (its `client_id`), the declaration is registered with the issuer; otherwise the app supplies it at query time. Either way it is the app's own statement about itself.
3. **Coverage** = |declared ∩ renderable| / |declared|, computed per space.

Normative:

- An app **SHOULD NOT** present a gated space for purchase at coverage 0. There is nothing it can show.
- At coverage below 1 the app **MUST** disclose it at checkout — what it can show, and what it cannot. It **MAY** name apps that cover the remainder. Partial coverage is a normal and healthy state in an interoperable network; concealing it sells a supporter something they cannot fully use in the app they are standing in.
- `contentTypes` is **advisory and creator-declared.** An app MUST tolerate encountering an unlisted record type in a space it has access to, and MUST NOT treat the list as an access rule. Access is decided by the space policy and the issuer, never by this list.
- An empty or absent `contentTypes` means *unknown*, not *empty*. Apps SHOULD treat it as coverage 1 (offer it) rather than 0, so that omitting the field degrades to today's behaviour.

The disclosure requirement is not only consumer protection. The pointer to *where else this can be read* is the first honest cross-app discovery surface in the design, and it is what the distribution share below pays for.

### 2.2 The distribution share

`appShare` declares **what an app earns from payments to this creator** — the pot set aside for the apps that originated and delivered a sale. It says nothing about *whose money it is*, and deliberately so: that is the issuer's commercial model, not a protocol fact, and two issuers can be interoperable while funding it differently.

**Who funds it is out of scope, but disclosure is not.** An issuer MAY carve the share out of its own take, in which case the creator's price does not move with it and every integrating app earns something by default. An issuer MAY instead have the creator fund it on top, in which case the share **MUST** appear in the all-in cost the creator is shown — a creator paying an issuer 5% and apps 4% pays 9% and must see 9%. What is forbidden either way is presenting a cost the creator bears as though it were free.

**It splits by what the app actually did.**

| Component | Pays for | Rate that applies | Duration |
|---|---|---|---|
| **Origination** | Converting the subscription — a completed past act | The rate in force **at conversion**, fixed for that subscription | `originationWindowMonths`, bounded |
| **Delivery** | Putting the content in front of the supporter, metered over the period | The rate **currently** in force, subject to notice | While the app keeps delivering |

Origination is deliberately **bounded rather than perpetual**. It caps the exposure at `rate × window` at the moment the rate is set, and — because entitlements are portable by design — it stops an app being paid indefinitely for a conversion long after some other app took over serving the content.

Delivery is deliberately **repriceable**, because it pays for an ongoing service the app can equally stop providing. Where the rate can change, an increase MAY take effect at once and **a reduction MUST carry a notice period**, published by the issuer, during which `previousRate` still governs delivery and `effectiveFrom` states when the cut lands. Without that rule an app can build an audience around a creator who is then repriced from under it, and no developer would build on this at all. An issuer whose rate is instance-wide and does not vary per creator simply omits both fields.

**Whatever the rate expresses, it is a posted price and never an auction.** Issuers that let creators set their own MUST publish a permitted band and reject rates outside it. Apps MAY filter by a minimum acceptable rate, but such a filter is a client-side convenience with no protocol meaning: it is not a bid, it does not clear, and no party is matched by the issuer. Two reasons:

- Carrying a creator costs an app almost nothing, so there is no scarce resource on the app side for a price to ration. What is scarce is **placement**, which this rate does not buy and MUST NOT be represented as buying.
- A rate that buys ranking is paid placement, which carries disclosure obligations to both users and business users in several jurisdictions. Apps that let this rate influence ranking **MUST** disclose that they do.

Issuers SHOULD publish a rate rather than leaving the field absent: an app deciding whether to integrate needs to see the number, and where creators can move it the default is what the ecosystem's rate will actually be.

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
- **Attribution is carried by the buyer, never observed by the issuer.** Paying apps for origination and delivery (§2.2) requires knowing which app to credit — and the obvious implementation, logging which app showed what to whom, would build exactly the behavioural surveillance the rest of this design removes. Instead: the credit travels with the supporter and is presented once, at checkout or at an access check. An issuer records *"this subscription is credited to app A"* and **MUST NOT** record, derive, or retain *"supporter S was shown content C in app A."* Delivery is metered from access checks the app already has to make, counted per (supporter, creator, day), never as a view log.
- **A referral is an attestation, not a proof, and that is acceptable here only because the pot is bounded.** An app can attest a referral for a supporter it never showed anything to. Since the share is a fixed proportion of one subscription's revenue, a false claim cannot create money — only shift it between claimants — so the failure mode is misallocation within a bounded pot rather than theft. Implementations MUST keep the pot per-subscription for this reason; a global pool would turn a bounded fairness problem into an unbounded fraud one.

## 9. Security considerations

- **Replay/mis-binding:** prevented by §6.5. The absence of `aud` is safe only because of that rule; implementers MUST NOT treat possession as authentication.
- **Issuer compromise:** creator edits `authorizedIssuers` → network-wide distrust at cache speed (≤ 24h worst case, immediate for re-fetching verifiers). Issuers SHOULD additionally rotate `#payments_attest` on compromise.
- **Malicious/lying issuer:** an issuer can only lie about entitlements *for creators that listed it*. It cannot mint valid credentials for any other creator (§6.4 fails). The blast radius of a rogue issuer is its own customers — who chose it and can leave.
- **Offer-record tampering:** the offer lives in the creator's repo under their repo signing key, with ordinary atproto authenticity guarantees.
- **Token theft:** a stolen credential is honored nowhere without also controlling the subject's session (§6.5); worst case it leaks the fact of one relationship — the same fact any app it was presented to already learned — and dies within 7 days.

## 10. Future work (non-normative)

- **Space contexts (ATProto Spaces — alpha as of 2026-08, full launch targeted later in 2026).** The shipped shape (proposal 0016): a space is identified by `at://{spaceDid}/space/{spaceType}/{skey}` (the literal `space` segment — NOT the earlier `ats://` scheme from the diary posts), read access is gated by DPoP-bound space credentials minted by the space authority, and every PDS must support the `com.atproto.simplespace` management implementation. Planned extensions here:
  - `ctx` gains an optional `space` member carrying the space URI a tier unlocks. (Not yet added to the v0.1 lexicons — 0016 is explicitly subject to change.) The offer side of this landed the other way round, in §2: spaces name their tiers (`gatedSpaces[].tiers`) rather than tiers naming their spaces. A space is the thing with an identity, a name and a description, and it may be opened by several tiers; the tier-side `grants` array would have repeated the space URI once per tier with nowhere to put the name.
  - **The direct integration point already exists: `simplespace`'s `managing-app` policy.** A creator anchors their subscriber space with `policy: managing-app` and `managingApp` = the issuer's service identifier; at every credential mint, the space authority calls `com.atproto.simplespace.checkUserAccess` on the issuer, which answers from its ledger. The 0016 proposal's own example for this policy is "paid-subscription status." This makes the issuer's entitlement check the space's access decision in real time — no member-list synchronization, and instantly accurate on lapse/chargeback (tighter than the ≤7-day credential window). Alternative wiring: `policy: member-list` with the issuer holding a `manage=update` grant to call `addMember`/`removeMember` on payment events — survives issuer downtime at the cost of lag. Which is canonical is an open question (§11).
- **Non-subscription shapes:** one-time purchases (tier `period: "once"`), tips with no entitlement at all (pure ledger events — nothing protocol-visible unless the supporter opts into a badge).

## 11. Interop and open questions (for reconciliation with attested.network)

1. **Record-shape reconciliation — mapped 2026-09-04** against the seven lexicons published at `at://did:plc:cq3w3bw7awp2rkeswfdzoubb/com.atproto.lexicon.schema/network.attested.payment.*` (dated 2026-04-13). The two designs decompose the same problem differently rather than conflicting:

   | Concern | `network.attested.payment.*` | Here | Reconcilable? |
   |---|---|---|---|
   | Which issuers a creator trusts | Ordered broker DID list in the creator's **DID document**, each with an `#AttestedNetwork` service entry | `offer/self` → `authorizedIssuers` (a repo record) | **Yes, and ours is the cheaper edit.** Same semantics, different home; a repo write beats a DID-document operation for a revocation path that must be fast. An issuer MAY publish both |
   | What is on sale, at what price | **Out of scope** by their own Scope section | The offer record (tiers, prices, `kind`, `benefits`, `gatedSpaces`) | **No conflict** — this fills a hole they marked deliberately |
   | The payment fact | `oneTime` / `recurring` / `scheduled` record in the **payer's repo**, `signatures[]` → `strongRef` to proof records | Not on protocol at all; the ledger stays with the issuer | **No.** This is the one structural incompatibility (§8). We cannot be fully attested-compliant by construction |
   | Attestation by a third party | `payment.proof` in the attestor's repo: `cid` + optional free-string `status` | Entitlement credential (§3), private, never in a repo | Different mechanism, same job |
   | Public claim of support | The payment record itself, carrying payer, recipient, amount and currency | `badge` + `voucher` (§4): creator DID and a display tier name, no amounts | **Yes, one-way.** An attested payment record can be reduced to a badge; a badge cannot be expanded back into one, by design |
   | Revocation | Broker deletes or updates its `proof` record | Credential expiry ≤7 days + issuer stops reissuing (§3.3) | Both are "absence is revocation" |
   | Subscription expiry | **Absent from the schema.** `recurring` has no end-date field; `proof` schemas only `cid` and `status` | `exp` ≤ min(iat+7d, end of paid period), normative | Ours is strictly more specified |
   | Third-party queries | `payment.lookup` takes required `payer` + `recipient` DIDs and **declares no auth** | `checkEntitlement` behind the standing rule (§5.2) | **No.** An unauthenticated `lookup` is the surveillance API §5.2 exists to prevent |

   Two defects worth reporting upstream regardless of whether the specs converge: their prose describes `signatures[]` as accepting *"inline or `com.atproto.repo.strongRef`"* entries while the published schema permits `strongRef` only; and the `validUntil` field offered in the forum as the answer to subscription expiry does not exist in `payment.proof`.

   Remaining question: adopt their vocabulary (**broker**, **payment servicer**, **recipient**, **supporter**) in place of ours (**issuer**, **creator**, **supporter**)? Theirs is inconsistent within their own documents — a critique already raised in the forum — but it has priority, and conceding vocabulary is cheap where we are not conceding structure.
2. Final namespace and steward (Eurosky offered as neutral home) — blocks nothing in this draft.
3. Payments OAuth scope naming — should align with whatever permission-set conventions the atproto OAuth work lands on.
4. Voucher semantics: is "verified at issue time, no expiry" acceptable to Graze's badge UX, or do they want renewable vouchers?
5. `checkEntitlement` standing (b): is offer-record `authorizedServices` enough, or is a delegation chain (creator → service → sub-service) needed for real deployments?
6. Should the entitlement credential adopt DPoP binding (`cnf.jkt`, per RFC 9449) like 0016's space credentials, instead of or in addition to the subject-binding rule (§6.5)? DPoP binding makes cards per-app (each app obtains its own via `getCredentials` with its own key) — stronger against replay, still DID-portable through re-issuance, at the cost of client complexity.
7. Issuer-handoff mechanics to standardize: departing-issuer obligations (answer window for paid periods), successor card-honoring grace windows, and whether a member-list snapshot on switch should be specified for `member-list`-wired spaces.
8. Gated-space wiring: is `managing-app`/`checkUserAccess` (real-time, issuer-availability-dependent) or `member-list` + issuer `manage` grants (laggy, availability-independent) the canonical integration? And should the space authority be the creator's DID or a dedicated DID (0016 supports both; a dedicated DID makes the subscriber space transferable independent of the creator's account)?
9. Distribution share, still open: how an app's renderable-type declaration is authenticated (registered with the issuer, published in the app's own repo, or asserted per query — the first is what we implement, the second is the interoperable version); whether the referral attestation should be specified here or left to issuers; and whether `originationWindowMonths` and the reduction notice period belong in the spec as defaults or stay issuer policy. Our current position is issuer policy with published values, because they are commercial terms rather than protocol facts.
10. Issuer discovery from the supporter side: an app resolves *creator → issuers* from the offer record, but nothing defines how it learns *which of those issuers the supporter actually holds an account with*. Absent a rule, a client walks the creator's `authorizedIssuers` and attempts `getCredentials` at each — correct and leak-free (an issuer the supporter has no session with simply cannot be called, and one where she has no entitlement returns an empty list), but it costs an OAuth grant per issuer and O(issuers) round-trips. Options: leave it to clients; a client-local registry of issuers the user has already authorized (probably sufficient in practice); or a supporter-side hint record — which reintroduces a public who-pays-whom signal and should be rejected on §8 grounds.
