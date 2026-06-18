# Milestone 5 — The human surface (console)

> **Goal.** A face for the wedge: set / watch / revoke / verify an agent's bounded authority — no terminal required.
> **Strategy.** AGENT-5. "Five teams stay" needs a surface, not a shell script.
> **Status today.** A prototype exists as a shell dashboard; the console generalizes it with typed inputs and drops the string-greps. Nothing here is enforcement — it's a read-model + CLI dispatch.

## Why
The enforcement is invisible by design. A non-builder won't adopt a thing they can't *see* working. The console makes "your agent is bounded, here's its live spend, here's the revoke button, here's the independent proof" legible in seconds.

## Baseline — what already exists
- **Prototype:** `agent-treasury/dashboard/render.sh` already reads `auths --json treasury status` + signed receipts (`agent_spend_cents`, `agent_verdicts`, `agent_receipts_verify`). It **string-greps JSON** — the anti-pattern to drop.
- **Structured outputs to consume:** `Receipt` (`auths-mcp-core/src/receipt.rs`, RFC-8785), `auths --json treasury status` (`Verdict`), `UsageDecision` (usage ledger), and `auths audit` (M2.1).

## Where the work lands
| Epic | Repo | Path |
|---|---|---|
| 5.1 Read-model | `auths-mcp` | `console/` (new) |
| 5.2 Actions → CLI | `auths-mcp` → `auths` | `auths id agent revoke`, `treasury reclaim`, `auths audit` |
| 5.3 The surface | `auths-mcp` | `console/` (TUI or local web) |

## Epics & subtasks
### 5.1 — Read-model · `auths-mcp`
- Consume the gateway's `Receipt` stream + poll `auths --json treasury status`.
- Render per-agent: cap, spend-per-rail, the verdict stream.

### 5.2 — Actions wired to the CLI · `auths-mcp` → `auths`
- Revoke → `auths id agent revoke`; reclaim → `treasury reclaim`; one-click verify → `auths audit` (M2.1).
- The UI dispatches CLI commands; it never signs.

### 5.3 — The surface · `auths-mcp`
- A live TUI (e.g. `ratatui`) or a local web view. Thin read-model, no business logic.

## Grounded sketch — a pure read-model
```ts
const status   = JSON.parse(sh(`auths --json treasury status --manager ${mgr}`)).data;  // typed, not grepped
const receipts = readSignedReceipts(swarmDir).filter(verify);   // verify (M2.1) BEFORE display
for (const s of status.slices)
  render(s.agent_did, s.amount, spentPerRail(receipts, s), verdicts(receipts, s));
onRevoke(a => sh(`auths id agent revoke --key ${root} ${a}`));  // UI dispatches the CLI; never signs
onVerify(() => sh(`auths audit --receipts ${swarmDir} --issuer-kel ${kel}`));
```

## Rigor — don't be sloppy
- **Single source of truth:** every number comes from the engine's structured output (`Receipt`, treasury `Verdict`, `UsageDecision`); the UI recomputes **nothing**. A console that re-derives spend will drift from the chain and lie.
- **No business logic in the UI:** verdicts come from the gateway/verifier; the console only displays + dispatches CLI actions. It never signs, enforces, or computes a cap.
- **Type-driven:** generate the console's types from the Rust types (`Receipt`, treasury `Verdict`) so a field rename breaks the build, not the dashboard silently. Do **not** carry `render.sh`'s JSON-grep forward.
- **Verify before display:** unverified receipts are never rendered as fact.

## Done-when (acceptance)
- [ ] A non-builder caps an agent, watches spend climb across rails, clicks revoke, sees the next call clawed back, and runs the independent verify — without a terminal.
- [ ] Every displayed number traces to a structured engine output; the UI computes none.

## Dependencies
- **Blocks:** AGENT-6 (5 teams). **Blocked by:** M1 (receipts/verdicts), M2 (the `audit` it surfaces), M3/M4 (multi-rail + tree to display).
