# Milestone 2 — The moat (hostile-operator-proof + independent audit)

> **Goal.** Prove the property a proxy can never have: the party **running** the gateway cannot lift the budget, forge a receipt, or drop a call — and anyone can re-derive the true spend **without trusting the operator**.
> **Strategy.** AGENT-2. "Bounded agent" is copyable; "bounded across a boundary you don't trust, verifiable without the operator" is the moat. **This is the gate — nothing past M2 ships until it's adversarially proven.**
> **Status today.** The online gate verifies a signed git-commit proof per call (`auths-verifier::verify_commit_against_kel_scoped`). Missing: **(A)** a persisted proof+receipt+rail-response log, **(B1)** a signed settlement commit that anchors the cost, and the **offline** `verify-spend` verb + red-team harness on top.
>
> ✅ **DECISION (2026-06-18) — build A + B1.** Overnight recon found the original framing assumed persisted, cost-anchored proofs that don't exist yet: each proof commit is a **throwaway per-call git repo** (only the SHA survives), the **settled cost is never signed** (`{tool,args}`+scope only), receipts/rail-responses **aren't persisted**, and `auths audit` is already the commit-signing report (so the spend audit is **`auths verify-spend`**). Chosen path:
>
> - **(A) Persist a proof+receipt+rail-response log** — *mandatory, not a choice*: without it there is nothing offline to audit. *(gateway change — `proxy.rs`)*
> - **(B1) Anchor the settled cost in the agent's signature** — after a metered call settles, the gate signs a **second** commit (a *settlement commit*) binding `{call proof_ref, rail, actual_cents, rail_ref, cumulative}` with the **same delegated key** + an `Auths-Scope: settle` trailer. The audit re-derives true spend by **summing the signed costs** — un-forgeable by the operator, not merely re-derived from a response the operator recorded (that was B2, the weaker option — rejected). **This does NOT change `verify_commit_against_kel_scoped`'s cryptography** — the settlement commit is just another delegated-key-signed, scope-checked commit the *same* verifier already validates. The must-review surface is **one new signing event in the settle path**, not the verifier.
>
> Authorization (who-was-allowed-what) is already fully offline-verifiable from a proof's bytes + KEL today; A+B1 add the same property for **spend**, and make a **past run** re-verifiable.

> ✅ **COMPLETE (2026-06-18) — the settled cost is now AGENT-SIGNED end-to-end.** The settlement
> commit carries the cost in signed `Auths-Settle-*` trailers under a dedicated `settle` capability
> and is **bound to its call** by the hash of the call commit (`Auths-Settle-Call` = `sha256(call_commit)`),
> so a settlement cannot be moved onto a different call. `audit_spend_log` takes each settled cost from
> that signed amount (not the operator-held rail response), requires a settlement on every non-zero
> settled call, and ties the cumulative to signed material. Proven by `./run.sh --check`: a metered
> Stripe-test settlement audits `consistent`, and three red-teams — altering the cost, binding a
> settlement to the wrong call, dropping the settlement — each yield `tampered-proof`. Two adversarial
> reviews drove the call-binding + mandatory-settlement + signed-cumulative checks (a critical
> settlement-reuse hole was caught and fixed). Commits: `aa2c7e1c` `779573b9` `ad52113b` (auths) ·
> `b20f447` (auths-mcp). **Only remaining M2 work: live-wire signing (the must-review follow-on below).**
>
> 🛠️ **BUILD PROGRESS (2026-06-18).**
> - **Epic 2.4 DONE** — the audit data model (`AuditVerdict` typed enum + `SpendLogRecord` JSONL
>   record) shipped in **`auths-mcp-core/src/audit.rs`** (37 tests green, clippy clean).
>   *Placement corrected:* it lives in `auths-mcp-core`, **not** `auths-verifier` — `SpendLogRecord`
>   wraps `Receipt`, and the crate dependency runs `auths-mcp-core → auths-verifier`, so the verdict
>   type cannot live in the verifier without a dependency inversion.
> - **⚠️ New finding that re-shapes 2.0/2.1:** the **LIVE** `proxy.rs::call_tool` path does **not**
>   sign a per-call proof or build a `Receipt` — it does a boolean scope check (`self.scope.contains`)
>   + budget enforcement and `eprintln!`s "receipted". The signed proof chain exists only in the
>   **hermetic/replay gate** (`replay.rs`). So 2.0 is **not** pure persistence on the live wire.
>   **Plan:** build the audit over the hermetic gate first (it already signs + verifies a real commit
>   per call); **wiring `chain.rs` signing into the live `call_tool`** so a LIVE run is auditable is a
>   **separate MUST-REVIEW follow-on** (it changes the live wire's per-call crypto behavior).

## Why
A cap + a receipt is a weekend for any platform. The thing they structurally won't ship is a system whose whole point is that you **don't have to trust them**. If that isn't adversarially gated, there's no product — just a nicer proxy.

## Baseline — what already exists
- **One verifier:** `auths/crates/auths-mcp-core/src/gate.rs:239` calls `auths_verifier::verify_commit_against_kel_scoped(signed_proof, agent_kel, delegator_kel, pinned_roots, …)`. The proof is a **signed git commit** (`auths-mcp-gateway/src/chain.rs`).
- **Receipts:** `auths-mcp-core/src/receipt.rs` — `Receipt` with RFC-8785 canonical bytes + SHA-256; `proof_ref` is the commit SHA.
- **Durable counter:** `auths-mcp-core/src/budget.rs::SettledCounter` — monotonic high-water, filesystem-atomic (temp-write + rename). *The operator's own anti-rollback — the audit will not trust it.*
- **Revocation:** `auths-verifier` `CredentialVerdict::CredentialRevoked { revoked_at }`, `effective_revocation` — immediate-from-chain.

## Where the work lands
| Epic | Repo | Path |
|---|---|---|
| 2.0 (A) Proof+receipt+rail-response log | `auths` | `crates/auths-mcp-gateway/src/proxy.rs` (+ new `spend_log.rs`) |
| 2.1 (B1) Signed settlement commit | `auths` | `crates/auths-mcp-gateway/src/chain.rs` + the gate settle path |
| 2.2 Offline `verify-spend` verb | `auths` | `crates/auths-cli` (new `verify-spend`), `crates/auths-verifier` |
| 2.3 Hostile-operator red-team harness | `auths-mcp` | `examples/adversarial/` (new) |
| 2.4 Audit verdict type ✅ | `auths` | `crates/auths-mcp-core/src/audit.rs` (corrected from auths-verifier) |

## Epics & subtasks

### 2.0 — (A) Persist the proof+receipt+rail-response log · `auths`
- Today proof commits live in **throwaway per-call repos** and the live path only `eprintln!`s receipts. Add an **append-only log per delegation** — `<repo>/spend-log/<delegation>.jsonl`, one record per call: `{ call_commit_bytes, receipt, rail?, rail_response_bytes?, settlement_commit_bytes? }`.
- Written in `proxy.rs` on the brokered path, after settle. This is the **only** artifact `verify-spend` reads — no auths server, no operator cooperation. Append-only + fsync; a crash leaves a whole-record-or-nothing tail.

### 2.1 — (B1) Anchor the settled cost in a signed settlement commit · `auths` *(must-review)*
- After a **metered** call settles, the gate signs a SECOND commit — the *settlement commit* — with the **same delegated key** + `Auths-Scope: settle`, binding `{ call_proof_ref, rail, actual_cents (== `rail::extract` of the REAL response), rail_ref (charge_ref / tx), cumulative_after }`.
- **Chain it** (parent = the call commit / prior settlement) so the sequence is ordered and a dropped pair is a detectable gap.
- **No verifier change:** the settlement commit is validated by the SAME `verify_commit_against_kel_scoped` — it is a delegated-key-signed, scope-checked commit like any other. The new surface is exactly one signing event in the settle path (the agent's delegated key is already in-process there to sign the call commit), plus a `settle` capability in the scope seal. Flag for review; it does **not** touch the verifier's crypto.

### 2.2 — Offline `verify-spend` verb · `auths`
- New `auths verify-spend --log <spend-log.jsonl> --issuer-kel <kel>`: for each record verify **both** the call commit and the settlement commit through the **same** `verify_commit_against_kel_scoped`; re-derive cumulative by **summing the signed `actual_cents`**; cross-check each signed cost against `rail::extract(rail_response)`; check chain continuity + revocation.
- Emit a typed `AuditVerdict` + human summary; `--json` for the console (M5). Name is `verify-spend` — `auths audit` is already the commit-signing compliance report.

### 2.3 — Hostile-operator red-team harness · `auths-mcp`
- New `examples/adversarial/` drives the gateway, then tampers the **operator-controlled** state and asserts each fails closed under `verify-spend`:
  - (a) lift the `SettledCounter`; (b) forge a receipt understating spend; (c) drop a call;
  - **(d) NEW under B1 — rewrite a settlement commit's `actual_cents`** → the agent's signature no longer verifies (`TamperedProof`); the operator cannot re-sign without the delegated key.
- Wire as a CI red-team gate.

### 2.4 — Audit verdict type · `auths`
- `AuditVerdict::{ Consistent, TamperedProof{proof_ref}, CostMismatch{signed, recomputed, proof_ref}, BudgetMismatch{recomputed, claimed}, DroppedCall{at}, Revoked{at} }` in `auths-verifier`, surfaced by the CLI + console.

## Grounded sketch — re-derive from the **signed** costs, not the operator's counter (B1)
```rust
let mut settled = 0u64;
for rec in spend_log {                                         // ordered; gaps detectable
    // 1. the call was authorized — the SAME verifier the live gate calls
    let v = verify_commit_against_kel_scoped(&rec.call_commit, &agent_kel, &delegator_kel, &roots, provider, now).await;
    audit.require(v.is_valid(), TamperedProof { proof_ref: rec.call_ref() })?;

    if let Some(settle_commit) = &rec.settlement_commit {       // metered calls carry one
        // 2. the COST is signed by the agent (B1) — verify the settlement commit too
        let s = verify_commit_against_kel_scoped(settle_commit, &agent_kel, &delegator_kel, &roots, provider, now).await;
        audit.require(s.is_valid(), TamperedProof { proof_ref: rec.settle_ref() })?;
        let signed = rec.signed_cost_cents();                  // the cost the AGENT committed to
        // 3. signed cost must equal the recorded rail response — operator can't sign X but log Y
        let recomputed = rail::extract(rec.rail, &rec.rail_response)?.amount_cents;
        audit.require(signed == recomputed, CostMismatch { signed, recomputed, proof_ref: rec.settle_ref() })?;
        settled += signed;                                     // sum SIGNED costs — never the operator's counter
    }
}
audit.require(settled == claimed_cumulative, BudgetMismatch { recomputed: settled, claimed })?;
audit.require(chain_is_gapless(&spend_log),  DroppedCall   { at: /* first gap */ })?;
```

## Rigor — don't be sloppy
- **DRY — one verifier, two callers:** the offline audit calls the **exact** `verify_commit_against_kel_scoped` the online gate calls. A second verification path is the one place a bug is catastrophic.
- **Type-driven:** `AuditVerdict` variants, never a bool. Every failure mode is a named case the caller must handle.
- **Trust nothing the operator writes:** SETTLED is re-derived by summing the agent's **signed** settlement costs (B1), each cross-checked against the recorded rail response; the `SettledCounter` and the raw receipt log are **untrusted hints**, never inputs to the total.
- **Pure + portable = the moat:** `auths-verifier` is WASM-safe (F.5). The audit must run with **zero** auths server and **zero** operator cooperation — customer laptop, CI box, third party. Don't add a runtime dependency that breaks that.

## Done-when (acceptance)
- [ ] **(A)** the gateway writes a persisted proof+receipt+rail-response log; a past run is re-readable offline.
- [ ] **(B1)** every metered call carries a **signed settlement commit** that anchors its cost.
- [ ] `auths verify-spend` reproduces the exact true cumulative spend by **summing the signed costs**, from the log + issuer KEL alone.
- [ ] **Four** tamper beats — lift / forge / drop / **alter-signed-cost** — fail closed, each a distinct `AuditVerdict`.
- [ ] Runs offline with zero gateway/operator involvement; the harness is a CI red-team gate.

## Dependencies
- **Blocks:** M3–M8 (the gate). **Blocked by:** M1 (a live run produces the log to audit).
- **Sequencing inside M2:** 2.0 (A: log) → 2.1 (B1: signed cost) → 2.2 (`verify-spend`) + 2.4 (verdict type) → 2.3 (red-team gate).
