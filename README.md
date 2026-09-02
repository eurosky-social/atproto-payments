# Payment attestations for ATProto

**Can an app check that an account holds a paid tier with a creator, without anyone publishing who pays whom?**

This is a draft specification and reference code for that. It is deliberately small: two artifacts and one query, enough for two independent payment services to be interchangeable to an app.

Status: **draft v0.1**, seeking feedback and reconciliation with [attested.network](https://attested.network/) — this is not a competing proposal, it is the same problem with a different default about what becomes public.

## The problem

Repos are public and the firehose is enumerable, so representing "Anna supports Ben" as a record in Anna's repo also publishes the payment graph: a spending history for every supporter and a revenue estimate for every creator. That matters most for exactly the creators who most need paid support. It is also difficult to reconcile with data-minimisation obligations for anyone operating a payment service in the EU.

Verifiability does not require publicity. This spec keeps the graph out of the network and still lets any app verify entitlements from any issuer.

## What is here

| | |
|---|---|
| [`spec/`](spec/) | The normative draft ([SPEC.md](spec/SPEC.md)) and four lexicons. [EXPLAINER.md](spec/EXPLAINER.md) is the same design in plain language, with a worked example |
| [`attest-core/`](attest-core/) | TypeScript verifier and credential library, transport-free — DID resolution and record fetching are injected. Ships the interop test vectors |
| [`mock-issuer/`](mock-issuer/) | A fake issuer: everything a real one has except money. A ledger you flip by hand, the `checkEntitlement` query with the standing rules, and the `com.atproto.simplespace.checkUserAccess` socket |
| [`pilot/`](pilot/) | The whole story end to end in ~15 seconds against a local spaces-alpha PDS: denied → paid → space credential minted → gated post read → lapsed → denied |

```
cd pilot && pnpm start
```

## The interoperability surface

Only two things have to be agreed for independent implementations to work together:

1. **The offer record** — public, in the creator's repo: tiers, and `authorizedIssuers`. That list is the root of trust. A credential or answer from an issuer the creator has not listed is rejected however valid its signature, and a creator revokes a rogue issuer by editing one record, with no cooperation from that issuer. It is also what makes the standard multi-provider rather than a spec for one company's service.
2. **One query** — "does this account hold this tier with this creator?", with a standing rule: only the subject themselves, or a service the creator designated, gets an answer. Everyone else gets an identical *no standing* error. Without that rule the query endpoint rebuilds, as an API, the public dataset this design removes from the repos.

Everything else in here is optional, including the short-lived credential that allows offline verification. It is implemented because we needed it; it is offered as a profile, not a requirement.

## Namespace and stewardship

`network.eurosky.payments.*` is a placeholder. The final namespace and its steward are open questions — see SPEC §11. The intent is that this lives somewhere neutral rather than under any company; Eurosky can host it, and that is an offer rather than a claim.

## Open questions

SPEC §11 lists them. The ones that matter most: whether attested.network's existing records can map onto the badge shape so the two become one standard, and how paid access to ATProto Spaces should be wired.

## Licence

Apache-2.0.
