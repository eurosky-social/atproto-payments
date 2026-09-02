# Payment Attestations — Explainer

*The plain-language companion to [SPEC.md](SPEC.md). Part A walks through the design with a worked example; Part A2 explains how it folds into ATProto Spaces. Normative rules live in the spec — this document exists so the design can be argued about without reading JSON.*

---

## Part A — The design, in plain language

Two people throughout: **Anna**, a fan, and **Ben**, a photographer she supports with €5/month. The JSON below is illustrative but shape-accurate: it validates against the four lexicons in [lexicons/](lexicons/) and matches the interop vectors in [attest-core/vectors/](../attest-core/vectors/). DIDs are written to be readable rather than realistic.

Cast, for the examples:

| Who | DID |
|---|---|
| Anna (supporter) | `did:plc:annaexamplesupporter7fq2` |
| Ben (creator) | `did:plc:benexamplecreatorxyz4kq2` |
| The issuer (any payment service) | `did:web:pay.example.com` |
| Graze (issuer) | `did:web:attested.network` |
| Ben's paid feed generator (service) | `did:web:feeds.benphoto.example` |

### Why attestations exist at all

On ATProto, every user has a **repo** — a public filing cabinet that belongs to them, hosted on their PDS, readable by anyone in the world (the firehose streams every change to anyone listening). Posts, likes, follows: all records in that cabinet. That's what makes the network open — any app can read any cabinet, so users can switch apps and their world comes with them.

Payments happen entirely outside the protocol. So today, when Anna subscribes to Ben inside some app, the only place that knows is *that app's private database*. If Anna opens a different ATProto app tomorrow — same identity, same DID — it has no idea she's a paying supporter. Her subscription is trapped in one company's database: exactly the walled-garden problem ATProto exists to solve.

An **attestation** is the fix: a durable, checkable statement — "this person really is a paying supporter of that person" — that lives *with Anna's identity* instead of inside one app's database, so every app can honor it.

### How the current proof-of-concept (Graze's attested.network) does it

When Anna pays, the payment service writes a record **into Anna's public repo** — a sticker in her filing cabinet: "Anna supports Ben, Gold tier, since March." Any app can read the sticker and act on it: unlock Ben's subscriber feed, show a supporter badge. Portable, no gatekeeper database. Graze frames the publicness as the point — "a badge of authentic fandom," like a Twitch sub badge.

The problem: the sticker isn't just visible to people viewing Anna's profile. Everything in every repo streams through the firehose, machine-readable, at scale, effectively forever. With this as the *default*, anyone — a data broker, an ex, a hostile government — can cheaply compile the complete list of Ben's supporters (and estimate his income), and the complete list of everyone Anna pays, which reveals her interests, politics, orientation, health concerns. A public surveillance dataset of financial relationships, as a side effect. Fine as an *option* for people who want the Twitch-badge feeling; disastrous as the only mode — and GDPR won't permit publishing transaction parties by default for an EU provider anyway.

### The key insight: proving something ≠ publishing it

Think of a concert ticket: you prove to the doorman that you paid, without the venue printing the guest list on a billboard. The design restructures the attestation around that idea — **three pieces, each with exactly the visibility its job requires**:

### Piece 1 — the price list (public, in Ben's repo)

Ben publishes what he offers: "Gold, €5/month, gets you my subscriber feed." A shop window is supposed to be public. It carries one extra line that is the interop magic: **"I accept payments through: [issuer A], [issuer B]"** — payment providers Ben trusts, by DID. This tells every app whose word to accept about Ben's supporters, and is what lets the standard work with many providers at once: a supporter who paid through one issuer and one who paid through another are indistinguishable to apps. One standard, any rails.

One record, at a fixed address — `at://did:plc:benexamplecreatorxyz4kq2/network.eurosky.payments.offer/self`:

```json
{
  "$type": "network.eurosky.payments.offer",
  "tiers": [
    {
      "id": "supporter",
      "name": "Supporter",
      "description": "My thanks, and a supporter badge you can show off.",
      "price": { "value": 200, "currency": "EUR", "period": "month" }
    },
    {
      "id": "gold",
      "name": "Gold",
      "description": "Everything in Supporter, plus my subscriber-only photo feed.",
      "price": { "value": 500, "currency": "EUR", "period": "month" }
    }
  ],
  "authorizedIssuers": [
    "did:web:pay.example.com",
    "did:web:attested.network"
  ],
  "authorizedServices": [
    "did:web:feeds.benphoto.example"
  ],
  "createdAt": "2026-03-01T10:00:00.000Z"
}
```

Three things to notice. `authorizedIssuers` is the root of trust — a card signed by anyone not on this list is rejected no matter how valid the signature, so Ben drops a rogue provider by editing one line. `authorizedServices` is narrower: it grants *permission to ask* (Piece 2's second path), nothing else. And `price` is a shop-window number, not a quote — billing truth lives at the issuer's checkout, which is why `value` is in minor units and nothing here is authoritative.

### Piece 2 — the membership card (private; does the real work)

When Anna's payment settles, the service issues a digitally signed credential: *"Anna's DID holds Gold with Ben, valid until September 1. — signed, the issuer."* No amount, no invoice — only the fact apps need. It is held **by Anna's client** — stored wherever that app already keeps her OAuth tokens (Keychain, Android Keystore, browser storage) — and **never written to her public repo**. Nothing new is needed at the protocol level: every ATProto client already has this drawer, because it already holds an OAuth session. Nobody can discover the card exists.

The card is a compact JWS — the same token family ATProto already uses for inter-service auth — so it is one opaque string on the wire:

```
eyJ0eXAiOiJlbnQrand0IiwiYWxnIjoiRVMyNTZLIiwia2lkIjoi…  ←  header
.eyJpc3MiOiJkaWQ6d2ViOnBheS5za3lwYXkuZXUiLCJzdWIiOiJk…  ←  claims
.UngOmHZICyvWOa-JFUwF4dpMYd5MYd_vkEESnpRKd78Yk-ydPVIC…  ←  signature
```

Decoded, that is all there is to it:

```json
{
  "typ": "ent+jwt",
  "alg": "ES256K",
  "kid": "did:web:pay.example.com#payments_attest"
}
```
```json
{
  "iss": "did:web:pay.example.com",
  "sub": "did:plc:annaexamplesupporter7fq2",
  "ctx": {
    "creator": "did:plc:benexamplecreatorxyz4kq2",
    "tier": "gold"
  },
  "iat": 1788167642,
  "exp": 1788220800,
  "jti": "01K4C7Q2M9V3XN0T5R8W6ZBHDA"
}
```

Read it as a sentence: the *issuer* says *subject* Anna holds *context* Gold-with-Ben, from `iat` until `exp` (here: the end of the paid period, 2026-09-01 — capped at seven days regardless). Note what is **absent**: no amount, no invoice, no processor reference, and deliberately no `aud`, because the card is presented to arbitrary apps. `exp` is also the entire revocation story — on cancellation or chargeback the issuer simply stops reissuing, and the card ages out within days. No revocation lists exist.

Anna's client keeps cards fresh by asking the issuer for them — the only caller allowed is Anna herself, via her OAuth session:

```jsonc
// GET /xrpc/network.eurosky.payments.getCredentials?creator=did:plc:benexamplecreatorxyz4kq2
// Authorization: Bearer <Anna's OAuth access token, payments scope>
{
  "credentials": [
    {
      "token": "eyJ0eXAiOiJlbnQrand0IiwiYWxnIjoiRVMyNTZLIiwia2lkIjoi…",
      "creator": "did:plc:benexamplecreatorxyz4kq2",
      "tier": "gold",
      "expiresAt": "2026-09-01T00:00:00.000Z"
    }
  ]
}
```

There are two ways the card turns into access:

- *Anna shows the card.* An app wants to know if she can see Ben's subscriber feed; her client presents the credential. The app checks the signature — every DID, including the service's, has published public keys, so signatures verify offline — and checks the issuer is on Ben's accepted-providers list. No server call at verification time, nothing published. (Presenting the card to an app reveals the relationship *to that app* — consent by use.) The one rule implementers must not skip: the card is a *statement about* `sub`, not a password — an app honors it only for its logged-in account, so a stolen card is worthless.

- *A server asks the issuer.* Ben's paid feed generator queries the service's API: "does Anna's DID currently hold Gold with Ben?" — yes/no. Iron rule: **the endpoint answers only parties with standing** — Anna herself (via OAuth-granted permission) or Ben's own services (the ones listed in `authorizedServices` above, authenticating with ATProto inter-service auth). A random third party cannot ask "what does Anna subscribe to?" Without this rule, the public surveillance dataset would be deleted from the repos and rebuilt as an API.

```jsonc
// GET /xrpc/network.eurosky.payments.checkEntitlement
//     ?subject=did:plc:annaexamplesupporter7fq2
//     &creator=did:plc:benexamplecreatorxyz4kq2
//     &tier=gold
// Authorization: Bearer <inter-service auth JWT, iss=did:web:feeds.benphoto.example,
//                        lxm=network.eurosky.payments.checkEntitlement>
{
  "active": true,
  "tier": "gold",
  "expiresAt": "2026-09-01T00:00:00.000Z"
}
```

Ask without standing and you learn nothing at all — not even whether Anna or Ben exist:

```json
{
  "error": "NoStanding",
  "message": "The caller is neither the subject nor a service designated by the creator."
}
```

That answer is deliberately uniform across "no entitlement", "no such creator" and "no such account", so the endpoint can never be walked as an enumeration oracle.

#### What "portable" means here (and what it doesn't)

The card lives in one app's storage, so a second app does not inherit Anna's copy. That is intended, and it is worth being precise about what travels:

**The entitlement is portable. The token is not.** The card is a short-lived materialization of a fact that lives in the issuer's ledger, keyed to Anna's DID. Any app Anna authorizes mints its own:

```
App A  ──OAuth as Anna──▶  issuer getCredentials ──▶  card (exp ≤ 7d)   held by App A
App B  ──OAuth as Anna──▶  issuer getCredentials ──▶  card (exp ≤ 7d)   held by App B
                                    ▲
                       one ledger row, keyed by Anna's DID
```

Both cards say the same thing because both come from the same row. Nothing app-specific is baked into what the card *asserts* — that is what "binds to her DID, not an app account" actually means.

**There is no point making the storage portable.** `exp ≤ 7 days` is the revocation mechanism (§3.3), so every app needs a live mint path regardless; a card copied from another app would go stale within the week and have to be re-fetched anyway. Storage is a cache. This is why the spec treats per-app cards as the *stronger* option rather than a limitation — see SPEC.md §11 Q6 on DPoP binding, which would make per-app cards explicit and replay-proof.

**The cost, stated honestly:** one OAuth grant per app, at the issuer — Anna authorizes a new app against the issuer once, the same consent step she already performs against her PDS, and renewal is silent afterwards. Two things keep that cost small:

- **Server-side gating skips it entirely.** Ben's feed generator uses `checkEntitlement` with its own service auth; Anna's client is never in the loop, so a brand-new app shows her Ben's paid feed with no setup at all. Most gated content works this way.
- **Spaces skips it too.** The doorman asks the issuer at key-mint time (Part A2); no card appears in that flow.

So the per-app grant is really only the price of *offline, client-side* perks — badges, in-app unlocks — which are the low-stakes cases. One loose end: an app can resolve *creator → issuers* from the offer record, but there is no defined way to discover *which issuers a supporter holds sessions with*; in practice an app tries the creator's `authorizedIssuers` and sees which answers (SPEC.md §11 Q8).

### Piece 3 — the fan badge (public, strictly opt-in)

If Anna *wants* the world to know — the band-t-shirt feeling — she taps "show my support publicly," and only then does a small record go into her public repo: "Anna supports Ben, Gold, since March." No amounts, no purchase details. Decorative and separable: deleting it never touches the membership. Because the card is the proof, the badge needs no trust — but it MAY carry an optional issuer countersignature (a "public voucher" Anna explicitly requested) so apps can display it as *verified* without querying anyone.

In Anna's repo, at `at://did:plc:annaexamplesupporter7fq2/network.eurosky.payments.badge/3lqf2xk7abc2s`:

```json
{
  "$type": "network.eurosky.payments.badge",
  "subject": "did:plc:benexamplecreatorxyz4kq2",
  "tierName": "Gold",
  "since": "2026-03-14T00:00:00.000Z",
  "voucher": "eyJ0eXAiOiJlbnR2Y2grand0IiwiYWxnIjoiRVMyNTZLIiwia2lkIjoi…",
  "createdAt": "2026-03-14T09:22:11.000Z"
}
```

`tierName` is a display string, never a tier id — nothing here can be joined back to billing. The voucher, decoded, is the smallest possible countersignature:

```json
{
  "iss": "did:web:pay.example.com",
  "sub": "did:plc:annaexamplesupporter7fq2",
  "crt": "did:plc:benexamplecreatorxyz4kq2",
  "tn": "Gold",
  "iat": 1773480131
}
```

It has no `exp` on purpose: it attests that the relationship existed when it was issued ("verified supporter since March"), not that it still holds. A badge *without* a voucher is perfectly valid — apps just display it as self-asserted rather than verified.

| Piece | Lives where | Who sees it | Contains |
|---|---|---|---|
| Price list | Ben's public repo | Everyone (shop window) | Tiers, prices, accepted payment providers |
| Membership card | Anna's client (private storage, per app) | Only apps Anna shows it to, or servers with standing | Anna's DID, tier, validity — nothing else |
| Fan badge | Anna's public repo, **opt-in only** | Everyone | Supported creator, tier name, since-date; optional issuer countersignature |

Amounts, receipts, and payment history never appear on the protocol — they stay in the service's private ledger (which must exist anyway for accounting, AML, chargebacks).

**Net change vs. the current PoC:** the public record stops being the mechanism and becomes an optional accessory. Verification runs on the private card and the standing-only API; publicness becomes a choice, not a side effect of paying. Portability fully survives — it comes from binding to the DID, never from being public.

**Forward-compatibility — now concrete:** ATProto Spaces shipped as an alpha in August 2026 (full launch targeted later in 2026). "Ben's subscriber feed" becomes a private space, and the wiring point already exists in the mandatory `simplespace` management layer: Ben sets his space's policy to `managing-app` with the payment service as managing app, and every time any app asks for access, the space authority asks the service "is this user a paying subscriber?" (`checkUserAccess` — the proposal's own example for this policy is literally "paid-subscription status"). The membership card becomes the billing-side proof behind those answers. Entitlements are **space-shaped** from day one: an entitlement names a *context*, so the transition is a mapping, not a rebuild — today's `ctx` grows one member and nothing else changes:

```jsonc
// today
"ctx": { "creator": "did:plc:benexamplecreatorxyz4kq2", "tier": "gold" }

// later, once spaces land (the tier's offer record gains a matching "grants" array)
"ctx": {
  "creator": "did:plc:benexamplecreatorxyz4kq2",
  "tier": "gold",
  "space": "at://did:plc:benexamplecreatorxyz4kq2/space/publication/subscribers"
}
```

See SPEC.md §10/§11 for details and open questions. Part A2 below explains spaces and the fold-in in plain language.

---

## Part A2 — Spaces, and how the payment layer folds in (plain language)

Same two people: Anna the fan, Ben the photographer.

### What a space is

Everyone on ATProto has a public filing cabinet, and every document in it is world-readable. A **space** is the protocol's answer to "what about things that *shouldn't* be public?" — think of it as a **members-only room**.

Three things define a room: **who runs it** (the "space authority" — just an account/DID; it can be Ben himself, or a dedicated identity created for the room, which usefully lets the room change hands later without being welded to Ben's personal account); **what kind of room it is** (a type, like "forum" or "subscriber publication"); and **a name tag** (so one authority can run several rooms of the same kind).

The clever part, and it's very ATProto: **the room doesn't physically exist in one place.** When Anna and other members post into Ben's room, each person's contributions are stored in a *locked drawer of their own filing cabinet* — on their own PDS, under their own control. The "room" is what an app sees when it collects all those drawers and assembles them into one view. Same architecture as public ATProto (everyone owns their data, apps assemble views), just with locks on the drawers.

**Getting in works like a doorman system.** To read a room, an app needs a **room key** — a time-limited pass (about two hours, then it renews) issued by the room's authority. The sequence: Anna's app asks her PDS for a short-lived note saying "this app genuinely acts for Anna," takes that note to the room's doorman, and the doorman decides whether Anna gets a key. Each key is stamped to the specific app holding it — it can't be lent out or replayed (the same cryptographic binding ATProto's OAuth already uses).

Two honest limitations. First, this is **access control, not secrecy**: the servers involved can read the data they handle — deliberately, because search, notifications, and moderation need it. A closed drawer, not an encrypted safe. Second, there's no firehose for spaces: private data is never broadcast; apps fetch it directly from members' cabinets. (That's why the privacy analysis in Part A mattered — the *public* firehose is exactly where payment data must never appear.)

**The crucial question — how does the doorman decide who gets in?** Three modes: let everyone in ("public"), keep a guest list the authority maintains ("member list"), or — the interesting one — **"ask an app"** (`managing-app`): the doorman phones a designated service every single time and asks "should this person get in?"

### Where the payment layer folds in

Ben's subscriber-only photo feed lives in a space. So the doorman's question — *"should Anna get in?"* — is really *"is Anna paying Ben?"*. And exactly one party in the ecosystem knows the true, current answer: the payment service's ledger.

**The elegant wiring:** Ben sets his room's policy to "ask my issuer." Every time any app requests a room key for anyone, the doorman calls that issuer (`checkUserAccess`), the issuer looks at its ledger, and answers yes or no. That's the whole integration. Anna subscribes → next key request, yes. She cancels or a chargeback lands → next key request, no — within hours, automatically, with no lists to keep in sync anywhere. Billing truth and access truth become the same thing. And this isn't bending the protocol: Bluesky's own spec gives "paid-subscription status" as its example of what this mode is *for*. They built the room and the doorman; the doorman just has no connection to actual money. This spec is that connection.

**The backup wiring:** guest-list mode, where Ben grants the issuer permission to add and remove names as payments settle and lapse. Slower to react, but the list keeps working even if the issuer is briefly unreachable. Which mode the standard should recommend is an open question (SPEC.md §11 Q7).

**And the membership card from Part A?** It stays, with two jobs. Outside the spaces world it remains the portable proof it always was — for paid feeds, in-app perks, and every app or creator that doesn't use spaces (spaces are in alpha; the card works today). Inside the spaces world it becomes the billing-side receipt behind those yes/no answers. Amounts, invoices, and payment history still never touch the protocol in either world.

End to end: Anna taps "support Ben — €5/month" in whatever app she likes; an issuer moves the money; its ledger flips to *active*; from that moment she holds a membership card any app can verify, and every door to Ben's subscriber room opens for her — in *every* ATProto app, because the room, the key, and the payment are all bound to her identity, not to the app she happened to pay in. That is what this design is for, and it is not something a per-app payment integration can offer.

