#!/usr/bin/env node
// live-wire-cap-check.mjs — prove the cross-rail cap cannot be skipped by omitting the spend amount.
//
// With an operator-declared rail (--rail x402), EVERY call is metered. A call that declares no
// amount cannot be bounded before the rail is touched, so the gateway must REFUSE it fail-closed —
// otherwise an agent could omit the amount, let the rail charge, and never advance the durable cap.
// This drives both halves through the live wire (hermetic, no money): an undeclared metered call is
// refused, and a declared one settles and advances the cap.

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const GATEWAY_BIN =
  process.env.GATEWAY_BIN ||
  join(REPO, "..", "auths", "target", "release", "auths-mcp-gateway");
const STUB = join(HERE, "paid-stub.mjs");

function fail(msg) {
  console.error(`✗ live-wire-cap RED — ${msg}`);
  process.exit(1);
}
function ok(msg) {
  console.log(`✓ ${msg}`);
}

if (!existsSync(GATEWAY_BIN)) fail(`gateway binary missing: ${GATEWAY_BIN} (build --release first)`);

const SCRATCH = mkdtempSync(join(tmpdir(), "auths-mcp-cap-"));
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
  AUTHS_PASSPHRASE: "Mcp-Cap-Chk!",
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
  ["wrap", "--test-mode", "--rail", "x402", "--scope", "paid.call", "--budget", "$5", "--", "node", STUB],
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
    gw.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
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
  ok("gateway serving — x402 rail wrapped, $5 cap");

  const initResp = await request(1, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "live-wire-cap-check", version: "0.1.0" },
  });
  if (initResp.error) fail(`initialize failed: ${JSON.stringify(initResp.error)}`);
  gw.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  // 1. The bypass attempt: a metered call that DECLARES NO amount. The gate cannot bound it before
  //    the rail is touched, so it must be refused — never forwarded, never charged.
  const bypass = await request(2, "tools/call", {
    name: "paid_call",
    arguments: { network: "base-sepolia" },
  });
  if (!bypass.error)
    fail(`a metered call with no amount was ALLOWED — the cap bypass is open: ${JSON.stringify(bypass.result)}`);
  if (!/metered-amount-required/.test(JSON.stringify(bypass.error)))
    fail(`metered call with no amount was refused, but not for the right reason: ${JSON.stringify(bypass.error)}`);
  ok("undeclared metered call → REFUSED (metered-amount-required) — the rail was never touched");

  // 2. The legitimate call: it DECLARES its amount, so the gate reserves it, the rail settles, and
  //    the durable cap advances by the actual charge read from the rail response.
  const paid = await request(3, "tools/call", {
    name: "paid_call",
    arguments: { amount_atomic: 1500000, network: "base-sepolia" },
  });
  if (paid.error) fail(`declared metered call was refused (should be allowed): ${JSON.stringify(paid.error)}`);
  ok("declared metered call → allowed + settled");

  gw.stdin.end();
  await new Promise((r) => gw.on("exit", r));

  // The audit re-derives the spend offline: the refused bypass contributed nothing, and ONLY the
  // declared call advanced the cap — by the $1.50 the rail's own response reported.
  const m = stderrBuf.match(/verify-spend-cmd:\s*verify-spend\s+(.+)$/m);
  if (!m) fail(`gateway did not print a verify-spend command:\n${stderrBuf}`);
  const args = ["verify-spend", ...m[1].trim().split(/\s+/)];
  const vs = spawnSync(GATEWAY_BIN, args, { env, encoding: "utf8" });
  const vsOut = (vs.stdout || "") + (vs.stderr || "");
  if (!/verify-spend: consistent\b/.test(vsOut) || !/\$1\.50/.test(vsOut))
    fail(`the cap log did NOT re-verify as consistent with exactly the $1.50 declared spend:\n${vsOut}`);
  ok("verify-spend GREEN — only the declared $1.50 advanced the cap; the bypass settled nothing");

  // The durable counter the wire advanced must be the SAME one the printed verify-spend args
  // resolve to: derive the ledger path from the command's own --registry/--agent (exactly as the
  // audit does via CounterRef::for_agent) and assert the wire wrote the $1.50 high-water THERE.
  const registry = args[args.indexOf("--registry") + 1];
  const agent = args[args.indexOf("--agent") + 1];
  const counterPath = join(registry, "budget-ledger", `${agent.replace(/^did:keri:/, "")}.json`);
  if (!existsSync(counterPath))
    fail(`the wire advanced no counter at the location verify-spend resolves to: ${counterPath}`);
  const counter = JSON.parse(readFileSync(counterPath, "utf8"));
  if (counter.settled_high_water_cents !== 150)
    fail(`the counter verify-spend resolves to does not hold the settled $1.50 (got ${counter.settled_high_water_cents}c): ${counterPath}`);
  ok("durable counter located — verify-spend's --registry/--agent open the SAME counter the wire advanced ($1.50)");

  console.log(
    "✓ live-wire-cap check GREEN — an omitted spend amount cannot skip the cross-rail cap",
  );
  process.exit(0);
}

main().catch((e) => fail(e.message));
