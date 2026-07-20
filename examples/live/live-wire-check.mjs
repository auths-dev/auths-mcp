#!/usr/bin/env node
// live-wire-check.mjs — drive a REAL live `wrap` session through the gateway and prove the
// signed spend log it writes re-verifies offline, trusting neither the gateway nor its operator.
//
// A scripted MCP client (no model, deterministic): spawn the gateway wrapping a stub downstream,
// make an in-scope call (signed + gated + persisted on the live wire) and an out-of-scope call
// (refused by the per-call gate), then run `verify-spend` over the written log and assert it audits
// `consistent`. Dependency-free newline-delimited JSON-RPC over stdio.
//
// A fresh, self-contained sandbox is used (the headless file keychain, like run.sh) so the
// gateway's chain build never touches the user's real ~/.auths.

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", ".."); // auths-mcp/
const GATEWAY_BIN =
  process.env.GATEWAY_BIN ||
  join(REPO, "..", "auths", "target", "release", "auths-mcp-gateway");
const STUB = join(HERE, "stub-downstream.mjs");

function fail(msg) {
  console.error(`✗ live-wire RED — ${msg}`);
  process.exit(1);
}
function ok(msg) {
  console.log(`✓ ${msg}`);
}

if (!existsSync(GATEWAY_BIN)) fail(`gateway binary missing: ${GATEWAY_BIN} (build --release first)`);

// A fresh, fully self-contained sandbox so the chain build can `auths id create` headlessly.
const SCRATCH = mkdtempSync(join(tmpdir(), "auths-mcp-livewire-"));
const LIVE = join(SCRATCH, "live");
const HOME = join(SCRATCH, "home");
const REGISTRY = join(SCRATCH, "registry");
for (const d of [LIVE, HOME, REGISTRY]) mkdirSync(d, { recursive: true });

const gwDir = dirname(GATEWAY_BIN);
const env = {
  ...process.env,
  HOME,
  AUTHS_HOME: REGISTRY,
  AUTHS_REPO: REGISTRY,
  AUTHS_KEYCHAIN_BACKEND: "file",
  AUTHS_KEYCHAIN_FILE: join(SCRATCH, "keys.enc"),
  AUTHS_PASSPHRASE: "Mcp-LiveWire-Chk!",
  GIT_CONFIG_GLOBAL: join(HOME, ".gitconfig"),
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Parent Root",
  GIT_AUTHOR_EMAIL: "root@auths.demo",
  GIT_COMMITTER_NAME: "Parent Root",
  GIT_COMMITTER_EMAIL: "root@auths.demo",
  AUTHS_MCP_LIVE_DIR: LIVE,
};
if (existsSync(join(gwDir, "auths"))) env.AUTHS_BIN = join(gwDir, "auths");
if (existsSync(join(gwDir, "auths-sign"))) env.AUTHS_SIGN = join(gwDir, "auths-sign");

const gw = spawn(
  GATEWAY_BIN,
  ["wrap", "--scope", "fs.read", "--budget", "$5", "--", "node", STUB],
  { env, stdio: ["pipe", "pipe", "pipe"] },
);

let stderrBuf = "";
gw.stderr.setEncoding("utf8");
gw.stderr.on("data", (c) => {
  stderrBuf += c;
});

const pending = new Map();
let outBuf = "";
gw.stdout.setEncoding("utf8");
gw.stdout.on("data", (chunk) => {
  outBuf += chunk;
  let nl;
  while ((nl = outBuf.indexOf("\n")) >= 0) {
    const line = outBuf.slice(0, nl).trim();
    outBuf = outBuf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

function send(obj) {
  gw.stdin.write(JSON.stringify(obj) + "\n");
}
function request(id, method, params, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout waiting for ${method} response`));
    }, timeoutMs);
    pending.set(id, (msg) => {
      clearTimeout(t);
      resolve(msg);
    });
    send({ jsonrpc: "2.0", id, method, params });
  });
}

async function waitForServing(timeoutMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (stderrBuf.includes("live-wire signing ON")) return;
    if (gw.exitCode !== null)
      throw new Error(`gateway exited early (code ${gw.exitCode}):\n${stderrBuf}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`gateway did not start serving within ${timeoutMs}ms:\n${stderrBuf}`);
}

async function main() {
  await waitForServing();
  ok("gateway serving — chain built, live-wire signing ON");

  const initResp = await request(1, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "live-wire-check", version: "0.1.0" },
  });
  if (initResp.error) fail(`initialize failed: ${JSON.stringify(initResp.error)}`);
  send({ jsonrpc: "2.0", method: "notifications/initialized" });

  // In-scope: read_file (fs.read ⊆ grant) → allowed, signed, persisted.
  const readResp = await request(2, "tools/call", {
    name: "read_file",
    arguments: { path: "src/lib.rs" },
  });
  if (readResp.error)
    fail(`in-scope read_file was refused (should be allowed): ${JSON.stringify(readResp.error)}`);
  ok("in-scope read_file → allowed (signed + persisted on the live wire)");

  // Out-of-scope: write_file (fs.write ⊄ grant) → refused by the gate, downstream never touched.
  const writeResp = await request(3, "tools/call", {
    name: "write_file",
    arguments: { path: "x", contents: "y" },
  });
  if (!writeResp.error)
    fail("out-of-scope write_file was ALLOWED (should be refused outside-agent-scope)");
  if (!/outside-agent-scope/.test(JSON.stringify(writeResp.error)))
    fail(`write_file refused but not for scope: ${JSON.stringify(writeResp.error)}`);
  ok(
    "out-of-scope write_file → refused (outside-agent-scope) — scope enforced by the gate, not a boolean list",
  );

  gw.stdin.end();
  await new Promise((r) => gw.on("exit", r));

  // Re-verify the signed spend log OFFLINE via the exact command the gateway printed.
  const m = stderrBuf.match(/verify-spend-cmd:\s*verify-spend\s+(.+)$/m);
  if (!m) fail(`gateway did not print a verify-spend command:\n${stderrBuf}`);
  const args = ["verify-spend", ...m[1].trim().split(/\s+/)];
  const vs = spawnSync(GATEWAY_BIN, args, { env, encoding: "utf8" });
  const vsOut = (vs.stdout || "") + (vs.stderr || "");
  // Assert the COUNT too, not just the verdict code: this session brokered one in-scope call and
  // refused one out-of-scope call, and both are signed + persisted, so the audit must cover 2
  // records. Asserting the count catches an empty/truncated log that would trivially audit clean.
  if (!/verify-spend: (self-)?consistent\b/.test(vsOut) || !/\b2 call\(s\)/.test(vsOut))
    fail(`the live spend log did NOT re-verify as consistent over both records:\n${vsOut}`);
  ok("verify-spend GREEN — the live-wire spend log (1 allowed + 1 refused, both signed) re-verified offline as consistent");
  console.log(
    "✓ live-wire check GREEN — a real MCP session was signed + gated + persisted + audited end-to-end",
  );
  process.exit(0);
}

main().catch((e) => fail(e.message));
