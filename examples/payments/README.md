# Payments — the cross-rail credit-limit flagship

> **Status: BUILT — the adapters are implemented and the claims are closed.**
> **AGENT-PAY-1** (Stripe), **AGENT-PAY-2** (x402), and **AGENT-MCP-8** (live-wire counter
> parity) are **GREEN**; the rail adapters live in `adapters/stripe-adapter` and
> `adapters/x402-adapter`. The executable contract is still the recurve suite
> (`auths/.recurve/claims/auths-mcp/`): the gaps, their HERMETIC probes, traps, and the
> recorded rail-response fixtures — do not add ad-hoc code that drifts from the probes. The
> hermetic gate is green **with no keys**; the **live legs are deferred evidence** (a Stripe
> test key, the Anthropic key, and an x402 base-sepolia testnet wallet + facilitator).
> **Setup: see the `docs/` mkdocs site at the repo root.**

This is the flagship example of the whole product (PRD §11): **one agent, one `$5`
authority, spending across a Stripe test-mode rail *and* an x402/USDC-testnet rail at
once** — and the next call on *either* rail is refused once the **combined** spend
would cross the one cap. An agent at `$4.99` on Stripe **and** `$4.99` on x402 has
"spent `$0`" in each per-rail silo; under auths it has spent `$9.98` of `$5` and the
next call on either rail is refused. **That gap is the product.**

**Bound, don't build.** Each rail is a *wrapped downstream MCP server*. `auths-mcp-core`
holds **zero payment code** — it meters a "this call costs X" signal extracted from the
rail's own response and enforces the one cross-rail cap by pre-authorization
(reserve-before-the-rail, settle-the-actual-after). Settlement is the rail's job;
cross-rail spend *authorization* is auths's.

## The adapters to build (the burndown's deliverable)

The adapter is **near-pluggable**: read the rail's response, extract the cost, hand it
to the gateway's cross-rail budget. Nothing in `auths-mcp-core` learns about a rail.

| Adapter (to build) | Rail | Extracts the cost from | Maps to gap |
| --- | --- | --- | --- |
| `adapters/stripe-adapter` | Stripe **test-mode** | the Stripe Charge response `amount_captured` (cents) — [docs.stripe.com/api/charges/object](https://docs.stripe.com/api/charges/object) | **AGENT-PAY-1** |
| `adapters/x402-adapter` | x402 / **USDC base-sepolia testnet** | the x402 `SettlementResponse` + `PaymentRequirements.maxAmountRequired` (atomic USDC, 6 decimals → cents) — [coinbase/x402 spec](https://github.com/coinbase/x402/blob/main/specs/x402-specification-v1.md) | **AGENT-PAY-2** |
| (engine, `auths` tree) | the live `wrap` wire | replace the v0 in-memory guard with the durable `CrossRailBudget` so live-wire verdicts match the hermetic gate | **AGENT-MCP-8** |

The doc-accurate **recorded rail-response fixtures** the hermetic probes drive over
already exist, in the suite:

- `auths/.recurve/claims/auths-mcp/probes/fixtures/stripe-charge.test.json`
  (and `…-overcap.test.json`)
- `auths/.recurve/claims/auths-mcp/probes/fixtures/x402-settlement.testnet.json`
  (and `…-overcap.testnet.json`)

The adapter must produce the *same* extracted cost the probe asserts — the fixtures are
the contract.

## Keys & wallet (live evidence — deferred until D7, never gated)

The hermetic probes need **none of these** — they drive RECORDED responses. The keys
and the wallet are only for the **live evidence leg** (out-of-band, never the gate):

| Need | For | Where | Status |
| --- | --- | --- | --- |
| `STRIPE_API_KEY` (a **test-mode** `sk_test_…` key) | a live Stripe **test** charge | the gateway's custody vault (`--custody-credential`, never the agent) | finished by **the Stripe test key** |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` | the live Claude tool-loop that emits the over-spend (the believability leg, `claude-opus-4-8`) | the `examples/live` recorder | finished by **the Anthropic key** |
| **a funded USDC TESTNET wallet** (base-sepolia) + an x402 facilitator URL | a live x402 settle on-chain | the gateway's custody vault | ⚠️ **STILL NEEDS THE FUNDED USDC TESTNET WALLET** — out of hermetic scope; the Stripe/Anthropic keys do **not** cover this |

**What your keys finish vs. what still needs the wallet:**
- The **Stripe test key** + the **Anthropic key** finish the Stripe rail's live charge
  and the live Claude over-spend run — the visceral "real charges, cut off" beat on the
  Stripe rail.
- The **x402 rail's live settle still needs a funded USDC testnet wallet** (base-sepolia)
  — a key alone does not fund it. Until then, the x402 leg is hermetic-only (cost
  extraction + cross-rail metering proven over the recorded settlement fixture); the live
  on-chain settle is deferred evidence.

## The flagship beats (built once the adapters land)

1. **Cross-rail cap** — `$3` on Stripe **+** `$2` on x402 = `$5`; the next call on
   *either* rail is refused `usage-cap-exceeded` before the rail is touched (the moat).
2. **Attenuation** — a sub-agent handed a `$2` slice provably cannot exceed it on *any*
   rail.
3. **Revocation** — one revoke stops spend on **both** rails mid-run.

None of it routes trust through a processor; every brokered call leaves a verifiable
receipt naming the rail and the running cross-rail total.

## Scenario config shapes (placeholders)

- `cross-rail.config.json` — the one `$5` authority over both rails (the lead).
- `subagent-slice.config.json` — the `$2` sub-agent slice (attenuation).

The config keys are pinned during the build, against the probes. The shapes here only
name the intended surface.
