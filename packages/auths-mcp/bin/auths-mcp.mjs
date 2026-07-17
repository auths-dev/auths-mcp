#!/usr/bin/env node
// @auths-dev/mcp launcher — the one line a user installs.
//
// `npx -y @auths-dev/mcp wrap --scope fs.read --budget '$5' --ttl 30m -- <downstream>`
// resolves the prebuilt `auths-mcp-gateway` binary for this platform and execs it,
// forwarding every argument and the stdio (MCP speaks JSON-RPC over stdio). No Rust
// toolchain on the user's machine: the release workflow vendors the gateway — plus
// the `auths` CLI and `auths-sign`, which the wrap path shells to build the
// delegation chain — under vendor/<platform>/ from a pinned, checksum-verified
// auths monorepo release (see .github/workflows/release.yml).
//
// If no binary exists for this platform, the launcher exits non-zero with a clear
// message — never a fake success.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// Where the gateway binary is looked up, in priority order:
//   1. GATEWAY_BIN env override (the smoke / a dev points this at a fresh build).
//   2. packages/auths-mcp/vendor/<platform>/auths-mcp-gateway (the shipped prebuilt
//      binary, staged by the release workflow).
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
      `@auths-dev/mcp: no auths-mcp-gateway binary for ${process.platform}-${process.arch}.\n` +
        "  Prebuilt binaries ship for linux-x64, linux-arm64, and darwin-arm64. On other\n" +
        "  platforms, build the gateway from source (github.com/auths-dev/auths) and set\n" +
        "  GATEWAY_BIN to the built `target/release/auths-mcp-gateway`.\n",
    );
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const res = spawnSync(gateway, args, { stdio: "inherit" });
  if (res.error) {
    process.stderr.write(`@auths-dev/mcp: failed to exec gateway: ${res.error.message}\n`);
    process.exit(1);
  }
  process.exit(res.status ?? 1);
}

main();
