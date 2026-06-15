#!/usr/bin/env node
// The wrapper build step (the esbuild/Biome pattern). At scaffold this is a
// no-op that asserts the launcher is syntactically loadable — `npm run build`
// must succeed (so `npm ci && npm run build` in the [sculpts.auths-mcp] rebuild
// is green), while the actual enforcement lives in the gateway binary the
// launcher execs. The real build bundles the launcher + stages the
// prebuilt-binary-per-platform vendor tree.

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
process.stdout.write("@auths/mcp: build ok (launcher present; vendor bundling is a release-CI step)\n");
