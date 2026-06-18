# Milestone 10 — DNS-AID interop (discoverable + provably bounded agents)

> **Goal.** Make an auths-bounded agent **discoverable via DNS-AID** and, on discovery, let any
> relying party fetch + **verify its bounded delegation offline** — so DNS-AID answers *"where is
> the agent"* and auths answers *"what is it allowed to do, on whose behalf, and prove it."*
> **Strategy.** `LAND-1/2/3` from `strategy.md` §6. Ride the distribution of an IETF draft
> Deutsche Telekom + Amazon are co-authoring; supply the trust signal the draft **explicitly
> disclaims**. We attach to the discovery layer and own everything below it.
> **Status today.** Nothing built. This is a one-page interop spec + a thin publisher/resolver;
> the verification it relies on (`auths_verifier`) already exists.

## Why
DNS-AID (`draft-mozleywilliams-dnsop-dnsaid-02`, May 2026) is becoming the agent **discovery**
substrate, and it is **normatively asking for us**:

> *"Consumers MUST treat the records … as a verifiable transport for metadata, **not as a trust
> signal in their own right.**"*
> *"trust judgments MUST be made **out of band** by combining DNS-AID records with reputation,
> **attestation**, or organizational policy systems."*

The draft reserves the exact fields an out-of-band attestation would use (`cap`, `cap-sha256`,
`policy`, `realm`) and leaves `policy` **semantically undefined** (§5.6, "open questions"). This
milestone fills that socket with a verifiable bounded-delegation credential.

## The security property that makes this worth doing
DNSSEC proves *"acme.example published this record."* It does **not** prove the agent's authority.
Because the authority claim is verified against the **self-certifying auths chain** (not the
domain), a hostile domain operator or a DNS compromise **degrades to discovery-spoofing — it
cannot forge authority.** Worst case: you're pointed at a *different* AID/policy; you can never be
fooled into accepting a *fake* delegation, because a forged `policy` bundle fails
`verify_commit_against_kel_scoped`. **DNS gets you there; auths tells you it's real.** This is the
single most important sentence in the pitch for sitting under DNS-AID.

## Baseline — what already exists
- **The identity + proof:** an agent's self-certifying AID (`did:keri:E…`) and the signed
  delegation chain root→agent (`auths-mcp-gateway/src/chain.rs`), verifiable offline via
  `auths_verifier::verify_commit_against_kel_scoped` (the SAME verifier the gate uses).
- **The bounds:** scope (`Capability` ⊆ parent), budget (`CrossRailBudget` cap), TTL, revocation
  (KEL `DeviceRevoked`/`SignedAfterRevocation`) — all already enforced + tested.
- **Missing:** (a) a DNS-AID **record publisher**, (b) the **`policy` bundle schema** + a resolver
  that verifies it, (c) a relying-party **`verify-by-discovery`** path.

## Where the work lands
| Epic | Repo | Path |
|---|---|---|
| 10.1 DNS-AID record publisher | `auths-mcp` | `examples/dns-aid/` (new) + a `auths-mcp` CLI verb |
| 10.2 `policy` bundle schema + resolver/verifier | `auths` | `crates/auths-verifier` (schema + verify), reuse `verify_commit_against_kel_scoped` |
| 10.3 Companion-draft sketch (own the empty slot) | `auths-mcp` | `docs/standards/dns-aid-bounded-delegation.md` (new) |

## The field map — which DNS-AID field carries what
The one-pager. An auths-bounded agent's SVCB record at the DNS-AID naming pattern
`_<agent>._<proto>._agents.<domain>`:

| DNS-AID field (draft-02) | Draft's stated meaning | What auths puts in it |
|---|---|---|
| `alpn` | transport + agent protocol | `"mcp,h2"` (the wrapped protocol) — unchanged, DNS-AID's |
| `well-known` | RFC 8615 path to the agent card | `"agent-card.json"` — unchanged |
| **`cap`** | "capability descriptor locator … (URN/JSON-Ref)" | the agent's **AID** as a URN, **`did:keri:E<agent>`** (inline, self-certifying — no fetch needed to know *who*) |
| **`cap-sha256`** | integrity digest — *"not a trust signal"* | SHA-256 of the resolved **`policy` bundle** (pins the bounded-delegation credential's bytes) |
| **`policy`** | "URI of a policy bundle" — **semantics undefined** | URL of the **auths bounded-delegation credential** (the §"policy bundle schema" below) |
| **`realm`** | "opaque … authz realm selection" | the **delegator/principal root AID** `did:keri:E<root>` — *on whose behalf* |

Everything the relying party needs is now reachable from the record: *who* (`cap`=agent AID),
*on whose behalf* (`realm`=root AID), *what bounds* (`policy`→the credential), *integrity*
(`cap-sha256`).

## Grounded sketch

**The published record (10.1):**
```
_treasury-bot._mcp._agents.acme.example. 3600 IN SVCB 1 gw.acme.example. (
    alpn="mcp,h2" port=443 well-known="agent-card.json"
    cap="did:keri:EAgent0b3…"                                   ; the agent AID (who)
    realm="did:keri:ERoot9f1…"                                  ; the delegator root (on whose behalf)
    policy="https://acme.example/.well-known/auths/EAgent0b3….json"   ; the bounded-delegation credential
    cap-sha256="kx9…"                                           ; SHA-256 of that policy bundle
)
```

**The `policy` bundle schema (10.2)** — the slot the draft left empty (served at the `policy` URL,
`application/json`; pure data, offline-verifiable, no auths server needed):
```jsonc
{
  "v": "auths-bounded-delegation/1",
  "agent":     "did:keri:EAgent0b3…",      // == record `cap`
  "delegator": "did:keri:ERoot9f1…",       // == record `realm`
  "bounds": { "scope": ["fs.read","github.comment"], "budget_cents": 500, "ttl": "PT30M" },
  "proof":  { "agent_kel": [...], "delegator_kel": [...], "signed_commit": "…", "pinned_roots": ["did:keri:ERoot9f1…"] }
}
```

**The relying-party check (10.2)** — *zero trust in DNS or the operator for the authority claim:*
```rust
// 1. DNS-AID discovery returns the record; verify cap-sha256 matches the fetched bundle bytes
//    (the draft's MUST). 2. Then the ONLY thing that grants trust:
let v = auths_verifier::verify_commit_against_kel_scoped(
    &bundle.proof.signed_commit, &bundle.proof.agent_kel, &bundle.proof.delegator_kel,
    &bundle.proof.pinned_roots, provider, now).await;
require(v.is_valid(),               NotAuthentic);              // forged/revoked/expired → reject
require(bundle.agent == record.cap && bundle.delegator == record.realm, RecordMismatch);
require(scope_subset(&bundle.bounds.scope, &v.granted_scope()), BoundsExceedDelegation);
// → now: "EAgent0b3 was delegated {fs.read, github.comment}, $5, 30m by ERoot9f1 — verified offline."
```

## Rigor — don't be sloppy
- **DRY — one verifier, again.** The discovery path calls the **exact** `verify_commit_against_kel_scoped`
  the gate (M-gate) and the offline audit (M2) call. No second verification path — ever.
- **DNS carries pointers, not credentials.** `cap`/`realm` are identifiers, `policy` is a URL; the
  actual proof is fetched + verified out of band. Do NOT stuff a KEL into a TXT record (size, churn,
  and it would tempt someone to "trust the record" — which the draft forbids).
- **`cap-sha256` is mandatory and load-bearing.** It pins the bundle bytes; a mismatch MUST refuse
  (draft §, our resolver too). It is integrity, not trust — trust comes only from the signature check.
- **Type-driven verdicts.** The resolver returns `DiscoveryVerdict::{ Verified{agent,delegator,bounds} |
  NotAuthentic | RecordMismatch | BoundsExceedDelegation | DigestMismatch | Revoked }` — never a bool.
- **Trust boundary stated in code + docs.** DNSSEC ⇒ "the domain published this"; auths ⇒ "the
  authority is real." Never collapse the two. A compromised domain spoofs *discovery*, never *authority*.

## Done-when (acceptance)
- [ ] `auths-mcp` can **emit** a DNS-AID SVCB record (+ the `policy` bundle JSON) for a wrapped agent.
- [ ] A relying party, given only the record + the fetched bundle, **verifies the bounded delegation
      offline** (no auths server, no operator cooperation) and gets a typed `DiscoveryVerdict`.
- [ ] **Tamper beats fail closed:** a forged `policy` bundle (wrong proof), a swapped `cap`/`realm`,
      a `cap-sha256` mismatch, and a revoked agent each refuse with their distinct verdict.
- [ ] `docs/standards/dns-aid-bounded-delegation.md` specifies the `policy` bundle schema as a
      companion to the draft (the `LAND-2` artifact to take to the authors).

## Dependencies
- **Blocked by:** the proof chain being persistable/exportable for a published agent (overlaps the
  M2 proof-log decision — the `policy` bundle needs a real signed proof to embed).
- **Blocks:** nothing internal; **enables** the `LAND-3` positioning (discoverable *and* provably
  bounded) and the cross-issuer verifier story.
- **External:** track `draft-mozleywilliams-dnsop-dnsaid` versions; the field names here are pinned
  to **-02** and may shift before WG adoption — keep the field map in one place (10.1) so a rename
  is a one-line change.
