# Milestone 7 — Distribution + onboarding

> **Goal.** A stranger goes from zero to a bounded live agent in <10 minutes, on a clean machine, in their own client.
> **Strategy.** The wedge is a single install or it isn't a wedge.
> **Status today.** The launcher already expects a vendored binary; the release pipeline that fills that path doesn't exist yet, and the docs/README are stale.

## Why
The differentiation is worthless if installing it is a toolchain quest. The whole adoption thesis is "prepend one line." That requires prebuilt binaries, verified client config, and docs that match reality.

## Baseline — what already exists
- **Resolution:** `auths-mcp/packages/auths-mcp/bin/auths-mcp.mjs::resolveGateway()` — `GATEWAY_BIN` override → `vendor/<platform>/auths-mcp-gateway`. The only resolution logic; keep it that way.
- **Package:** `package.json` `bin: { "auths-mcp": … }`, zero deps; `build.mjs` is a no-op today.
- **Docs:** `docs/` (walkthrough, payment-providers/{stripe,x402}, ai-providers/anthropic) — real-money default, test-mode opt-in, mandatory cap.

## Where the work lands
| Epic | Repo | Path |
|---|---|---|
| 7.1 Release CI | `auths` → `auths-mcp` | gateway cross-compile; `packages/auths-mcp/build.mjs`, `vendor/<platform>/`; npm publish |
| 7.2 brew + uvx | `auths-mcp` | packaging |
| 7.3 Client glue verified | `auths-mcp` | `clients/` |
| 7.4 Onboarding docs | `auths-mcp` | `docs/`, `README.md` |

## Epics & subtasks
### 7.1 — Release CI · `auths` → `auths-mcp`
- Cross-compile `auths-mcp-gateway` for darwin-arm64/x64 + linux-x64 (from `../auths`).
- `build.mjs` bundles each into `packages/auths-mcp/vendor/<platform>/auths-mcp-gateway`.
- Publish `@auths/mcp` to npm; smoke `npx @auths/mcp wrap` on a clean machine.

### 7.2 — brew + uvx · `auths-mcp`
- The `brew install auths-mcp` + `uvx auths-mcp` fast-follows the README already promises.

### 7.3 — Client glue verified · `auths-mcp/clients/`
- M1.3's `mcp.json` for Claude Desktop / Code / Cursor / Codex, verified on a clean machine.

### 7.4 — Onboarding docs · `auths-mcp/docs/`
- 5-minute quickstart + real-money opt-in + troubleshooting; the README matches the gate (M1.4).

## Grounded sketch — fill the path the launcher already resolves
```js
// build.mjs (today a no-op) → produce the SINGLE layout resolveGateway() expects.
for (const t of TARGETS) {                         // darwin-arm64, darwin-x64, linux-x64, …
  await crossCompile("auths-mcp-gateway", t.rustTriple);                 // one crate, from ../auths
  copy(out, `packages/auths-mcp/vendor/${t.platform}/auths-mcp-gateway`); // launcher finds it, no logic
}
```

## Rigor — don't be sloppy
- **DRY pipeline:** one build produces all platform binaries from the single `auths-mcp-gateway` crate; `resolveGateway()` (env override → vendored) stays the **only** resolution logic — no per-platform branching in the shim.
- **Dumb shim, typed engine:** the `.mjs` launcher is pass-through only. A behavior that needs fixing belongs in the Rust gateway, never the JS.
- **Reproducible + pinned:** pinned toolchain, reproducible builds, **checksum** the vendored binaries, **no secrets** in the published tarball.
- **Docs match the gate:** a stale "scaffold" line on a working product is an adoption bug — the published README is part of the deliverable.

## Done-when (acceptance)
- [ ] `npx @auths/mcp …` works on a clean machine with no `GATEWAY_BIN`, on macOS + Linux.
- [ ] `brew` + `uvx` install paths work.
- [ ] Verified `mcp.json` for the four clients.
- [ ] 5-minute quickstart lands a bounded live agent; README is accurate.

## Dependencies
- **Blocks:** AGENT-6 (5 teams), Demo suite (M8). **Blocked by:** M1 (the binary to vendor).
