# `stripe-adapter` — the near-pluggable Stripe TEST-MODE charge rail (AGENT-PAY-1)

A wrapped downstream **MCP server** that issues a Stripe **test-mode** charge and returns
the **Charge object** the auths-mcp gateway extracts the metered cost from. This is the
first rail of the cross-rail credit-limit flagship (PRD §11).

**Bound, don't build.** `auths-mcp-core` holds **zero** payment code. This adapter is the
*only* place that knows Stripe's response shape: it returns the documented Charge object;
the gateway reads `charge.amount_captured` (cents) out of it and reserves/settles that
against the one cross-rail cap. The settle amount is **rail-response-authoritative** —
read from the response, never from an agent-declared number — which is what closes
AGENT-MCP-8's interim agent-declared-cost flag.

## What it does

```
agent ──tools/call──▶ auths-mcp-gateway ──tools/call──▶ stripe-adapter ──▶ Stripe test API
                          │  (reserve ceiling BEFORE the rail)          ◀── Charge object
                          │  extract charge.amount_captured (cents)
                          │  settle the EXTRACTED amount; release slack
                          ▼
                       receipt: rail=stripe, charge=ch_…, cross-rail total
```

- Exposes one paid tool, **`paid_call`** (a Stripe charge), over MCP JSON-RPC on stdio.
- Returns the full **Charge object** (`docs.stripe.com/api/charges/object`) — the gateway
  extracts `amount_captured` itself; the adapter never declares the cost to the gate.
- The gateway refuses an **over-cap** charge on its extracted **ceiling** *before* this
  adapter settles, so the metered downstream is never charged past the cap (PRD §11).

## Two modes, one response shape

| Mode | Trigger | Behavior |
| --- | --- | --- |
| **HERMETIC** (default) | no `STRIPE_API_KEY` | returns the recorded test-mode Charge fixture's shape — runnable + self-checkable with no key. **This is NOT what the gateway probe uses** — the hermetic probe drives the committed fixture directly. |
| **LIVE-TEST** | `STRIPE_API_KEY=sk_test_…` | POSTs a **real** test-mode charge to `api.stripe.com/v1/charges` and returns Stripe's real Charge object. Built tightly to the documented shape so a real test key works with minimal reconciliation. |

A `sk_live_…` key is **refused** — this rail issues test-mode charges only, never real money.

## Run it

```bash
# self-check: the extracted cost must match the gateway probe's contract (the fixture)
node test.mjs

# as an MCP server (hermetic — no key)
node server.mjs        # speaks initialize / tools/list / tools/call on stdio

# wrapped by the gateway, with the test key custodied (the agent never sees it):
auths-mcp wrap --scope paid.call --budget '$5' --ttl 30m \
  --custody-credential STRIPE_API_KEY \
  -- node examples/payments/adapters/stripe-adapter/server.mjs
```

## The contract is the suite, not this directory

The recorded rail-response fixtures the hermetic gateway probe drives over —
`auths/.recurve/claims/auths-mcp/probes/fixtures/stripe-charge.test.json` (and
`…-overcap.test.json`) — are the contract. `node test.mjs` asserts this adapter extracts
the **exact** cost the probe asserts (`amount_captured` → cents, charge id `ch_…`). The
gateway's own extraction (`auths-mcp-core::rail::extract_stripe`) is the authority; the
adapter's `extractCost` is a parity check.

## What's proven hermetically vs. what a key finishes

- **Proven hermetically (no key, gated):** the gateway extracts `amount_captured` from the
  recorded Charge response, meters it against the cross-rail cap, refuses an over-cap
  charge before the rail, and names the `ch_…` charge id + `rail=stripe` in the receipt
  (AGENT-PAY-1 GREEN, trap RED). This adapter's self-check confirms it produces the same
  extracted cost.
- **Finished by a real `STRIPE_API_KEY` (`sk_test_…`):** the **live** test-mode charge —
  this adapter calls Stripe-test for real and returns the real Charge object; the gateway
  extracts and meters it identically. Evidence-only, deferred until the key (D7); the live
  call is real, never faked.
- **Finished by a real `ANTHROPIC_API_KEY`:** the live Claude tool-loop that emits the
  over-spend behind the gateway (the believability beat), via `examples/live/`.
