# Milestone 2 — The moat (hostile-operator-proof + independent audit)

> **Goal.** Prove the property a proxy can never have: the party **running** the gateway cannot lift the budget, forge a receipt, or drop a call — and anyone can re-derive the true spend **without trusting the operator**.
> **Strategy.** AGENT-2. "Bounded agent" is copyable; "bounded across a boundary you don't trust, verifiable without the operator" is the moat. **This is the gate — nothing past M2 ships until it's adversarially proven.**
> **Status today.** The online gate verifies a signed git-commit proof per call (`auths-verifier::verify_commit_against_kel_scoped`). The canonical ledger (the signed proof chain) exists. Missing: the **offline** audit verb + the red-team harness.

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
| 2.1 Independent audit verb | `auths` | `crates/auths-cli` (new `audit`), `crates/auths-verifier` |
| 2.2 Hostile-operator harness | `auths-mcp` | `examples/adversarial/` (new) |
| 2.3 Audit verdict type | `auths` | `crates/auths-verifier` |

## Epics & subtasks
### 2.1 — Independent audit verb · `auths`
- New `auths audit --receipts <dir> --issuer-kel <kel>` (or `verify-receipts`): replay the signed proof chain through the **same** `verify_commit_against_kel_scoped`.
- Re-extract each call's cost with `rail::extract` (ignore any claimed number); recompute the cumulative.
- Check chain continuity (no dropped/reordered call) and revocation.
- Emit a typed `AuditVerdict` + a human summary; `--json` for the console (M5).

### 2.2 — Hostile-operator red-team harness · `auths-mcp`
- New `examples/adversarial/` driving the gateway, then tampering the **operator-controlled** state three ways:
  - (a) edit the `SettledCounter` file to *lift* the budget;
  - (b) inject a forged receipt that *understates* spend;
  - (c) *drop* a call from the receipt log.
- Assert each is caught by `auths audit` / fails closed. Wire as a CI red-team gate.

### 2.3 — Audit verdict type · `auths`
- `AuditVerdict::{Consistent, TamperedProof{proof_ref}, BudgetMismatch{recomputed,claimed}, DroppedCall{at}, Revoked{at}}` in `auths-verifier`, surfaced by the CLI + console.

## Grounded sketch — recompute from the signed chain, not the operator's counter
```rust
let mut settled = 0u64;
for r in proof_chain {                                // ordered; gaps detectable
    let v = auths_verifier::verify_commit_against_kel_scoped(  // SAME fn the live gate calls
        &r.signed_commit, &agent_kel, &delegator_kel, &pinned_roots, provider, now).await;
    audit.require(v.is_authentic(), TamperedProof { proof_ref: r.proof_ref.clone() })?;
    settled += rail::extract(r.rail, &r.rail_response)?.amount_cents;   // re-extract; trust nothing
}
audit.require(settled == claimed_cumulative, BudgetMismatch { recomputed: settled, claimed })?;
audit.require(chain_is_gapless(&proof_chain), DroppedCall { at: /* first gap */ })?;
```

## Rigor — don't be sloppy
- **DRY — one verifier, two callers:** the offline audit calls the **exact** `verify_commit_against_kel_scoped` the online gate calls. A second verification path is the one place a bug is catastrophic.
- **Type-driven:** `AuditVerdict` variants, never a bool. Every failure mode is a named case the caller must handle.
- **Trust nothing the operator writes:** SETTLED is recomputed from the signed proof chain + rail responses; the `SettledCounter` and receipt log are **untrusted hints**.
- **Pure + portable = the moat:** `auths-verifier` is WASM-safe (F.5). The audit must run with **zero** auths server and **zero** operator cooperation — customer laptop, CI box, third party. Don't add a runtime dependency that breaks that.

## Done-when (acceptance)
- [ ] `auths audit` reproduces the exact true cumulative spend from receipts + issuer KEL alone.
- [ ] All three tamper beats (lift / forge / drop) fail closed, each as a distinct `AuditVerdict`.
- [ ] The harness runs as a CI red-team gate.
- [ ] The audit runs offline with no gateway/operator involvement.

## Dependencies
- **Blocks:** M3–M8 (the gate). **Blocked by:** M1 (a live run produces the proof chain to audit).
