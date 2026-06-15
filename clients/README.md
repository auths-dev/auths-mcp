# Client config glue

Drop-in snippets that prepend `auths wrap …` to an MCP server line in each
client's config — the whole adoption story is *editing one line you already have*
(PRD §10). Claude Desktop / Claude Code / Cursor / Codex.

> **Status: placeholders.** The per-client snippets are authored during the
> burndown once the `wrap` surface is real.

## The pattern (Claude Desktop / Claude Code `mcp.json`)

```json
"filesystem": {
  "command": "npx",
  "args": ["-y", "@auths/mcp", "wrap", "--scope", "fs.read", "--budget", "$5", "--ttl", "30m",
           "--", "npx", "-y", "@modelcontextprotocol/server-filesystem", "/Users/me/proj"]
}
```

`brew install auths-mcp` (persistent binary) and `uvx auths-mcp` (PyPI) are
fast-follows; the cross-compiled binaries come from the `auths` monorepo's release
CI and are referenced by this wrapper.
