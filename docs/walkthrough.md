# Walkthrough — an agent spending real money

This is the product's whole reason to exist: **let an autonomous agent spend real money,
and make it provably impossible for it to spend past a cap.** This page walks the live path
end-to-end — real Stripe, real USDC over x402, and a real Claude agent that *tries* to
overspend and gets cut off at the boundary.

!!! danger "Real money is OFF by default — and that's deliberate"
    The adapters ship **test-mode / testnet only**: a `sk_live_…` Stripe key and a **mainnet**
    network are **refused**. Spending real money is a deliberate opt-in (Step 0). The
    **budget cap is the hard ceiling** — an agent provably cannot spend past it, on any rail,
    even if the model is buggy, prompt-injected, or adversarial. Start with a tiny cap. **Live
    charges and on-chain transfers are irreversible.**

## The seatbelt: the cap is what makes this sane

Do not think of the cap as a setting — think of it as a **seatbelt**. With a `$5` delegation,
the agent cannot spend `$5.01`. Not "shouldn't" — **cannot**: the gateway reserves each
charge against the cap *before* the rail is touched and refuses the call that would cross it,
across **all** rails at once. The cap bounds your **downside**, not the probability of a bad
decision. So the discipline is simple: **start with the smallest cap that proves the point,
and prove the cap in test mode first.**

## Step 0 — Enable live money (the deliberate gate)

By default the adapters refuse live money. To go live you flip a deliberate, double-locked
opt-in **and** the gateway requires a `--budget` (it will not wrap a live-money rail without
a cap):

```bash
# the gateway-side gate
auths-mcp wrap --allow-live-money --budget '$5' ...
# the adapter-side gate (so a stray live key can't silently go live)
export AUTHS_MCP_LIVE_MONEY=1
```

!!! warning "Implementation status — this gate is not wired yet"
    The flags above are the **proposed** opt-in. Today the adapters hard-refuse `sk_live_`
    and mainnet (the safe default), so this walkthrough does **not** run end-to-end until the
    opt-in is built. It is the one deliberate change between "safe by default" and "real
    money." Until it's wired, run the [test-mode/testnet flow](payment-providers/index.md)
    — which exercises the *real* Stripe API and *real* on-chain x402, just without real
    money — to prove the cap.

## Step 1 — Real Stripe (live mode)

1. In the [Stripe dashboard](https://dashboard.stripe.com/apikeys), switch **off** Test mode
   and copy a **live** secret key (`sk_live_…`).

    !!! danger
        A `sk_live_…` key charges **real cards / real money**. There is no undo on a live
        charge beyond a refund.

2. Custody it on the gateway (the agent never sees it) and wrap the Stripe adapter with a
   **small** cap and the live-money opt-in:

    ```bash
    export STRIPE_API_KEY=sk_live_...
    export AUTHS_MCP_LIVE_MONEY=1
    auths-mcp wrap \
      --allow-live-money \
      --scope paid.call --budget '$5' --ttl 30m \
      --custody-credential STRIPE_API_KEY \
      -- node examples/payments/adapters/stripe-adapter/server.mjs
    ```

3. The gateway extracts `amount_captured` from each real Charge, meters it against the cap,
   and refuses any charge that would cross `$5` — **before** Stripe is called, so the card is
   never charged past the cap. The receipt names the real `ch_…`.

## Step 2 — Real USDC over x402 (base mainnet)

1. Fund a **base mainnet** wallet with **real USDC** (and a little ETH for gas), and obtain a
   **mainnet** x402 facilitator URL.

    !!! danger
        On-chain USDC transfers are **irreversible**. There is no chargeback.

2. Custody both and wrap the x402 adapter (same `$5` cap — it's the **same** cross-rail
   counter as Stripe):

    ```bash
    export X402_WALLET_PRIVATE_KEY=0x...      # a funded base MAINNET USDC wallet
    export X402_FACILITATOR_URL=https://...   # a mainnet facilitator
    export AUTHS_MCP_LIVE_MONEY=1
    auths-mcp wrap \
      --allow-live-money \
      --scope paid.call --budget '$5' --ttl 30m \
      --custody-credential X402_WALLET_PRIVATE_KEY \
      --custody-credential X402_FACILITATOR_URL \
      -- node examples/payments/adapters/x402-adapter/server.mjs
    ```

3. Stripe spend **and** x402 spend share the one `$5` cap. An agent at `$4.99` on Stripe and
   `$4.99` on x402 has spent `$9.98` of `$5` — the next call on **either** rail is refused.

## Step 3 — Ask an agent to spend real money

Now put a real model behind the gateway and give it a task that tempts it to overspend:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
python3 examples/live/record.py --out spend.recorded.json
```

A real `claude-opus-4-8` tool-loop runs behind the gateway, making real charges as it works.
When its cumulative spend reaches the cap, the **very next** charge — the one that would cross
`$5` — is refused at the boundary, from the chain. The model can decide whatever it likes;
**the money stops at `$5`.** The receipts (real `ch_…` / `0x…` tx) are the verifiable record
of exactly what was spent and what was refused.

## Kill it instantly

If anything looks wrong, revoke the agent's delegation — its **next call fails on every
rail at once**, with no propagation window. That's the "stop spending now" button, and it
actually works (it's [revocation](payment-providers/index.md), proven by the suite).

## Safety checklist

- [ ] **Prove the cap in test mode first** — run the [test-mode/testnet flow](payment-providers/index.md) and watch the cap refuse the over-cap call before you ever use a live key/wallet.
- [ ] **Start with the smallest cap** that demonstrates the point (e.g. `--budget '$1'`).
- [ ] The gateway **custodies** the live key/wallet — the agent never holds it; a bypass leaves it with no credential.
- [ ] Live charges and on-chain transfers are **irreversible** — the cap bounds the downside, not the probability of a bad call.
- [ ] Keep the **revoke** command ready, and a short `--ttl`.
- [ ] The live-money opt-in is **deliberate and double-locked** (gateway flag *and* adapter env) — never let it default on.
