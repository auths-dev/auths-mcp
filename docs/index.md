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
    no-install form is `npx @auths/mcp wrap …`.

## 2. Hermetic vs. live — keys are only for the *live* leg

Every provider adapter runs in one of two modes:

| Mode | Trigger | Use |
| --- | --- | --- |
| **Hermetic** | no credential present | runs against a recorded provider-response shape — runnable + self-checkable with **no key/wallet**. The default. |
| **Live** | the credential is present (and custodied) | calls the real provider API. |

The automated test suite is **hermetic** — it never needs your keys. Keys and wallets are
only for the **live** leg (a real charge, a real model run), which is *evidence*, not the
gate.

## 3. The `wrap` command — one shape for every provider

```bash
auths-mcp wrap \
  --scope <capability> \          # what the agent may call
  --budget '$5' \                 # the cross-rail spend cap (payment rails)
  --ttl 30m \                     # the delegation lifetime
  --custody-credential <NAME> \   # the provider secret the gateway holds (repeat per secret)
  -- <downstream MCP server command>
```

Pick your provider section to continue:

- **[AI Providers →](ai-providers/index.md)**
- **[Payment Providers →](payment-providers/index.md)**
