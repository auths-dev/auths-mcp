# Milestone 1 — Live wrap (real, not replay)

> **Goal.** One command bounds a *real* agent on a *stock* MCP server the author never wrote — and the four refusal verdicts fire **live**, not from a fixture.
> **Strategy.** The wedge's install surface (AGENT-1). One install or it isn't a wedge.
> **Status today.** The live path already exists; the gate is **green in replay**. Missing: the npm-vendored binary, a live model end-to-end, real client config, an honest README.
> **Gate.** Nothing blocks this; it's first.

## Why
Replay-green proves the codec. Adoption needs a stranger to run one line and watch a live agent get refused on a tool nobody adapted. The distance from "replay passes" to "a real Claude session is bounded" is **wiring + distribution, not new enforcement** — cheap, and it's the first user's first five minutes.

## Baseline — what already exists (do not rebuild)
- **Live proxy:** `auths/crates/auths-mcp-gateway/src/proxy.rs::run_wrap` + `call_tool` (≈425–499) — scope check → `enforce_wire_budget` → downstream forward → custody injection.
- **Launcher:** `auths-mcp/packages/auths-mcp/bin/auths-mcp.mjs::resolveGateway()` — `GATEWAY_BIN` env → `vendor/<platform>/auths-mcp-gateway`. Zero-dep pass-through shim.
- **Live driver:** `auths-mcp/examples/live/record.py` — a real `claude-opus-4-8` tool-loop that already emits the call schema; reuse its loop as the M1 driver.
- **Gate:** `run.sh --check` (replay) is green via `GATEWAY_BIN → ../auths/target/release/auths-mcp-gateway`.

## Where the work lands
| Epic | Repo | Path |
|---|---|---|
| 1.1 Vendor + install path | `auths-mcp` | `packages/auths-mcp/build.mjs`, `vendor/<platform>/` |
| 1.2 Live wrap end-to-end | `auths` + `auths-mcp` | `crates/auths-mcp-gateway/src/proxy.rs`, `examples/live/` |
| 1.3 Client glue | `auths-mcp` | `clients/` |
| 1.4 De-stale + honest gate | `auths-mcp` | `README.md`, `run.sh` |

## Epics & subtasks
### 1.1 — Vendor + real install path · `auths-mcp`
- Implement `packages/auths-mcp/build.mjs` (today a no-op): place the prebuilt `auths-mcp-gateway` per platform under `packages/auths-mcp/vendor/<platform>/`.
- Confirm `resolveGateway()` finds it with **no** `GATEWAY_BIN` set.
- `npx @auths/mcp wrap …` runs the vendored binary on a clean machine.

### 1.2 — Live wrap, real model, stock server · `auths` + `auths-mcp`
- Reuse `examples/live/record.py`'s tool-loop as a *driver* talking to a `wrap`-fronted stock server (`@modelcontextprotocol/server-filesystem` / `-github`).
- Confirm `Verdict::{OutsideAgentScope, UsageCapExceeded, Revoked, AgentExpired}` each fire **live** through `proxy.rs::call_tool`.
- Close any `run_wrap` gaps a real MCP client surfaces (init handshake, `tools/list` passthrough).

### 1.3 — Client config glue · `auths-mcp/clients/`
- Real, tested `mcp.json` drop-ins for Claude Desktop, Claude Code, Cursor, Codex (today only a README pattern).

### 1.4 — De-stale + honest gate · `auths-mcp`
- Fix README "Scaffold… exits non-zero"; document the two distinct facts (replay-green vs npm-vendored-pending).
- Replace `run.sh`'s `grep verdict.*<expected>` with a structured JSON assertion on the gateway's `Verdict`.

## Grounded sketch — one gate, both paths
```rust
// auths-mcp-core::gate — replay.rs AND proxy.rs call THIS. Never fork enforcement.
let decision = gate.judge(rail, reserve_ceiling_cents, &signed_proof, now, &mut budget).await?;
match decision.verdict {
    Verdict::Allowed => forward_downstream(req).await,  // live: proxy.rs   replay: assert == expect
    refused          => deny(refused),                  // same Verdict variant on both paths
}
```

## Rigor — don't be sloppy
- **DRY:** live and replay share one `PerCallGate::judge` and one `Verdict`. The day they diverge, what ships is no longer what `--check` tests.
- **Type-driven:** assert the structured `Verdict`, never a grepped substring — a string-scrape gate is a lie waiting to pass.
- **Dumb shim:** the `.mjs` launcher stays resolve + exec; zero enforcement logic in JS — all of it in the typed Rust gateway.
- **No fake green:** a missing binary or a diverged verdict fails closed.

## Done-when (acceptance)
- [ ] `npx @auths/mcp wrap --scope fs.read --budget $5 -- npx -y @modelcontextprotocol/server-filesystem .` runs with **no** `GATEWAY_BIN`.
- [ ] A live Claude session is refused `OutsideAgentScope` on `write_file` and `UsageCapExceeded` past $5 — live, no fixture.
- [ ] Tested `mcp.json` for ≥2 clients.
- [ ] README accurate; `run.sh --check` asserts structured verdicts.

## Dependencies
- **Blocks:** every other milestone (this is the live surface). **Blocked by:** none.
