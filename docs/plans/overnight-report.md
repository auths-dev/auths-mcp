# Overnight build report — `dev-agentMoney`

Autonomous `/loop` run against the milestone plan in `docs/plans/`. Branch: `dev-agentMoney`
(both repos). Rules in force: park-don't-fake · no push · no publish · no mainnet · secrets
never logged/committed · adversarial review on the **code** milestones (M2/M3.2/M4/M6);
self-review on trivial doc/shell changes (noted per row).

> **Two diffs to give your own eyes regardless** (flagged as work lands): the `auths audit`
> verifier (M2) and the EIP-3009 payment code (M3.2).

## Status table

| Milestone | Status | Confidence | Needs your eyes |
|---|---|---|---|
| M1.4 cleanups | ✅ done | high | no |
| M1 live transcript | ✅ done (round-trip) | high | no — but see note¹ |
| M2 the moat | 🅿️ **PARKED — needs your decision** | — | **YES — read Iteration 3 finding** |
| M3 cross-rail (hermetic) | ⏳ queued | — | — |
| M3.2 x402 EIP-3009 + real settle | 🅿️ **PARKED — supervised** | — | **YES — ⚠️ key-leak finding** |
| M4 delegation tree | ✅ engine-covered (gateway e2e pending) | high | no |
| M6 hardening | 🟡 partial — concurrency ✅ | high | no |
| M5 console scaffold | ⏳ queued | — | — |
| M8 demos | ⏳ queued | — | — |

## Iteration log

### Iteration 1 — setup + M1.4 (start)
- Confirmed both repos on `dev-agentMoney`; gateway binary present; `auths/.env` correctly
  gitignored (secret invisible). Only uncommitted items were my own untracked planning docs.
- **M1.4a (README de-stale):** the `## Status` block still said *"Scaffold. The product isn't
  built yet… `--check` currently exits non-zero… the gateway is a stub"* — stale: the gateway
  is built and `--check` is GREEN. Rewritten to reflect reality.
- **M1.4b (run.sh assertion):** the gateway's own non-zero exit on any verdict divergence is
  the **authoritative structured gate**; the shell `grep "verdict.*$verdict"` is a redundant
  secondary check whose only flaw was loose substring matching. Tightened to an exact
  word-boundary token match (no gateway change needed — a JSON-emission rewrite would be
  disproportionate for a redundant check). Documented that the Rust exit-code is the real gate.
- Review: doc + shell only → self-reviewed (full adversarial subagent reserved for the code
  milestones). Gate: `./run.sh --check` re-run.

### Iteration 2 — M1 live (real recording + replay round-trip)
- System Python had a stale `anthropic` (0.18.1) that crashed on newer `httpx` (`proxies=`
  TypeError) — **not a fake, an env mismatch**. Isolated a throwaway venv with current
  `anthropic` (0.109.2); the key loaded from `auths/.env` via `set -a; . auths/.env; set +a`
  (never echoed/committed).
- **Recorded a REAL `claude-opus-4-8` tool-loop** (`examples/live/record.py`): the model read
  the two files and posted a `create_comment` triage — 3 calls, all in-scope (`fs.read`,
  `github.comment`). It even self-declined to over-reach, citing read+comment-only delegation.
- Made `run.sh` honor a `TRANSCRIPT=…` override (1 line; default fixture unchanged). Verified:
  the recorded transcript **replays GREEN through the gateway** (live→record→replay round-trip
  proven), and the committed fixture still passes. Evidence: `examples/live/transcript.recorded.json`
  (secret-scanned clean).
- **¹ Note (honest):** this run had **no emergent over-reach**, so it only exercises the
  `allowed` verdict. The live *refusal* (`outside-agent-scope`) is covered by the committed
  fixture (`examples/replay/transcript.json`: read=allowed, write=refused) + the hermetic
  `--check`, not by a live recording. Re-running `record.py` would eventually capture an
  emergent `write_file` over-reach for a live-refusal transcript — left as optional (didn't
  burn repeated API runs chasing emergent behavior).
- Review: data + 1-line shell → self-reviewed (secret scan clean, both `--check` paths green,
  fixture intact). Did NOT overwrite the committed fixture.

### Iteration 3 — M2 the moat → deep recon → 🅿️ PARKED (needs your decision)

I went deepest here as asked, and the deep read of the real data model says the moat **cannot
be built honestly as specced yet** — it presupposes persisted data the gateway doesn't produce.
I will not fake an audit over data that doesn't exist. The findings (grounded; file refs in
`milestone_2_moat.md`):

1. **The settled cost is never signed.** The per-call signed git commit
   (`auths-mcp-gateway/src/chain.rs`) covers only `{tool, args}` + an `Auths-Scope` capability
   trailer. The actual rail-settled amount is *not* in the signed proof — so "recompute true
   spend from the signed chain alone" is **impossible** without also recording rail responses.
2. **Proof commits are throwaway.** Each call's commit is created in a *fresh per-call git
   repo*, signed, verified, then discarded. There is **no persistent proof chain** on disk for
   an offline tool to re-verify later. The receipt keeps only the commit **SHA** (`proof_ref`),
   not the commit **bytes** — so the proofs can't be re-run through
   `verify_commit_against_kel_scoped` after the fact.
3. **Receipts aren't persisted in the live path.** `proxy.rs` only `eprintln!`s receipts; the
   replay path only `println!`s them. There's no receipt log on disk to audit.
4. **`auths audit` is already taken** — it's the dev/commit-signing compliance report
   (`auths-cli/src/commands/audit.rs`), a different feature. The spend-audit needs a new name
   (e.g. `auths verify-spend`).
5. The operator's `SettledCounter` (`budget-ledger/<key>.json`) is durable but **not anchored**
   to the KEL — exactly the thing the audit must not trust, confirmed.

**What IS honestly verifiable today (no change):** authorization — *who was allowed to do what*
— is fully independently checkable from a proof's commit bytes + the issuer KEL via
`verify_commit_against_kel_scoped` (forged/revoked/expired/out-of-scope all caught). **What is
NOT yet verifiable offline:** the *spend* (cost isn't signed) and re-verification of a *past*
run (proofs/receipts aren't persisted).

**The decision for you (why this is parked, not faked):** the real moat needs a gateway-side
addition + one design call — both flagged, neither safe to decide unattended:
- **(A) Persist a proof+receipt log:** have the live gateway write each call's signed commit
  bytes + receipt + the raw rail response to an append-only log, so an offline `auths
  verify-spend` can re-verify every proof and re-extract every cost. (Gateway change.)
- **(B) Anchor the settled cost:** either include the rail's settlement reference/amount in the
  signed material, or accept that cost is rail-attested (re-derived from the recorded response)
  rather than agent-signed. This changes the moat's honest claim and touches signing — a
  **crypto-semantics decision** the rules say to flag, not make autonomously.

**Once you pick (A)+(B), the audit is ~1 focused build** (new `verify-spend` reusing the *same*
`verify_commit_against_kel_scoped` + `rail::extract`, typed `AuditVerdict`, + the lift/forge/drop
red-team) — I've fully scoped it. Parking now and moving to the cleanly-achievable milestones
(M3/M4/M6) so the night still delivers committed, reviewed code.

### Iteration 4 — M6 concurrency property test ✅ (committed 200753bb, in auths)
- Added `concurrent_calls_never_exceed_the_cross_rail_cap` to `auths-mcp-core/src/budget.rs`: 50
  OS threads race one reserve→settle each (the "rail" touched OUTSIDE the lock — the genuine
  concurrency window) against a $10 cap. Under any interleaving exactly 10 settle, 40 refuse,
  none stranded, the cross-rail total never exceeds the cap.
- Gate: **5/5 non-flaky** + full crate **33 passed** + clippy clean.
- **Adversarial review: SOUND** — the reviewer mutation-tested it (dropped `reserve`'s Σ(holds)
  term → the test FAILED 5/5, proving it catches the over-commit bug), confirmed real threads +
  a real reserve→settle window, and proved the outcome is interleaving-independent (not flaky).
  No findings.
- M6 remaining (not yet done): fail-closed edges on downstream/gateway errors (proxy.rs) and an
  explicit injection-safety scenario — though the *property* (model over-reaches → refused
  `outside-agent-scope`) is already demonstrated by the committed `examples/replay/transcript.json`
  fixture + `--check`. Marked M6 🟡 partial.

### Iteration 5 — M3.2 x402 live settle → 🅿️ PARKED (supervised) + ⚠️ a real security finding

Assessed before attempting, as planned. Two things make the live settle a supervised task, not
a clean autonomous one — and one of them is a bug you should see:

1. **⚠️ KEY-LEAK (must fix, must-review).** The current
   `examples/payments/adapters/x402-adapter/settle.mjs` live path does:
   `fetch(.../settle, { body: JSON.stringify({ requirements, walletKey: env.X402_WALLET_PRIVATE_KEY }) })`
   — i.e. it **transmits the wallet private key to the facilitator**. That's the exact leak M3.2
   exists to remove. (Blast radius is low — it's a throwaway base-sepolia burner, and the live
   path isn't exercised by the hermetic gate — but it must not ship.) I did **not** rewrite it
   autonomously: it's must-review payment code and a correct replacement needs the items below.
2. **Facilitator API unconfirmed.** `GET https://x402.org/facilitator/supported` just redirects
   (no JSON schema returned), so the exact `/settle` request shape isn't pinned from here. The
   x402 spec says `/settle` takes `{ x402Version, paymentPayload, paymentRequirements }` where
   `paymentPayload` is the **signed EIP-3009 authorization** (NOT a walletKey).
3. **Non-standard flow.** This is a standalone direct settle (no resource-server 402), so the
   `paymentRequirements` + `paymentPayload` must be constructed by hand.

**The correct rewrite (scoped for the supervised session, ~1 focused build):** load the key from
`auths/.env`; with `viem`, `signTypedData` an EIP-3009 `transferWithAuthorization`
(domain: name "USDC", version "2", chainId 84532, verifyingContract = base-sepolia USDC;
message: {from, to, value, validAfter, validBefore, nonce}); assemble the x402 "exact"-scheme
EVM `paymentPayload` from that signature; POST `{ x402Version, paymentPayload, paymentRequirements }`
to `/settle`; the **key signs locally and NEVER leaves the process** — only the signature is sent.
First verify the signature recovers the burner address locally (no broadcast), THEN do one real
base-sepolia settle for the tx hash. Worth doing with you watching (real key + a live broadcast).
Parked; moving to M4 (a clean self-contained engine test).

### Iteration 6 — M4 delegation tree → ✅ already engine-covered (no redundant test added)

Recon'd the real delegation engine before writing anything. Every property M4 asks for is
**already comprehensively tested** in `auths` — adding more would be a redundant fake-green, so I
did not:
- **Single-level attenuation** (scope/TTL/depth ⊆ parent): `auths-sdk/.../agents/scope.rs` tests
  `capability_subset_valid` / `capability_subset_invalid` / `ttl_exceeding_parent_is_rejected` /
  `depth_limit_is_rejected`.
- **Treasury aggregate-cap** (Σ children ≤ parent → `AggregateCapExceeded`): `treasury.rs`
  `subdelegation_within_parent_holding_holds_and_overflow_is_refused` + 5 more, plus
  `tests/integration.rs`.
- **Subtree / kill-switch revocation** (`revoke_batch`): `tests/cases/kill_switch.rs` (batch revoke
  + idempotent re-revoke).
- **Transitive revocation** (a delegate of a revoked delegator is rejected): the verifier's
  `DeviceRevoked` / `SignedAfterRevocation` verdicts (`commit_kel.rs`, ordered by KEL position) +
  `tests/cases/agents.rs` (`rotate_revoked_agent_rejected`, `agents_revoke_marks_revoked`, …).

**The honest M4 gap is the gateway END-TO-END** (the `auths wrap` command spawning a *nested*
sub-agent gateway bounded ⊆ its parent, with subtree revocation flowing through) — that's
**gateway wiring in `proxy.rs`**, the same class of work as M3, not an engine test.

---

## 🔭 Meta-finding (the through-line of tonight)

Three milestones (M2, M4, and — by the spec — M3) converge on the same truth: **the `auths`
engine is mature and thoroughly tested** (verifier, delegation, treasury, budget, revocation).
The remaining auths-mcp milestones are **not engine gaps — they're one piece of gateway work**:
extend `auths-mcp-gateway/src/proxy.rs` (today a single-downstream proxy that doesn't persist) to
(i) front **multiple rails** under one budget (M3), (ii) wrap **nested sub-agents** (M4 e2e),
(iii) **persist a proof+receipt+rail-response log** so the offline audit can exist (M2), and
(iv) tighten **fail-closed** edges (rest of M6). One focused, reviewable gateway effort unblocks
M2/M3/M4-e2e/M6 together — best done with you in the loop (it's the security boundary). M5
(console) is net-new frontend; M8's flagship demos depend on (i)–(ii) landing first.

This is why the night's clean, self-contained wins (M1.4, M1, M6-concurrency) are committed and
the rest are parked with precise scopes rather than forced.
