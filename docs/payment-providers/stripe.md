# Stripe

The Stripe rail issues a **real, live charge** and returns the **Charge object** the gateway
extracts the metered cost from (`charge.amount_captured`, cents). **Real money is the
default**: with no `--test-mode` flag the rail resolves to live Stripe — an `sk_live_…` key
talking to `api.stripe.com` — and the charge moves real money on a real card.

!!! danger "Real money is the default"
    With no `--test-mode`, this rail makes a **live `sk_live_…` charge**. There is no undo on
    a live charge beyond a refund. The `--budget` cap is the hard ceiling — an agent
    provably cannot spend past it — and it is **mandatory**. Start with the smallest cap that
    proves the point, and prove the cap in [test mode](#test-mode) first.

## Prerequisites

- A Stripe **live** secret key (`sk_live_…`) from the
  [Stripe dashboard](https://dashboard.stripe.com/apikeys) (Test mode **off**).

## Setup

```bash
# run live, with the live key custodied by the gateway (the agent never sees it)
export STRIPE_API_KEY=sk_live_...
auths-mcp wrap \
  --scope paid.call --budget '$5' --ttl 30m \
  --custody-credential STRIPE_API_KEY \
  -- node examples/payments/adapters/stripe-adapter/server.mjs
```

In real mode the adapter POSTs a **live** charge to `api.stripe.com/v1/charges` and returns
Stripe's real Charge object. Two things are non-negotiable here:

- **The cap is mandatory.** Omit `--budget` and the gateway refuses to wrap the rail at all —
  `budget-required`, fail-closed, before any rail is touched. Real money with a skippable cap
  is not an allowed shape.
- **The mode is disclosed.** Every payment-rail wrap prints a `mode=real` banner and a
  `mode=real …` machine line at startup, so a live rail is never silent. Run
  `auths-mcp wrap --show-mode …` to resolve and disclose the mode **without** serving the
  proxy or making a charge.

## Custody — the agent never holds the key

The live `sk_live_…` key lives in the gateway's custody vault (`--custody-credential`), never
with the agent. The agent holds only its scoped, budget-bound delegation. An agent that tries
to reach Stripe without going through the gateway has **no credential** — so the boundary is
unbypassable.

## How it works

```
agent ──tools/call──▶ gateway ──tools/call──▶ stripe-adapter ──▶ Stripe live API
                         │  reserve ceiling BEFORE the rail        ◀── Charge object
                         │  extract charge.amount_captured (cents, USD-only)
                         │  settle the EXTRACTED amount; release slack
                         ▼
                      receipt: rail=stripe, mode=real, charge=ch_…, cross-rail total
```

- The gateway meters `charge.amount_captured` (cents). A **non-USD** charge is refused, not
  mis-metered.
- An **over-cap** charge is refused `usage-cap-exceeded` on its extracted ceiling **before**
  the adapter settles — Stripe is never charged past the cap.
- The settle amount comes from the **response**, never an agent-declared number — so an agent
  cannot under-report a charge to slip the cap.

## The "small reconcile"

The adapter is built against Stripe's documented Charge object and verified against a recorded
fixture (`node examples/payments/adapters/stripe-adapter/test.mjs`). When you point it at a
real key, a live charge may surface minor response-shape differences from the doc fixture —
reconcile those (typically a field path) and you're live. The gateway's own extractor
(`auths-mcp-core::rail::extract_stripe`) is the authority; the adapter's `extractCost` is a
parity check against it.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| gateway refuses to wrap (`budget-required`) | no `--budget` — the cap is mandatory for a payment rail (both modes) |
| adapter runs but never calls Stripe | no `STRIPE_API_KEY` set → it falls back to the recorded fixture shape |
| charge refused before any Stripe call | the extracted amount would cross the `--budget` cap (expected) |
| live charge metered differently than the fixture | the "small reconcile" — align the adapter to the real response field path |
| unsure which mode is live | run `auths-mcp wrap --show-mode …` — it prints `mode=real|test` and exits without charging |

## Test mode

To exercise the rail **without real money**, opt into sandbox rails with `--test-mode` (or
`AUTHS_MCP_TEST_MODE=1` for the adapter). Test mode resolves the Stripe rail to an
`sk_test_…` key (still `api.stripe.com`, but a test-mode charge — no real money). The cap is
**still mandatory**, and the mode is disclosed as `mode=test`.

```bash
export STRIPE_API_KEY=sk_test_...     # a TEST-mode key from the dashboard's Test mode toggle
auths-mcp wrap \
  --test-mode \
  --scope paid.call --budget '$5' --ttl 30m \
  --custody-credential STRIPE_API_KEY \
  -- node examples/payments/adapters/stripe-adapter/server.mjs
```

Use test mode to prove the cap refuses the over-cap call before you ever point a live
`sk_live_…` key at the rail.
