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

## Real by default — test mode is the opt-in

A wrapped payment rail resolves to one of two modes, and **REAL is the default**: with no
flag the rails are **live Stripe** (`sk_live_…`) and **x402 on base mainnet** (real USDC).
**`--test-mode`** (or `AUTHS_MCP_TEST_MODE=1` for the adapter) is the single, deliberate
opt-in that flips the same rails to sandbox (Stripe `sk_test_…`, x402 `base-sepolia`).

Two properties make real-by-default sane, enforced at the `wrap` boundary:

- **The cap is mandatory.** A payment rail **cannot** be wrapped without a `--budget` — the
  gateway refuses `budget-required`, fail-closed, in **both** modes. The cross-rail cap is
  the seatbelt; it is not optional.
- **The mode is disclosed.** Every payment-rail wrap prints `mode=real|test` plus a banner
  at startup. `auths-mcp wrap --show-mode …` resolves and discloses the mode (and the rails
  it names) **without** serving the proxy or touching a rail.

## Rails

| Rail | Real (default) | Test (`--test-mode`) | What the live leg needs | Page |
| --- | --- | --- | --- | --- |
| **Stripe** | live `sk_live_…` @ `api.stripe.com` | `sk_test_…` | a **key** (drop-in) | **[Stripe →](stripe.md)** |
| **x402 / USDC** | base **mainnet**, real USDC | base-sepolia | a **funded wallet *and* a facilitator URL** — more than a key | **[x402 / USDC →](x402.md)** |

!!! danger "Real money is the default"
    With no `--test-mode`, both rails spend **real money** (a live `sk_live_…` charge, a
    real on-chain USDC transfer). The `--budget` cap is the hard ceiling — an agent provably
    cannot cross it. Start tiny and prove the cap in `--test-mode` first. Live charges and
    on-chain transfers are **irreversible**.

!!! warning "x402 is not a key drop-in"
    Unlike Stripe (where a key alone makes the charge), x402's on-chain settle needs a
    **funded USDC wallet** and an **x402 facilitator URL** — on **base mainnet** for real,
    `base-sepolia` under `--test-mode`. See its page.
