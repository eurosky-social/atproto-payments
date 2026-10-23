# @atproto-payments/pilot — the Spaces-alpha demo

**What it proves:** on real ATProto protocol primitives (the spaces-alpha snapshot), a payment issuer can be the access decision for gated content. A creator's subscriber space is configured with `policy: managing-app` pointing at [the mock issuer](../mock-issuer/); the PDS calls the issuer's `checkUserAccess` at every credential mint; the issuer answers from its ledger. Pay → the space opens in any app. Lapse → it closes. No member lists, no sync, nothing published.

```
pnpm start
```

runs the whole story in ~15 seconds, locally, no external services:

1. Boots a local PLC + spaces-enabled PDS (`@atproto/dev-env@alpha`, in-process).
2. Registers the issuer on the local PLC — a `did:plc` with a `#payments_issuer` service entry pointing at the mock issuer, and a `#payments_attest` verification method (the same identity shape a production issuer would publish).
3. Ben creates `at://…/space/network.eurosky.payments.subscribers/self` with `managingAppPolicy` → the issuer, and writes a subscriber-only post into it.
4. Anna requests access (delegation token → a space credential bound to a key only she holds): **denied** — the PDS called `checkUserAccess`, the ledger said no (`UserNotAuthorized`).
5. A fake tip settles on the issuer's admin API.
6. Anna requests again: **credential minted**; she reads Ben's gated post with it, signing the request with her key.
7. Anna lapses: the next mint is **denied again**. Billing truth is access truth.

Revocation semantics worth noticing: outstanding space credentials live 600 seconds by default and an hour at most (0016's design since the alpha's 2026-10-01 release), so revocation happens at the mint boundary — structurally identical to our ≤7-day entitlement cards with silent renewal ([SPEC.md](../spec/SPEC.md) §3.3). The two layers were designed independently and landed on the same shape, which is a good sign for both.

## Scripts (PDS-agnostic: local dev-env or the hosted alpha)

- `pnpm create-account` / `pnpm setup-space` / `pnpm read-space` — the same
  flow against any spaces PDS (env `PDS_URL`, credentials, `MANAGING_APP`),
  such as Bluesky's hosted spaces alpha, with your own issuer as the managing
  app.

## Alpha caveats

Everything here rides the `0.0.0-spaces-alpha-*` npm snapshots: no security review, breaking changes promised, `workspace:*` publishing quirks (see the `overrides` in [pnpm-workspace.yaml](../pnpm-workspace.yaml) — same fix as the official bulletin sample). Demo only. Never real money, never sensitive data, and expect this package to need updates as the alpha moves. The vendored lexicon snapshots in [lexicons-0016/](lexicons-0016/) track the current alpha shapes (source: `bluesky-social/atproto` branch `permissioned-data`, MIT/Apache dual license), refreshed 2026-10-23 alongside the bump to the `20261022141228` snapshot (upstream `d8632eec8e`) — the release that replaced DPoP with a key the client names in the request body and a signature on every read, and renamed a space's `type` to `spaceType`.

**Bumping the snapshot, when the next one lands.** Change the four pins in [package.json](package.json) *and* the `@atproto/lex*` overrides in [../pnpm-workspace.yaml](../pnpm-workspace.yaml) to the same version string. Two traps, both of which cost an afternoon on 2026-09-11: the lex family **grows**, and `pnpm install` fails on the first new member left out of the overrides (it names it — add it); and those overrides must be the **exact version, never the `alpha` tag**, because a floating tag re-resolves only for packages with no lock entry, leaving the already-locked ones behind and building a tree where `@atproto/pds` imports a `@atproto/lex` that no longer exports what it asks for. `pnpm start` catches both — it dies at startup rather than mid-demo.
