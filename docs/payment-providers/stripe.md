# Stripe

The Stripe rail issues a **test-mode charge** and returns the **Charge object** the gateway
extracts the metered cost from. It is **drop-in after a small reconcile**: the adapter is
built tightly against Stripe's documented Charge shape, so a real test key works with
minimal adjustment.

## Prerequisites

- A Stripe **test-mode** secret key (`sk_test_…`) from the
  [Stripe dashboard](https://dashboard.stripe.com/test/apikeys) (toggle **Test mode**).

!!! danger "Test-mode only"
    A `sk_live_…` key is **refused** — this rail issues test-mode charges only, never real
    money.

## Setup

```bash
# 1. self-check (no key): confirm the adapter extracts the cost the gateway probe expects
node examples/payments/adapters/stripe-adapter/test.mjs

# 2. run live, with the key custodied by the gateway (the agent never sees it)
export STRIPE_API_KEY=sk_test_...
auths-mcp wrap \
  --scope paid.call --budget '$5' --ttl 30m \
  --custody-credential STRIPE_API_KEY \
  -- node examples/payments/adapters/stripe-adapter/server.mjs
```

In live mode the adapter POSTs a real test-mode charge to `api.stripe.com/v1/charges` and
returns Stripe's real Charge object.

## How it works

```
agent ──tools/call──▶ gateway ──tools/call──▶ stripe-adapter ──▶ Stripe test API
                         │  reserve ceiling BEFORE the rail        ◀── Charge object
                         │  extract charge.amount_captured (cents, USD-only)
                         │  settle the EXTRACTED amount; release slack
                         ▼
                      receipt: rail=stripe, charge=ch_…, cross-rail total
```

- The gateway meters `charge.amount_captured` (cents). A **non-USD** or **live-mode**
  charge is refused, not mis-metered.
- An **over-cap** charge is refused `usage-cap-exceeded` on its extracted ceiling
  **before** the adapter settles — Stripe is never charged past the cap.
- The settle amount comes from the **response**, never an agent-declared number.

## The "small reconcile"

The adapter is built against Stripe's documented Charge object and verified against a
recorded fixture (`node test.mjs`). When you point it at a real `sk_test_…` key, a live
test charge may surface minor response-shape differences from the doc fixture — reconcile
those (typically a field path) and you're live. The gateway's own extractor
(`auths-mcp-core::rail::extract_stripe`) is the authority; the adapter's `extractCost` is a
parity check against it.

## What's proven without a key vs. what the key finishes

- **Proven hermetically (no key, gated):** the gateway extracts `amount_captured` from the
  recorded Charge response, meters it against the cross-rail cap, refuses an over-cap charge
  before the rail, and names `ch_…` + `rail=stripe` in the receipt.
- **Finished by the `sk_test_…` key:** the **live** test-mode charge through the real Stripe
  API — the "real charges, cut off" beat on the Stripe rail.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| adapter runs but never calls Stripe | no `STRIPE_API_KEY` set → it's in **hermetic** mode |
| `sk_live_…` rejected | by design — test-mode only |
| charge refused before any Stripe call | the extracted amount would cross the `--budget` cap (expected) |
| live charge metered differently than the fixture | the "small reconcile" — align the adapter to the real response field path |
