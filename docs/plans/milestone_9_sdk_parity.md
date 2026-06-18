# Milestone 9 — SDK parity (one core, every language)

> **Goal.** Make the agent-bounding capability the gateway proved **ubiquitous in-process**: a builder in Python / Node / Go / Swift can mint a bounded delegation, present a per-call proof, verify, audit, and revoke — natively, backed by the *same* Rust core, never a reimplementation.
> **Strategy.** "One engine, many surfaces." The gateway is the zero-code adoption surface; the SDKs are the in-process surface for the people *building* agents. Both spread the same wedge.
> **Status today.** The SDKs already bind the Rust core (not reimplement it), and the agent surface is *partly* exposed (`auths.agent.AgentAuth`). The mcp work defines the full verb-set to fold in.
> **Gate.** Runs **after** the gateway proves the verb-set (M2–M4 define the canonical verbs).

## Why
The gateway (`auths wrap`) is the broadest ubiquity lever — language-agnostic, zero SDK. But the developer *writing* an orchestrator or a tool-server wants the capability **in-process**: issue bounded slices to workers, verify the per-call proof itself, audit spend natively — without shelling out to a gateway. The mcp work is the **reference spec** for what that in-process surface should be; this milestone folds it into the SDKs that already exist, **without ever creating a second implementation.**

## Baseline — what already exists (and is the right shape)
- **SDKs are thin FFI bindings to the Rust core, not ports of logic:**
  - `auths/packages/auths-python` — **pyo3/maturin** native extension (`src/*.rs` → `auths._native`), idiomatic Python in `python/auths/*.py`. Already ships `AgentAuth`, `audit`, `policy`, `attestation`, `verify_presentation`.
  - `auths-node` (napi), `auths-mobile-swift` (uniffi, same family as `murmur-ffi`).
  - `auths-express` / `auths-fastapi` — relying-party middleware.
  - `auths-verifier-{go,swift,ts}` — verifier surfaces, **100% derived from the Rust core** (no free-hand logic — confirmed). This is the invariant M9 must preserve.
- **The capability lives in core crates the SDKs can bind:** `auths-sdk` (agents / treasury / delegation / usage-ledger), `auths-verifier` (verification, F.5 WASM-safe). The budget/rail/per-call-gate primitives currently live in `auths-mcp-core` — **coupled to MCP**, and the thing to promote.

## Where the work lands
| Epic | Repo | Path |
|---|---|---|
| 9.1 Promote the bounded-authority core | `auths` | factor out of `crates/auths-mcp-core` → `crates/auths-sdk` (or new `crates/auths-bound`) |
| 9.2 Canonical capability surface | `auths` | `crates/auths-sdk`, `crates/auths-verifier` |
| 9.3 Fold into Python + Node first | `auths` | `packages/auths-python/src/*.rs` + `python/auths/agent.py`; `packages/auths-node` |
| 9.4 Conformance-gate the parity | `auths` | shared test vectors across gateway / CLI / SDKs |
| 9.5 Others on pull | `auths` | `auths-verifier-{go,swift,ts}`, middleware |

## Epics & subtasks
### 9.1 — Promote the bounded-authority core · `auths`
- Factor the transport-agnostic primitives (cap/budget reserve-settle, `rail::extract`, the per-call gate, the audit) **out of `auths-mcp-core`** into a core crate the SDKs already bind (`auths-sdk`, or a new `auths-bound`).
- `auths-mcp-core` keeps only the MCP-specific wiring (rmcp, `tools/call`); it becomes **one adapter** over the shared core.
- Net architecture: **MCP gateway = MCP adapter over the core; each SDK = a language adapter over the same core.**

### 9.2 — Define the canonical capability surface · `auths`
The verb-set the gateway proved, as **one typed surface** in the core (the same types the gateway, CLI, and every SDK expose):
- `issue_bounded_delegation(scope, budget, ttl)` · `present(call) -> signed_proof` · `verify(proof, agent_kel, delegator_kel) -> Verdict` · `audit(receipts, issuer_kel) -> AuditVerdict` · `revoke(agent)` · budget `reserve`/`settle` + `extract(rail, resp)`.

### 9.3 — Fold into Python + Node (where agents are written today) · `auths`
- Expose the verbs through the **existing** pyo3 / napi bindings; extend `AgentAuth` rather than add a parallel path.
- Python layer stays idiomatic sugar (error mapping, ergonomics) over `_native`; **zero** enforcement/verification logic in Python.

### 9.4 — Conformance-gate the parity · `auths`
- Extend the existing KERI conformance discipline to the **agent verbs**: a shared vector suite asserting the gateway, the CLI, and every SDK produce the **byte-identical** `Verdict` / `AuditVerdict` for the same input.

### 9.5 — Others on pull · `auths`
- Go/Swift/TS verifier surfaces + middleware get the agent verbs **only when an adopter needs them** — don't gold-plate ahead of demand.

## Grounded sketch — the SDK is sugar over the one core
```python
# auths-python — idiomatic wrapper; the verb is the SAME core call the gateway makes.
from auths.agent import AgentAuth
agent = AgentAuth.issue(scope=["paid.call"], budget="$5", ttl="30m")   # -> auths-sdk delegation/treasury
proof = agent.present(call)                                            # -> auths-mcp-gateway::chain (promoted)
verdict = auths.verify(proof, agent_kel, delegator_kel)               # -> auths-verifier (THE one verifier)
report  = auths.audit(receipts, issuer_kel)                          # -> auths-verifier (M2.1), identical verdict
# No verification/enforcement logic lives in this file. It is a typed call into _native.
```

## Rigor — don't be sloppy
- **One source of truth — preserve it, don't reinvent it.** Every SDK verb is Rust-core-sourced (pyo3 / napi / uniffi / WASM); **nothing is hand-ported** (already the rule here). The milestone's whole discipline is keeping that true as the *surface* grows — a new agent verb that ships as native-language logic instead of a core call is the one unacceptable outcome.
- **Conformance-gated parity:** the gateway, the CLI, and each SDK must return the byte-identical verdict on shared vectors. Extend the interop conformance suite to the agent verbs; a port that *almost* agrees is a latent moat-breaker.
- **Bindings are sugar, not logic:** the language layer does error mapping + ergonomics; enforcement, verification, and budget accounting stay in Rust.
- **One vocabulary across surfaces:** the SDK verbs == the gateway verbs == the CLI verbs, with the **same types** (`Verdict`, `Receipt`, `AuditVerdict`, delegation types). A capability named or shaped differently per language is drift.
- **Adoption discipline:** ship the **minimal** canonical verb-set; gateway → Python + Node → others on pull. Every verb × every language is a maintenance surface — earn each one.

## Done-when (acceptance)
- [ ] The bounded-authority primitives live in a transport-agnostic core crate; `auths-mcp-core` is an adapter over it.
- [ ] Python + Node expose the full canonical agent verb-set, backed by the core, with **no** reimplementation.
- [ ] `AgentAuth` (and the Node equivalent) can issue a bounded delegation → present a proof → verify → audit → revoke, in-process.
- [ ] A shared conformance suite asserts byte-identical verdicts across gateway / CLI / each SDK for the agent verbs.

## Dependencies
- **Blocked by:** M2 (`audit`), M3 (budget/rail), M4 (delegation tree) — they define the canonical verbs. **Runs after** the gateway proves the surface (M1–M8).
- **Amplifies:** the strategy's provenance on-ramp — the SDKs are also how dev/provenance signing reaches every language.
