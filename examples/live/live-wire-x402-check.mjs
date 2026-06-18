#!/usr/bin/env node
// live-wire-x402-check.mjs — prove the METERED live-wire path end-to-end, hermetically (no money).
//
// Wraps a paid stub downstream that returns a recorded x402 SettlementResponse, drives one metered
// paid_call through the gateway, and asserts: the call is allowed, the gateway extracted the cost
// from the rail's OWN response (not a declared number), signed a settlement bound to the call, and
// the written log re-verifies offline as consistent WITH a real signed settlement. Swap the stub for
// the real x402 adapter (and a funded wallet) to settle on base-sepolia for real — the gateway path
// is identical.

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, existsSync } from "node:fs";
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
  console.error(`✗ live-wire-x402 RED — ${msg}`);
  process.exit(1);
}
function ok(msg) {
  console.log(`✓ ${msg}`);
}

if (!existsSync(GATEWAY_BIN)) fail(`gateway binary missing: ${GATEWAY_BIN} (build --release first)`);

const SCRATCH = mkdtempSync(join(tmpdir(), "auths-mcp-x402-"));
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
  AUTHS_PASSPHRASE: "Mcp-X402-Chk!",
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
  ok("gateway serving — chain built, live-wire signing ON, x402 rail wrapped");

  const initResp = await request(1, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "live-wire-x402-check", version: "0.1.0" },
  });
  if (initResp.error) fail(`initialize failed: ${JSON.stringify(initResp.error)}`);
  gw.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  // A metered paid_call. The OPERATOR declared the rail (--rail x402), so the agent sends only the
  // real payment arg; the gateway reserves amount_atomic→cents and SETTLES the amount read from the
  // rail's own response (maxAmountRequired = 150 cents) — the agent cannot bypass or under-settle.
  const payResp = await request(2, "tools/call", {
    name: "paid_call",
    arguments: {
      amount_atomic: 1500000,
      network: "base-sepolia",
    },
  });
  if (payResp.error) fail(`metered paid_call was refused (should be allowed): ${JSON.stringify(payResp.error)}`);
  const text = payResp.result?.content?.[0]?.text ?? "";
  if (!/0x1234567890abcdef/.test(text))
    fail(`paid_call result did not carry the settlement tx (rail response missing): ${text}`);
  ok("metered paid_call → allowed; gateway extracted the cost from the rail response + signed a settlement");

  gw.stdin.end();
  await new Promise((r) => gw.on("exit", r));

  const m = stderrBuf.match(/verify-spend-cmd:\s*verify-spend\s+(.+)$/m);
  if (!m) fail(`gateway did not print a verify-spend command:\n${stderrBuf}`);
  const args = ["verify-spend", ...m[1].trim().split(/\s+/)];
  const vs = spawnSync(GATEWAY_BIN, args, { env, encoding: "utf8" });
  const vsOut = (vs.stdout || "") + (vs.stderr || "");
  // The audit must be consistent AND have summed the AGENT-SIGNED $1.50 from the settlement.
  if (!/verify-spend: consistent\b/.test(vsOut) || !/\$1\.50/.test(vsOut))
    fail(`the live metered log did NOT re-verify as consistent with the signed $1.50:\n${vsOut}`);
  ok("verify-spend GREEN — the agent-signed $1.50 settlement re-verified offline as consistent");
  console.log(
    "✓ live-wire-x402 check GREEN — a metered call was signed + gated + settled + audited end-to-end (hermetic)",
  );
  process.exit(0);
}

main().catch((e) => fail(e.message));
