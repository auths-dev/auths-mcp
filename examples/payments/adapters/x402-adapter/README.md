# `x402-adapter` — the testnet-flagged x402/USDC rail (AGENT-PAY-2)

A wrapped downstream **MCP server** that settles an x402/USDC payment on the
**base-sepolia testnet** and returns the **`SettlementResponse` + `PaymentRequirements`**
the auths-mcp gateway extracts the metered cost from — and meters into the **same
cross-rail cap as the Stripe rail**. This is the second rail of the cross-rail
credit-limit flagship and the moat (PRD §11).

**Bound, don't build.** `auths-mcp-core` holds **zero** payment code. This adapter is the
*only* place that knows x402's response shape: it returns the documented x402 response;
the gateway reads `requirements.maxAmountRequired` (ATOMIC USDC, 6 decimals) out of it,
converts it to cents, and reserves/settles that against the **one** cross-rail cap. The
settle amount is **rail-response-authoritative** — read from the response, never from an
agent-declared number.

## The cross-rail moat (why this rail matters)

```
agent ──tools/call (x402)──▶ auths-mcp-gateway ──tools/call──▶ x402-adapter ──▶ facilitator (base-sepolia)
                                 │  (reserve ceiling BEFORE the rail, ACROSS rails)        ◀── SettlementResponse
                                 │  extract requirements.maxAmountRequired (atomic→cents)
                                 │  settle into the SAME cap the Stripe rail meters into
                                 ▼
                              receipt: rail=x402, tx=0x…, cross-rail total
```

A `$1.50` Stripe charge **+** a `$1.50` x402 settle = `$3.00` of one `$5` cap. A later
**`$0.60`** x402 settle is *tiny* in a per-rail x402 silo (x402-alone is only `$2.10`) —
but summed cross-rail onto `$4.50` it would reserve to `$5.10 > $5`, so the gateway
refuses it **`usage-cap-exceeded` BEFORE this adapter is asked to settle**. Two siloed
per-rail budgets would each read in-budget; the one cross-rail counter refuses it. **That
gap is the product.**

## atomic-USDC → cents

USDC has **6 decimals**, so x402 amounts are in **atomic** units: `1500000` atomic =
`1.50` USDC = **150 cents**. The conversion is `atomic / 10000` (`1e6 / 100`), **exact
only** — a sub-cent residue is refused, not silently truncated, so the metered cost equals
the settled amount exactly. The receipt names the on-chain **settlement tx** (`0x…`) so a
stranger re-derives the cost from the recorded response.

## Two modes — but a key alone does NOT cover x402

| Mode | Trigger | Behavior |
| --- | --- | --- |
| **HERMETIC** (default) | no wallet + facilitator | returns the recorded base-sepolia testnet settlement fixture's shape — runnable + self-checkable with no wallet. **NOT a faked on-chain settle** — the recorded response shape. **This is NOT what the gateway probe uses** — the hermetic probe drives the committed fixture directly. |
| **LIVE-TESTNET** | **a funded `X402_WALLET_PRIVATE_KEY` (base-sepolia USDC) _and_ `X402_FACILITATOR_URL`** | builds the x402 `PaymentRequirements`, settles a **real** USDC transfer on base-sepolia through the facilitator, and returns the real `SettlementResponse` with the on-chain tx. |

A **mainnet** network is **refused** — this rail is **test-money only**.

> ### ⚠️ The live leg needs a funded testnet WALLET + facilitator — not just a key
> Unlike the Stripe rail (where a `sk_test_…` key alone makes the live test charge),
> **x402's live on-chain settle needs a funded base-sepolia USDC testnet wallet _and_ an
> x402 facilitator URL** (both in the gateway's custody vault, never the agent). A key
> alone does **not** fund the on-chain transfer. This leg is **out of hermetic scope**,
> built but **evidence-only** (no wallet in this env), and is **never faked**: with no
> wallet + facilitator the adapter runs hermetic; if the live path is reached without a
> reachable facilitator it **throws** rather than fabricating an on-chain settle.

## Run it

```bash
# self-check: the extracted cost must match the gateway probe's contract (the fixture)
node test.mjs

# as an MCP server (hermetic — no wallet)
node server.mjs        # speaks initialize / tools/list / tools/call on stdio

# wrapped by the gateway, with the funded testnet wallet + facilitator custodied
# (the agent never sees them):
auths-mcp wrap --scope paid.call --budget '$5' --ttl 30m \
  --custody-credential X402_WALLET_PRIVATE_KEY \
  --custody-credential X402_FACILITATOR_URL \
  -- node examples/payments/adapters/x402-adapter/server.mjs
```

## The contract is the suite, not this directory

The recorded rail-response fixtures the hermetic gateway probe drives over —
`auths/.recurve/claims/auths-mcp/probes/fixtures/x402-settlement.testnet.json` (and
`…-overcap.testnet.json`) — are the contract. `node test.mjs` asserts this adapter
extracts the **exact** cost the probe asserts (`maxAmountRequired` atomic → cents, tx
`0x…`). The gateway's own extraction (`auths-mcp-core::rail::extract_x402`) is the
authority; the adapter's `extractCost` is a parity check.

## What's proven hermetically vs. what the wallet finishes

- **Proven hermetically (no wallet, gated):** the gateway extracts
  `maxAmountRequired` (atomic USDC → cents) from the recorded x402 settlement response,
  meters it into the **same** cross-rail cap as Stripe, refuses a cross-rail cap-crosser
  before the rail (even when x402-alone is in-budget — the moat), and names the `0x…` tx
  + `rail=x402` in the receipt (AGENT-PAY-2 GREEN, trap RED). This adapter's self-check
  confirms it produces the same extracted cost.
- **Finished by a funded base-sepolia USDC testnet wallet + facilitator:** the **live**
  on-chain x402 settle — this adapter settles real USDC on base-sepolia through the
  facilitator and returns the real `SettlementResponse`; the gateway extracts and meters
  it identically. **Out of hermetic scope, evidence-only, deferred until the wallet +
  facilitator (D7); never faked. A key alone does NOT cover this.**
