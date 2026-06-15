// charge.mjs — the near-pluggable Stripe charge core.
//
// This is the ONE place that knows Stripe's response shape (PRD §11, bound-don't-build):
// it produces the Stripe TEST-MODE Charge object the gateway EXTRACTS the cost from
// (`charge.amount_captured`, cents — docs.stripe.com/api/charges/object). The gateway's
// `auths-mcp-core` holds zero payment code; it only reads the response this returns.
//
// Two modes, ONE response shape:
//
//   * LIVE (a real `sk_test_…` key in the gateway's custody vault): POST the charge to
//     Stripe's test-mode API (api.stripe.com/v1/charges) and return the real Charge
//     object Stripe responds with. This is built tightly against the documented Charge
//     shape so a real test key makes a real test charge with minimal reconciliation.
//     The LIVE call is evidence-only (no key in this env) — it is real, never faked.
//
//   * HERMETIC (no key): return the recorded TEST-MODE Charge fixture's shape so the
//     adapter is runnable and self-checkable without a key — the SAME shape the live
//     call returns and the SAME fixture the hermetic gateway probe drives over. The
//     hermetic gateway probe uses the committed fixture directly, NOT this adapter.

import { readFile } from "node:fs/promises";

const STRIPE_API = "https://api.stripe.com/v1/charges";

/** True when a real Stripe TEST-MODE secret key is present (sk_test_…). A live (sk_live_…)
 *  key is REFUSED — this adapter only ever issues test-mode charges. */
export function hasTestKey(env = process.env) {
  const k = env.STRIPE_API_KEY;
  return typeof k === "string" && k.startsWith("sk_test_");
}

/** Guard against a non-test key reaching this adapter. A live key must never charge
 *  real money here; only `sk_test_…` is accepted. Returns null when the key is a valid
 *  test key or absent (hermetic); throws on a live key. */
export function assertTestModeOnly(env = process.env) {
  const k = env.STRIPE_API_KEY;
  if (typeof k === "string" && k.startsWith("sk_live_")) {
    throw new Error(
      "stripe-adapter refuses a LIVE key (sk_live_…): this rail issues TEST-MODE charges only",
    );
  }
}

/** Issue (or, hermetically, recall) a Stripe TEST-MODE charge and return the Charge
 *  object the gateway extracts the cost from. `amountCents`/`currency` describe the
 *  intended charge; the AUTHORITATIVE cost the gateway meters is read back out of the
 *  returned Charge's `amount_captured`, not from these inputs. */
export async function charge({ amountCents, currency = "usd", source = "tok_visa", env = process.env } = {}) {
  assertTestModeOnly(env);
  if (hasTestKey(env)) {
    return await liveTestCharge({ amountCents, currency, source, env });
  }
  return await hermeticCharge({ amountCents, currency, env });
}

/** LIVE: POST a real TEST-MODE charge to Stripe and return the real Charge object.
 *  Real, never faked. Requires `sk_test_…` in env (the gateway's custody vault). */
async function liveTestCharge({ amountCents, currency, source, env }) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error(`charge amount must be a positive integer of cents, got ${amountCents}`);
  }
  const body = new URLSearchParams({
    amount: String(amountCents),
    currency,
    source, // a Stripe test token (e.g. tok_visa) — never a real card in test mode
  });
  const res = await fetch(STRIPE_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_API_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const charge = await res.json();
  if (!res.ok) {
    const msg = charge?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`stripe test charge failed: ${msg}`);
  }
  if (charge.livemode === true) {
    // Defensive: a test key must produce a test-mode charge. Never meter a live charge.
    throw new Error("stripe returned a LIVE charge from a test key — refusing");
  }
  return charge;
}

/** HERMETIC: return the recorded TEST-MODE Charge fixture's shape (no key, no network).
 *  The amount is overlaid onto the fixture so a config can request a specific cost; the
 *  returned shape is doc-accurate and is what the gateway extracts `amount_captured`
 *  from — identical in shape to the live response. */
async function hermeticCharge({ amountCents, currency, env }) {
  const fixturePath = env.STRIPE_CHARGE_FIXTURE ?? defaultFixturePath(env);
  const raw = await readFile(fixturePath, "utf8");
  const fixture = JSON.parse(raw);
  const charge = fixture.charge ?? fixture; // the fixture wraps the Charge under `charge`
  if (Number.isInteger(amountCents) && amountCents > 0) {
    charge.amount = amountCents;
    charge.amount_captured = amountCents;
  }
  if (currency) charge.currency = currency;
  // The hermetic charge is ALWAYS test-mode (no real money).
  charge.livemode = false;
  return charge;
}

/** Resolve the recorded fixture the hermetic charge recalls. The gateway suite holds the
 *  canonical recorded responses; the adapter reads the SAME ones so its extracted cost
 *  matches the probe's. Honors STRIPE_CHARGE_FIXTURE, else the suite fixtures dir. */
function defaultFixturePath(env) {
  const dir =
    env.AUTHS_MCP_RAIL_FIXTURES ??
    new URL("../../../../../auths/.recurve/claims/auths-mcp/probes/fixtures", import.meta.url)
      .pathname;
  return `${dir}/stripe-charge.test.json`;
}

/** Extract the cost the gateway meters from a Stripe Charge object — the mirror of the
 *  gateway's own extraction (auths-mcp-core::rail::extract_stripe), here so the adapter
 *  can SELF-CHECK that the charge it returns yields the expected cost. The gateway is the
 *  authority; this is a parity check, not a second source of truth. */
export function extractCost(charge) {
  if (!charge || typeof charge !== "object") {
    throw new Error("not a stripe charge object");
  }
  if (typeof charge.amount_captured !== "number") {
    throw new Error("stripe charge missing amount_captured (the settled cost field)");
  }
  if (String(charge.currency).toLowerCase() !== "usd") {
    throw new Error(`stripe charge currency ${charge.currency} is not usd`);
  }
  return {
    amount_cents: charge.amount_captured,
    rail: "stripe",
    reference: charge.id,
  };
}
