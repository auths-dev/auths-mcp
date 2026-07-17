# @auths-dev/mcp — the bounded-agent MCP gateway

> Prepend `auths wrap …` to any MCP server and a live agent's tool calls are
> bounded to a **scope**, a **budget**, and a **TTL** by cryptographic delegation —
> enforced per `tools/call`, offline, from the signed chain. When the model itself
> decides to exceed its scope, overspend its budget, or keep working after it's been
> revoked, the gateway refuses the call at the protocol boundary, with a distinct
> verdict, and leaves a verifiable receipt.

This is the thin npm/distribution repo: the launcher, per-client config glue,
examples, and the install-and-wrap smoke. **The engine is Rust crates in the
`auths` monorepo** (`auths-mcp-core` + `auths-mcp-gateway`) — so you get a one-line
install with no toolchain.

## Install (the one line)

```jsonc
// in your MCP client config — wrap a server line you already have
"filesystem": {
  "command": "npx",
  "args": ["-y", "@auths-dev/mcp", "wrap", "--scope", "fs.read", "--budget", "$5", "--ttl", "30m",
           "--", "npx", "-y", "@modelcontextprotocol/server-filesystem", "/Users/me/proj"]
}
```

`brew install auths-mcp` and `uvx auths-mcp` are fast-follows.

## How it works

The launcher (`packages/auths-mcp/`) resolves the prebuilt `auths-mcp-gateway`
binary for your platform and execs it. The gateway speaks stock MCP up to the agent
and down to the real downstream server; on each `tools/call` it canonicalizes +
signs the call, runs the per-call gate (`scope ⊆ parent · budget · expiry ·
revocation`), forwards only on pass, and emits a signed receipt either way. A
non-auths client still works (unauthenticated, no receipt) so adoption is
incremental.

## Status

**Working — gateway built, `./run.sh --check` GREEN.** The bounded-agent gateway is
real (`auths-mcp-{core,gateway,server}` in the `auths` monorepo):

- `./run.sh --check` (the install-and-wrap smoke / the federated gate) **passes**: it
  resolves the launcher, the launcher resolves the prebuilt gateway binary, and the
  gateway is driven in replay mode over a frozen transcript — re-deriving each call's
  verdict from the signed chain and exiting non-zero on ANY divergence (no fake
  `exit 0`). It resolves the gateway the way a user's `npx` run does: a locally built
  `../auths/target/release` binary if present, else the npm-vendored
  `vendor/<platform>/` tree.
- **Distribution**: `.github/workflows/release.yml` vendors `auths-mcp-gateway` (plus
  the `auths` CLI and `auths-sign`, which the wrap path shells to build the delegation
  chain) for `linux-x64`, `linux-arm64`, and `darwin-arm64` from a pinned,
  SHA256-verified `auths` monorepo release, re-runs the full smoke against that exact
  tree, and publishes `@auths-dev/mcp` (dispatch-only, dry-run by default). It fails
  closed on any release older than the first one that ships the gateway in its
  tarballs (v0.1.3 does not).
- The scenario configs in `examples/scenarios/` and the transcript in `examples/replay/`
  drive that gate; the payment adapters in `examples/payments/` are built (hermetic path
  green; the live x402 settle is pending the EIP-3009 rewrite — see `docs/plans/`).

## Layout

```
packages/auths-mcp/   the @auths-dev/mcp launcher (prebuilt-binary-per-platform)
clients/              config glue: Claude Desktop / Claude Code / Cursor / Codex
examples/             live show + --check replay (the probe) + 3 scenario configs
run.sh                the install-and-wrap smoke = the federated gate
```
