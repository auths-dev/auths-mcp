# Rail adapters

Each adapter is **near-pluggable**: it reads a wrapped rail's own response, extracts
the cost, and hands it to the gateway's cross-rail `CrossRailBudget`. `auths-mcp-core`
holds **zero payment code** — it never learns about a rail; the adapter is the only
place that knows a rail's response shape (PRD §11, bound-don't-build).

| Adapter | Rail | Extract | Gap | Status | Live needs |
| --- | --- | --- | --- | --- | --- |
| [`stripe-adapter`](stripe-adapter/) | Stripe **test-mode** | Charge `amount_captured` → cents | **AGENT-PAY-1** | **BUILT** — `node stripe-adapter/test.mjs` is green | `STRIPE_API_KEY` (`sk_test_…`) in the gateway custody vault (live charge only) |
| [`x402-adapter`](x402-adapter/) | x402 / **USDC base-sepolia testnet** | `SettlementResponse` + `PaymentRequirements.maxAmountRequired` (atomic USDC, 6 decimals) → cents | **AGENT-PAY-2** | **BUILT** — `node x402-adapter/test.mjs` is green | ⚠️ a **funded USDC testnet wallet** (base-sepolia) + an x402 facilitator URL — a key alone does NOT cover this |

**The contract is the suite, not this directory.** Build each adapter against the
recorded rail-response fixtures and the probes in
`auths/.recurve/claims/auths-mcp/probes/` — the adapter must produce the exact extracted
cost the probe asserts (the fixtures pin the response shapes against Stripe's and
x402's documented schemas). The probes baseline RED until the adapters land.

The live charge/settle legs are **evidence-only, deferred until D7** (keys + the funded
testnet wallet) — never gated. The hermetic probes drive the recorded responses and need
no key or wallet at all.
