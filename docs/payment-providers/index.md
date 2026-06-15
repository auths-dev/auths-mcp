# Payment Providers

A **payment provider** is a metered rail the gateway bounds. The gateway never charges the
rail itself — **bound, don't build**: the rail is a wrapped downstream MCP server, and the
gateway extracts the **cost from the rail's own response** and meters it against **one
budget**, by pre-authorization (reserve before the rail is touched, settle the actual
after).

## Three properties shared by every rail

**1. Rail-response-authoritative cost.** The metered amount is read from the provider's
response (e.g. Stripe's `amount_captured`, x402's `maxAmountRequired`), **never** from a
number the agent declares — so an agent cannot under-report a charge to slip the cap.

**2. One cross-rail cap (the moat).** Every rail meters into the *same* budget. An agent at
`$4.99` on Stripe **and** `$4.99` on x402 has spent `$0` in each per-rail silo — but `$9.98`
of a `$5` auths cap, so the next call on *either* rail is refused. The over-cap call is
refused **before** the rail is touched, so the provider is never charged past the cap.

**3. Custody.** The rail's credential lives in the gateway's custody vault
(`--custody-credential`), never with the agent. Each receipt names the rail and the
provider's own reference (`ch_…`, `0x…` tx) so the metered cost is re-derivable from the
recorded response.

## Hermetic vs. live

Each adapter runs **hermetic** (no credential → a recorded response shape, self-checkable
with `node test.mjs`) or **live** (the credential present → the real provider). The
automated suite is hermetic; the credential/wallet is only for the live charge.

## Rails

| Rail | Network | What the live leg needs | Page |
| --- | --- | --- | --- |
| **Stripe** | test-mode | a `sk_test_…` **key** (drop-in) | **[Stripe →](stripe.md)** |
| **x402 / USDC** | base-sepolia testnet | a **funded testnet wallet *and* a facilitator URL** — more than a key | **[x402 / USDC →](x402.md)** |

!!! warning "x402 is not a key drop-in"
    Unlike Stripe (where a test key alone makes the live charge), x402's live on-chain
    settle needs a **funded base-sepolia USDC wallet** and an **x402 facilitator URL**. See
    its page.
