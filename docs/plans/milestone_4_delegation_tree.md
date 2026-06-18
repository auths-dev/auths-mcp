# Milestone 4 — Delegation tree (attenuation + subtree revoke)

> **Goal.** Agents hiring agents, bounded recursively under one human ceiling none of them — even compromised — can breach; one revoke at the root stops the whole subtree.
> **Strategy.** AGENT-2 (depth). "My agent's agent's agent can't exceed my $100" is on no platform's roadmap.
> **Status today.** The engine **already enforces** attenuation (qualitative + quantitative) and subtree revoke. The gap is exposing it through `wrap`.

## Why
Real agentic systems fan out: a manager delegates to researchers that delegate to tools. The human ceiling has to hold *recursively*, and revocation has to act as a *subtree*, or the bound is theater the moment an agent sub-contracts.

## Baseline — what already exists (do not rebuild)
- **Qualitative attenuation:** `auths/crates/auths-sdk/src/domains/agents/delegation.rs::enforce_scope_subset` (≈293) + `scope.rs::validate_delegation_constraints` (≈69) — capability subset + TTL + depth; errors `CapabilityNotGranted | TtlExceedsParent | DepthLimitExceeded`.
- **Quantitative attenuation:** `auths-sdk/src/domains/treasury.rs::subdelegate` (≈519) — `Σ children ≤ parent's slice` → `Verdict::AggregateCapExceeded`.
- **Call-time enforcement:** `auths-verifier::verify_commit_against_kel_scoped(agent_kel, delegator_kel, …)` reads the KEL-anchored scope seal.
- **Subtree revoke:** `delegation.rs::revoke_batch` (≈465) — one `ixn`, idempotent, returns `anchored_at_seq`; immediate-from-chain.
- **Config seed:** `auths-mcp/examples/payments/subagent-slice.config.json`.

## Where the work lands
| Epic | Repo | Path |
|---|---|---|
| 4.1 Nested sub-agent wrap | `auths-mcp` + `auths` | `examples/payments/subagent-slice.config.json`, `auths id agent add`, `treasury subdelegate` |
| 4.2 Attenuation at call time | `auths` | `auths-verifier`, `auths-sdk/domains/agents/*` |
| 4.3 Subtree revoke | `auths` + `auths-mcp` | `delegation.rs::revoke_batch`, scenario |

## Epics & subtasks
### 4.1 — Nested sub-agent wrap · `auths-mcp` + `auths`
- A manager `wrap` that hands a child a slice: `auths id agent add --scope <subset>` + `treasury subdelegate --parent … --child … --amount …`, then a child `wrap` under it.
- Wire `subagent-slice.config.json` into the live path.

### 4.2 — Attenuation at call time · `auths`
- Confirm a child cannot present scope/budget beyond its slice: refused at **delegation** time (`OutsideDelegatorScope`) **and** at **call** time (the verifier's KEL-scoped check). No new logic — assert the existing path end-to-end through `wrap`.

### 4.3 — Subtree revoke · `auths` + `auths-mcp`
- Revoke the manager (`revoke_batch`); assert every descendant's next call → `Verdict::Revoked`, immediate-from-chain (no propagation window).

## Grounded sketch — enforced once, in the SDK/verifier
```rust
// auths-sdk::agents::scope — the gateway CALLS this; it never re-implements subset logic.
validate_delegation_constraints(
    &DelegatorScope { capabilities: parent_caps, remaining_ttl_secs, depth, max_depth },
    &RequestedScope { capabilities: child_caps, ttl_secs },
)?;  // Err(CapabilityNotGranted | TtlExceedsParent | DepthLimitExceeded) — a child can't widen its parent
match treasury::subdelegate(repo, manager, parent_did, child_did, amount)? {   // Σ(children) ≤ parent slice
    Verdict::Subdelegated { .. }         => grant_child_slice(),
    Verdict::AggregateCapExceeded { .. } => refuse(),       // the human's ceiling holds recursively
}
```

## Rigor — don't be sloppy
- **DRY — one attenuation site:** capability/TTL/depth subset lives in `validate_delegation_constraints`; the quantitative Σ lives in `treasury::subdelegate`. `wrap`/the gateway **never** re-derives "is this ⊆ parent" — it calls the SDK/verifier. Two subset checks = two places to disagree.
- **Two invariants, kept consistent:** qualitative (scope ⊆ parent, KEL-anchored) and quantitative (Σ children ≤ parent slice, treasury-ledger) are separate ledgers a sub-agent must satisfy **both** of. Don't let them drift.
- **Type-driven refusals:** `DelegationError::{CapabilityNotGranted, TtlExceedsParent, DepthLimitExceeded}` and `Verdict::AggregateCapExceeded` render distinctly — a depth-limit refusal is not a budget refusal.
- **Revocation stays from-chain:** `revoke_batch` anchors **one** `ixn`; the verifier reads `effective_revocation`. No propagation window, no revocation-list service — do not add one.
- **Bound the recursion:** set a real `max_depth`; `validate_delegation_constraints` already enforces `depth < max_depth`.

## Done-when (acceptance)
- [ ] A manager wraps a sub-agent with an attenuated slice; the child cannot widen scope or exceed its budget.
- [ ] A compromised leaf's over-slice call is refused.
- [ ] One `revoke_batch` at the root → every descendant's next call → `Revoked`.

## Dependencies
- **Blocks:** Demo 4. **Blocked by:** M1, M2. **Parallel-OK with:** M3.
