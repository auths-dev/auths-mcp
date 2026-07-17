# auths-mcp

**auths-mcp** is the bounded-agent MCP gateway. It sits between an agent and its tools,
holds a **scoped, budget-bound, instantly-revocable delegation** for the agent, and
refuses any `tools/call` that exceeds it — at the protocol boundary, from the chain.

These docs cover **setting up the providers the gateway brokers**:

- **[AI Providers](ai-providers/index.md)** — the live model that drives the agent
  tool-loop (today: **[Anthropic / Claude](ai-providers/anthropic.md)**).
- **[Payment Providers](payment-providers/index.md)** — the metered rails the gateway
  bounds (today: **[Stripe](payment-providers/stripe.md)** and
  **[x402 / USDC](payment-providers/x402.md)**).

Every provider page is self-contained, but they share three ideas worth reading once.

## 1. Credential custody — the agent never holds the key

The gateway is a **credential-custody broker**, not just a proxy. It holds the provider's
secret; the agent holds **only** its delegation. An agent that tries to reach the provider
without going through the gateway has no credential — so the boundary is unbypassable.

You hand the gateway a credential with `--custody-credential`:

```bash
# bare NAME → the gateway ADOPTS it from its own environment
#            (the secret never appears on the agent-visible command line)
export STRIPE_API_KEY=sk_test_...
auths-mcp wrap --custody-credential STRIPE_API_KEY -- <downstream server>

# NAME=VALUE → inject an explicit value
auths-mcp wrap --custody-credential SOME_TOKEN=abc123 -- <downstream server>
```

The value is injected into the **downstream** process only — never onto the MCP wire,
never into receipts, never into logs.

!!! note "Invocation"
    `auths-mcp` is the installed gateway binary. If you haven't installed it, the
    no-install form is `npx @auths-dev/mcp wrap …`.

## 2. Real by default — test mode is the single opt-in

Every payment rail resolves to one of two **payment modes**, and **REAL is the default**.
An operator who wraps a payment rail almost always means it, so with no flag the gateway
sits in front of **real money** — live Stripe (`api.stripe.com`, an `sk_live_…` key) and
x402 on **base mainnet** (real USDC). **Test mode is the single, deliberate opt-in.**

| Mode | Trigger | Rails |
| --- | --- | --- |
| **Real** *(default)* | no flag | live Stripe (`sk_live_…`) + x402 base **mainnet** — real money. |
| **Test** | `--test-mode` (or `AUTHS_MCP_TEST_MODE=1` for the adapter) | Stripe `sk_test_…` + x402 **base-sepolia** — no real money. |

Two safety properties make real-by-default sane, and both are load-bearing in the gateway:

- **The cap is the mandatory seatbelt.** A payment rail **cannot** be wrapped without a
  `--budget` — the gateway refuses `budget-required`, fail-closed, in **both** modes.
  Real-by-default with a skippable cap would be a foot-gun aimed at a live card.
- **The mode is disclosed.** Every payment-rail wrap prints a `mode=real|test` machine line
  and a human banner at startup, so live rails are **never** silent. Run
  `auths-mcp wrap --show-mode …` to resolve and disclose the mode (and the rails it names)
  **without** serving the proxy or touching a rail.

!!! danger "Real money is the default"
    With no `--test-mode`, the wrapped rail spends **real money**. The `--budget` cap is the
    hard ceiling — an agent provably cannot spend past it, on any rail. Start tiny, and
    prove the cap in `--test-mode` first. Live charges and on-chain transfers are
    **irreversible**.

## 3. The `wrap` command — one shape for every provider

```bash
auths-mcp wrap \
  --scope <capability> \          # what the agent may call
  --budget '$5' \                 # the cross-rail spend cap — MANDATORY for payment rails
  --ttl 30m \                     # the delegation lifetime
  --custody-credential <NAME> \   # the provider secret the gateway holds (repeat per secret)
  -- <downstream MCP server command>
  # (add --test-mode for sandbox rails; the cap is still mandatory)
```

Pick your provider section to continue:

- **[AI Providers →](ai-providers/index.md)**
- **[Payment Providers →](payment-providers/index.md)**
