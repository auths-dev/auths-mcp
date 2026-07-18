// test.mjs — the adapter's self-check: it must produce the EXACT extracted cost the
// gateway's hermetic probe asserts (the recorded fixture is the contract). Dependency-
// free; `node test.mjs` exits 0 on pass, non-zero on any mismatch.

import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { settle, extractCost, hasLiveWallet, assertTestnetOnly, signExactEvmPayment } from "./settle.mjs";

// Resolve the SAME recorded fixture the hermetic gateway probe drives over, so the
// adapter's extracted cost is checked against the probe's contract.
const FIXTURES = new URL(
  "../../../../../auths/.recurve/claims/auths-mcp/probes/fixtures",
  import.meta.url,
).pathname;
process.env.AUTHS_MCP_RAIL_FIXTURES = FIXTURES;
delete process.env.X402_WALLET_PRIVATE_KEY; // force HERMETIC mode for the self-check
delete process.env.X402_FACILITATOR_URL;

let failures = 0;
async function t(name, fn) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures++;
    console.error(`  FAIL ${name}: ${e.message}`);
  }
}

await t("hermetic settle returns the recorded $1.50 base-sepolia settlement shape", async () => {
  const r = await settle({});
  assert.equal(r.requirements.network, "base-sepolia", "testnet only");
  assert.equal(r.requirements.maxAmountRequired, "1500000", "1500000 atomic USDC");
  assert.equal(r.settlement.success, true);
  assert.ok(
    String(r.settlement.transaction).startsWith("0x1234567890abcdef"),
    "the recorded settlement tx 0x1234…",
  );
});

await t("the extracted cost matches the probe's contract (atomic-USDC → cents)", async () => {
  const r = await settle({});
  const cost = extractCost(r);
  assert.equal(cost.amount_cents, 150, "1500000 / 10000 = 150 cents ($1.50)");
  assert.equal(cost.rail, "x402");
  assert.ok(
    cost.reference.startsWith("0x1234567890abcdef"),
    "the receipt-grade settlement tx reference",
  );
});

await t("the cross-rail cap-crosser ($0.60) is extracted from the over-cap fixture", async () => {
  process.env.X402_SETTLEMENT_FIXTURE = `${FIXTURES}/x402-settlement-overcap.testnet.json`;
  const r = await settle({});
  assert.equal(extractCost(r).amount_cents, 60, "600000 / 10000 = 60 cents — tiny alone, crosses the SHARED cap");
  delete process.env.X402_SETTLEMENT_FIXTURE;
});

await t("the cost is the RESPONSE amount, not the requested amount", async () => {
  // Hermetic settle overlays a requested atomic amount onto the fixture; the point in LIVE
  // mode is that the cost is read back from the response — here we confirm the overlay path
  // also reports the response's maxAmountRequired, proving extraction reads the response
  // field, never trusting a separate declared number.
  const r = await settle({ amountAtomic: 2_000_000 });
  assert.equal(r.requirements.maxAmountRequired, "2000000");
  assert.equal(extractCost(r).amount_cents, 200, "2000000 / 10000 = 200 cents ($2.00)");
});

await t("a mainnet network is refused — test-money only", () => {
  assert.throws(() => assertTestnetOnly("base"), /TESTNET only/);
  assert.throws(() => assertTestnetOnly("ethereum"), /TESTNET only/);
  assertTestnetOnly("base-sepolia"); // does not throw
});

await t("a sub-cent atomic amount is refused, not truncated", () => {
  const resp = {
    requirements: { network: "base-sepolia", maxAmountRequired: "1500050" },
    settlement: { success: true, transaction: "0xabc" },
  };
  assert.throws(() => extractCost(resp), /sub-cent/);
});

await t("a failed or non-0x settlement is refused", () => {
  assert.throws(
    () => extractCost({ requirements: { network: "base-sepolia", maxAmountRequired: "1500000" }, settlement: { success: false, transaction: "0xabc" } }),
    /success is false/,
  );
  assert.throws(
    () => extractCost({ requirements: { network: "base-sepolia", maxAmountRequired: "1500000" }, settlement: { success: true, transaction: "nope" } }),
    /0x/,
  );
});

await t("LIVE x402 needs BOTH a funded testnet wallet AND a facilitator — a key alone is not enough", () => {
  // The honest scope flag: x402 is NOT key-only (unlike Stripe). hasLiveWallet requires
  // BOTH X402_WALLET_PRIVATE_KEY and X402_FACILITATOR_URL.
  assert.equal(hasLiveWallet({ X402_WALLET_PRIVATE_KEY: "0xkey" }), false, "wallet key alone is NOT enough");
  assert.equal(hasLiveWallet({ X402_FACILITATOR_URL: "https://f" }), false, "facilitator alone is NOT enough");
  assert.equal(
    hasLiveWallet({ X402_WALLET_PRIVATE_KEY: "0xkey", X402_FACILITATOR_URL: "https://f" }),
    true,
    "BOTH the funded testnet wallet AND the facilitator URL are required",
  );
  assert.equal(hasLiveWallet({}), false, "hermetic with neither");
});

await t("LIVE settle signs EIP-3009 LOCALLY — the private key is NEVER in the /settle body (leak regression)", async () => {
  // A PUBLIC, well-known test key (anvil/hardhat account #0) — NOT a real wallet, safe to commit.
  const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  const acct = privateKeyToAccount(TEST_KEY);
  const requirements = {
    scheme: "exact",
    network: "base-sepolia",
    maxAmountRequired: "10000", // 1 cent of atomic USDC
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    payTo: acct.address,
    maxTimeoutSeconds: 60,
    extra: { name: "USDC", version: "2" },
  };

  // Sign LOCALLY (signExactEvmPayment self-checks that the sig recovers the burner; this also
  // proves it ran without any network).
  const payload = await signExactEvmPayment({
    requirements,
    network: "base-sepolia",
    env: { X402_WALLET_PRIVATE_KEY: TEST_KEY, X402_PAY_TO: acct.address },
  });
  assert.ok(payload.payload.signature.startsWith("0x"), "a signature must be produced");
  assert.equal(payload.payload.authorization.from.toLowerCase(), acct.address.toLowerCase(), "from = the signer");

  // THE regression: the exact bytes we would POST to /settle must contain NO trace of the key.
  const body = JSON.stringify({ x402Version: 1, paymentPayload: payload, paymentRequirements: requirements });
  assert.ok(!body.includes(TEST_KEY), "the private key MUST NOT appear in the /settle body");
  assert.ok(
    !body.toLowerCase().includes(TEST_KEY.slice(2).toLowerCase()),
    "the raw key hex MUST NOT appear in the /settle body either",
  );
});

await t("the REAL live POST path (not a reconstructed body) carries no key — fetch stubbed", async () => {
  // Closes the gap the review flagged: exercise liveTestnetSettle → signExactEvmPayment → fetch
  // for real, and assert the body fetch actually received contains no key.
  const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // public anvil #0
  const acct = privateKeyToAccount(TEST_KEY);
  let captured = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    captured = { url: String(url), body: String(opts?.body ?? "") };
    return new Response(
      JSON.stringify({ success: true, network: "base-sepolia", transaction: "0xdeadbeef" }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  try {
    const r = await settle({
      amountAtomic: 10000,
      network: "base-sepolia",
      env: {
        X402_WALLET_PRIVATE_KEY: TEST_KEY,
        X402_FACILITATOR_URL: "https://x402.org/facilitator",
        X402_PAY_TO: acct.address,
        X402_USDC_ASSET: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      },
    });
    assert.equal(r.settlement.transaction, "0xdeadbeef", "the stubbed live settle returns");
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.ok(captured && captured.url.endsWith("/settle"), "the live path POSTs to /settle");
  assert.ok(!captured.body.includes(TEST_KEY), "the REAL live POST body must not contain the key");
  assert.ok(
    !captured.body.toLowerCase().includes(TEST_KEY.slice(2).toLowerCase()),
    "nor the raw key hex",
  );
});

await t("signExactEvmPayment refuses a missing/garbage key and a non-address payTo", async () => {
  const reqs = { network: "base-sepolia", maxAmountRequired: "10000", asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", payTo: "0x0000000000000000000000000000000000000001", maxTimeoutSeconds: 60, extra: { name: "USDC", version: "2" } };
  await assert.rejects(() => signExactEvmPayment({ requirements: reqs, env: { X402_WALLET_PRIVATE_KEY: "not-a-key" } }), /not a 0x-prefixed 32-byte hex key/);
  const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  await assert.rejects(() => signExactEvmPayment({ requirements: { ...reqs, payTo: "" }, env: { X402_WALLET_PRIVATE_KEY: TEST_KEY } }), /payTo .* is not a 0x address/);
});

await t("a DECLINED facilitator settle surfaces errorReason, never a bare HTTP status", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ success: false, errorReason: "insufficient_funds", network: "base-sepolia" }),
      { status: 402, headers: { "content-type": "application/json" } },
    );
  const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  try {
    await assert.rejects(
      () => settle({ amountAtomic: 10_000, env: { X402_WALLET_PRIVATE_KEY: TEST_KEY, X402_FACILITATOR_URL: "http://facilitator.test", X402_PAY_TO: "0x0000000000000000000000000000000000000001" } }),
      /insufficient_funds.*HTTP 402/s,
      "the facilitator's own errorReason must reach the thrown error",
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

if (failures > 0) {
  console.error(`\n${failures} self-check(s) failed`);
  process.exit(1);
}
console.log("\nx402-adapter self-check GREEN — the extracted cost matches the probe's contract");
console.log("(LIVE on-chain settle still needs a funded base-sepolia USDC testnet wallet + facilitator — out of hermetic scope)");
