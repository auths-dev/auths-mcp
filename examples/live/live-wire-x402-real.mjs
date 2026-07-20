#!/usr/bin/env node
// live-wire-x402-real.mjs — a REAL base-sepolia USDC settle THROUGH the live wire.
//
// Wraps the real x402 adapter as the downstream, with the funded testnet wallet + facilitator
// custody-injected by the gateway (the agent NEVER sees them), drives ONE 1-cent paid_call, captures
// the on-chain tx hash, and re-verifies the signed settlement offline. Real testnet money — run only
// with the wallet you funded. PARK-DON'T-FAKE: if the facilitator/wallet errors, this prints the
// error and exits non-zero; it NEVER fabricates a tx hash or a green.
//
// Run:  set -a; . ../../../auths/.env; set +a
//       GATEWAY_BIN=../../../auths/target/release/auths-mcp-gateway node examples/live/live-wire-x402-real.mjs

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
// Resolve to an ABSOLUTE path: the gateway derives the `auths` signing binary from this directory
// and spawns it while serving, so a CWD-relative override would not resolve from the gateway's
// working directory.
const GATEWAY_BIN = resolve(
  process.env.GATEWAY_BIN ||
    join(REPO, "..", "auths", "target", "release", "auths-mcp-gateway"),
);
const X402_SERVER = join(REPO, "examples", "payments", "adapters", "x402-adapter", "server.mjs");

function fail(msg) {
  console.error(`✗ live-wire-x402-REAL ${msg}`);
  process.exit(1);
}
function ok(msg) {
  console.log(`✓ ${msg}`);
}

if (!existsSync(GATEWAY_BIN)) fail(`PARK — gateway binary missing: ${GATEWAY_BIN}`);
if (!existsSync(X402_SERVER)) fail(`PARK — x402 adapter missing: ${X402_SERVER}`);
// Require the wallet + facilitator in the env (the caller sourced auths/.env). Names only.
for (const v of ["X402_WALLET_PRIVATE_KEY", "X402_FACILITATOR_URL"]) {
  if (!process.env[v]) fail(`PARK — ${v} not in env (run: set -a; . auths/.env; set +a)`);
}

const SCRATCH = mkdtempSync(join(tmpdir(), "auths-mcp-x402-real-"));
const LIVE = join(SCRATCH, "live");
const HOME = join(SCRATCH, "home");
const REGISTRY = join(SCRATCH, "registry");
for (const d of [LIVE, HOME, REGISTRY]) mkdirSync(d, { recursive: true });

const gwDir = dirname(GATEWAY_BIN);
const env = {
  ...process.env, // carries the X402_* wallet/facilitator the gateway custody-injects to the downstream
  HOME,
  AUTHS_HOME: REGISTRY,
  AUTHS_REPO: REGISTRY,
  AUTHS_KEYCHAIN_BACKEND: "file",
  AUTHS_KEYCHAIN_FILE: join(SCRATCH, "keys.enc"),
  AUTHS_PASSPHRASE: "Mcp-X402-Real!",
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

// --test-mode targets base-SEPOLIA (the TESTNET the wallet is funded on) — NOT mainnet. The settle is
// still a REAL on-chain testnet tx. The gateway CUSTODIES the wallet key + facilitator
// (`--custody-credential`, by NAME — the value is read from the gateway's own env, set from
// auths/.env) and injects them into the spawned downstream, so the operator-held wallet reaches the
// adapter WITHOUT ever crossing the agent-facing MCP wire — the agent connects with only its
// delegation, never the key. The x402 adapter is a long-lived MCP server: the gateway serves the
// live wire with the credential injected into the served child (no one-shot preflight).
const gw = spawn(
  GATEWAY_BIN,
  [
    "wrap",
    "--test-mode",
    "--rail", "x402",
    "--scope", "paid.call",
    "--budget", "$5",
    "--custody-credential", "X402_WALLET_PRIVATE_KEY",
    "--custody-credential", "X402_FACILITATOR_URL",
    "--", "node", X402_SERVER,
  ],
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

function request(id, method, params, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`PARK — timeout waiting for ${method} (the on-chain settle may be slow/unavailable)`));
    }, timeoutMs);
    pending.set(id, (msg) => {
      clearTimeout(t);
      resolve(msg);
    });
    gw.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

async function waitForServing(timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (stderrBuf.includes("live-wire signing ON")) return;
    if (gw.exitCode !== null)
      throw new Error(`PARK — gateway exited early (code ${gw.exitCode}):\n${stderrBuf}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`PARK — gateway did not start serving within ${timeoutMs}ms:\n${stderrBuf}`);
}

async function main() {
  await waitForServing();
  ok("gateway serving — chain built, live-wire signing ON, REAL x402 rail wrapped (wallet custodied)");

  const initResp = await request(1, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "live-wire-x402-real", version: "0.1.0" },
  });
  if (initResp.error) fail(`PARK — initialize failed: ${JSON.stringify(initResp.error)}`);
  gw.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  // ONE real 1-cent settle: 10000 atomic USDC = $0.01 (the minimum exact-cent rail::extract accepts).
  const payResp = await request(2, "tools/call", {
    name: "paid_call",
    arguments: { amount_atomic: 10000, network: "base-sepolia" },
  });
  if (payResp.error) fail(`PARK — the real settle failed (not faked): ${JSON.stringify(payResp.error)}`);
  const text = payResp.result?.content?.[0]?.text ?? "";
  let tx = null;
  try {
    tx = JSON.parse(text)?.settlement?.transaction ?? null;
  } catch {
    /* fall through */
  }
  if (!tx || !/^0x[0-9a-fA-F]{64}$/.test(tx))
    fail(`PARK — no on-chain tx hash in the settlement response (the live settle did not complete): ${text.slice(0, 400)}`);
  ok(`REAL base-sepolia settle landed — on-chain tx ${tx}`);

  gw.stdin.end();
  await new Promise((r) => gw.on("exit", r));

  const m = stderrBuf.match(/verify-spend-cmd:\s*verify-spend\s+(.+)$/m);
  if (!m) fail(`PARK — gateway did not print a verify-spend command:\n${stderrBuf}`);
  const args = ["verify-spend", ...m[1].trim().split(/\s+/)];
  const vs = spawnSync(GATEWAY_BIN, args, { env, encoding: "utf8" });
  const vsOut = (vs.stdout || "") + (vs.stderr || "");
  if (!/verify-spend: (self-)?consistent\b/.test(vsOut))
    fail(`PARK — the real settle log did NOT re-verify as consistent:\n${vsOut}`);
  ok("verify-spend GREEN — the real agent-signed settlement re-verified offline as consistent");
  console.log(`\nREAL_TX_HASH=${tx}`);
  console.log("✓ live-wire-x402-REAL GREEN — a real base-sepolia settle was signed + gated + settled + audited through the live wire");
  process.exit(0);
}

main().catch((e) => fail(e.message));
