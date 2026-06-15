#!/usr/bin/env node
// @auths/mcp launcher — the one line a user installs.
//
// `npx -y @auths/mcp wrap --scope fs.read --budget '$5' --ttl 30m -- <downstream>`
// resolves the prebuilt `auths-mcp-gateway` binary for this platform and execs it,
// forwarding every argument and the stdio (MCP speaks JSON-RPC over stdio). There
// is no Rust toolchain on the user's machine — the binary is cross-compiled by the
// auths monorepo's release CI and shipped inside this package per platform.
//
// STATUS: scaffold. The prebuilt-binary-per-platform fetch/bundle is not wired yet;
// `resolveGateway()` looks for a locally staged binary (what the smoke stages) and
// exits non-zero with a clear message if none is found — never a fake success.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// Where the gateway binary is looked up, in priority order:
//   1. GATEWAY_BIN env override (the smoke / a dev points this at a fresh build).
//   2. packages/auths-mcp/vendor/<platform>/auths-mcp-gateway (the shipped prebuilt
//      binary — not present at scaffold; the release CI populates it).
function resolveGateway() {
  const override = process.env.GATEWAY_BIN;
  if (override && existsSync(override)) return override;

  const platform = `${process.platform}-${process.arch}`;
  const vendored = join(HERE, "..", "vendor", platform, "auths-mcp-gateway");
  if (existsSync(vendored)) return vendored;

  return null;
}

function main() {
  const gateway = resolveGateway();
  if (!gateway) {
    process.stderr.write(
      "@auths/mcp: no auths-mcp-gateway binary for this platform yet.\n" +
        "  The prebuilt-binary-per-platform bundle is not built — set GATEWAY_BIN to a\n" +
        "  freshly built `target/release/auths-mcp-gateway`, or wait for the release CI.\n",
    );
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const res = spawnSync(gateway, args, { stdio: "inherit" });
  if (res.error) {
    process.stderr.write(`@auths/mcp: failed to exec gateway: ${res.error.message}\n`);
    process.exit(1);
  }
  process.exit(res.status ?? 1);
}

main();
