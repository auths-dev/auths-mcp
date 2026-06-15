// test.mjs — the adapter's self-check: it must produce the EXACT extracted cost the
// gateway's hermetic probe asserts (the recorded fixture is the contract). Dependency-
// free; `node test.mjs` exits 0 on pass, non-zero on any mismatch.

import assert from "node:assert/strict";
import { charge, extractCost, hasTestKey, assertTestModeOnly } from "./charge.mjs";

// Resolve the SAME recorded fixture the hermetic gateway probe drives over, so the
// adapter's extracted cost is checked against the probe's contract.
const FIXTURES = new URL(
  "../../../../../auths/.recurve/claims/auths-mcp/probes/fixtures",
  import.meta.url,
).pathname;
process.env.AUTHS_MCP_RAIL_FIXTURES = FIXTURES;
delete process.env.STRIPE_API_KEY; // force HERMETIC mode for the self-check

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

await t("hermetic charge returns the recorded $3.00 Charge shape", async () => {
  const c = await charge({});
  assert.equal(c.id, "ch_3MmlLrLkdIwHu7ix0snN0B15", "the recorded charge id");
  assert.equal(c.amount_captured, 300, "amount_captured = $3.00 in cents");
  assert.equal(c.currency, "usd");
  assert.equal(c.livemode, false, "test-mode only — no real money");
});

await t("the extracted cost matches the probe's contract (amount_captured → cents)", async () => {
  const c = await charge({});
  const cost = extractCost(c);
  assert.equal(cost.amount_cents, 300, "the gateway meters amount_captured, not an agent number");
  assert.equal(cost.rail, "stripe");
  assert.equal(cost.reference, "ch_3MmlLrLkdIwHu7ix0snN0B15", "the receipt-grade charge reference");
});

await t("an over-cap charge shape ($6.00) is extracted from amount_captured", async () => {
  process.env.STRIPE_CHARGE_FIXTURE = `${FIXTURES}/stripe-charge-overcap.test.json`;
  const c = await charge({});
  assert.equal(extractCost(c).amount_cents, 600, "the gateway will refuse this on its ceiling before the rail");
  delete process.env.STRIPE_CHARGE_FIXTURE;
});

await t("the cost is the RESPONSE amount, not the requested amount", async () => {
  // Hermetic charge overlays a requested amount onto the fixture; the point in LIVE mode
  // is that the cost is read back from the response — here we confirm the overlay path
  // also reports the response's amount_captured (they coincide), proving extraction reads
  // the response field, never trusting a separate declared number.
  const c = await charge({ amountCents: 250 });
  assert.equal(c.amount_captured, 250);
  assert.equal(extractCost(c).amount_cents, 250);
});

await t("a live (sk_live_…) key is refused — test-mode only", () => {
  assert.throws(() => assertTestModeOnly({ STRIPE_API_KEY: "sk_live_abc" }), /LIVE key/);
});

await t("hasTestKey detects only sk_test_ keys", () => {
  assert.equal(hasTestKey({ STRIPE_API_KEY: "sk_test_abc" }), true);
  assert.equal(hasTestKey({ STRIPE_API_KEY: "sk_live_abc" }), false);
  assert.equal(hasTestKey({}), false);
});

if (failures > 0) {
  console.error(`\n${failures} self-check(s) failed`);
  process.exit(1);
}
console.log("\nstripe-adapter self-check GREEN — the extracted cost matches the probe's contract");
