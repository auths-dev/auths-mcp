# Milestone 6 — Hardening for real use

> **Goal.** Survive the unglamorous edges: concurrency-correct budgets, fail-closed everywhere, durable receipts, and the prompt-injection safety property as a CI gate.
> **Strategy.** Adoption dies on the edges, not the demo.
> **Status today.** The pieces exist (mutex-guarded reserve/settle, atomic counter, typed wire outcome, scope-before-forward gate). This milestone *proves* them and closes the gaps.

## Why
The demos sell; the edges retain. A double-spend under concurrency, a pass-through on a downstream error, or an agent that talks its way past the boundary turns the wedge from "trustworthy" to "toy" — and those are exactly the failures a buyer's security team will probe.

## Baseline — what already exists
- **Concurrency primitives:** `auths-mcp-core/src/budget.rs` — reserve/settle behind `Arc<Mutex<CrossRailBudget>>`; `SettledCounter` atomic (temp-write + rename), monotonic high-water.
- **Anti-replay:** the usage ledger's `UsageDecision::RolledBack` rejects a counter that goes backwards.
- **Typed wire outcome:** `auths-mcp-gateway/src/proxy.rs::WireBudgetOutcome` (`forwards()` / `code()`).
- **Below-the-model gate:** `proxy.rs::call_tool` checks scope **before** forwarding — an injected tool call is refused regardless of model intent.

## Where the work lands
| Epic | Repo | Path |
|---|---|---|
| 6.1 Concurrency proof | `auths` | `crates/auths-mcp-core/src/budget.rs` |
| 6.2 Fail-closed edges | `auths` | `crates/auths-mcp-gateway/src/proxy.rs` |
| 6.3 Injection safety property | `auths-mcp` + `auths` | scenario + gateway test |

## Epics & subtasks
### 6.1 — Concurrency proof · `auths`
- Property/loom test: parallel `reserve` → `settle` never exceeds the cap, never double-spends; holds released on refusal/error.

### 6.2 — Fail-closed edges · `auths`
- Gateway/downstream unreachable or malformed response → typed `Refused`, never a pass.
- Append-only receipt persistence + a read-only export.

### 6.3 — Injection safety property · `auths-mcp` + `auths`
- Scenario drives the model to exceed scope/budget (a prompt injection); assert the boundary holds. **In CI**, not a demo.

## Grounded sketch — every unknown is a refusal
```rust
let outcome = enforce_wire_budget(&mut budget, &cost)?;     // WireBudgetOutcome — typed, not a bool
if !outcome.forwards() { return deny(outcome.code()); }
let resp = downstream.call_tool(req).await
    .map_err(|_| GateError::DownstreamUnreachable)?;        // unreachable ⇒ refuse, NOT pass
// Injection: the model emits `fs.delete`; the gate refuses on scope BEFORE forward — intent is irrelevant.
```

## Rigor — don't be sloppy
- **Fail-closed is the default for every unknown:** downstream down, gateway error, malformed response, unknown rail → refuse. Never `_ => allow`. Grep for any path that reaches a rail without passing the gate, and delete it.
- **Type-driven outcomes:** `WireBudgetOutcome` + a `GateError` enum — not exceptions that can be swallowed into a pass. A downstream failure is a *typed refusal* surfaced as a receipt.
- **One piece of shared mutable enforcement state:** `CrossRailBudget` (mutex) + the durable `SettledCounter`. No other mutable enforcement state anywhere — property-test it, don't eyeball it.
- **Intent is irrelevant — and that's the test:** the injection beat asserts a fully compromised model still cannot cross the boundary because the gate is *below* it. This is the safety claim; gate it in CI.

## Done-when (acceptance)
- [ ] Parallel-call budget accounting is exact (property test green).
- [ ] Every failure mode fails closed with a clear, typed error and a receipt.
- [ ] An injected agent's escalation is refused at the boundary — asserted in CI.
- [ ] Receipts persist append-only and export read-only.

## Dependencies
- **Runs alongside:** M3–M5 (hardening is a continuous tax, not a phase). **Blocked by:** M1.
