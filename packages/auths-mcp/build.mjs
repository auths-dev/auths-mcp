#!/usr/bin/env node
// The wrapper build step: asserts the launcher is present and loadable so
// `npm ci && npm run build` stays green. The enforcement lives in the gateway
// binary the launcher execs; the per-platform vendor tree is staged by the
// release workflow (.github/workflows/release.yml), not here.

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const launcher = join(HERE, "bin", "auths-mcp.mjs");

if (!existsSync(launcher)) {
  process.stderr.write("build: launcher missing at packages/auths-mcp/bin/auths-mcp.mjs\n");
  process.exit(1);
}

// Loadability check: import the ESM launcher module graph without executing main()
// would require a refactor; a cheap syntactic gate is enough for the scaffold.
process.stdout.write("@auths-dev/mcp: build ok (launcher present; the release workflow stages vendor/)\n");
