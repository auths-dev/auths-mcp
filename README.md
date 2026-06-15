# @auths/mcp — the bounded-agent MCP gateway

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
  "args": ["-y", "@auths/mcp", "wrap", "--scope", "fs.read", "--budget", "$5", "--ttl", "30m",
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

**Scaffold.** The product isn't built yet:

- `./run.sh --check` (the install-and-wrap smoke / the federated gate) is a **real
  check that currently exits non-zero** — it resolves the launcher, the launcher
  resolves a gateway binary, and the gateway is driven in replay mode over a frozen
  transcript. Every step fails today because the gateway is a stub. It goes green
  once the wrapper + gateway work. There is no fake `exit 0`.
- The three scenario configs in `examples/scenarios/` and the recorded transcript
  in `examples/replay/` are placeholders pinned during the burndown.

## Layout

```
packages/auths-mcp/   the @auths/mcp launcher (prebuilt-binary-per-platform)
clients/              config glue: Claude Desktop / Claude Code / Cursor / Codex
examples/             live show + --check replay (the probe) + 3 scenario configs
run.sh                the install-and-wrap smoke = the federated gate
```
