# x402 wallet (base-sepolia testnet)

A **dedicated burner** EVM wallet for the x402 payment rail. It exists so the gateway can
custody a key for live USDC settlement **without ever touching your MetaMask key**. Hold only
throwaway testnet USDC here.

> **An "x402 wallet" is just a standard EVM keypair** — there is no special format. This one
> was generated locally; the private key lives in `auths/.env` (gitignored) and is **never**
> written into this (tracked) doc.

## The wallet

| | |
|---|---|
| **Address** (public — fund this) | `0x7dcbaC276a01cb2e73Cd0E27bC03C035cFa5F662` |
| Network | **base-sepolia** (Base L2 testnet) — *not* Ethereum Sepolia |
| Asset | **USDC**, contract `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Private key | in `auths/.env` as `X402_WALLET_PRIVATE_KEY` (gitignored, never here) |

## Env vars (all in `auths/.env`, which is gitignored)

| Var | Value | Purpose |
|---|---|---|
| `X402_WALLET_PRIVATE_KEY` | `0x…` (set) | the burner's key; the adapter custodies it |
| `X402_PAY_TO` | the address above (set) | recipient field in the PaymentRequirements |
| `X402_USDC_ASSET` | base-sepolia USDC (set) | the metered asset |
| `X402_FACILITATOR_URL` | **empty — you must set it** | the service that settles the transfer (see caveat) |

`hasLiveWallet()` (in `settle.mjs`) only enables the live path when **both**
`X402_WALLET_PRIVATE_KEY` *and* `X402_FACILITATOR_URL` are non-empty; otherwise the adapter
stays hermetic (recorded fixture). So until you set the facilitator URL, nothing live happens.

## Fund it (from MetaMask)

1. In MetaMask, on **base-sepolia**, send a small amount of **USDC** (e.g. 1–5 USDC — each
   metered call is a fraction of a cent) to **`0x7dcbaC276a01cb2e73Cd0E27bC03C035cFa5F662`**.
2. Gas: if your facilitator broadcasts the transfer *from this wallet*, also send a little
   **base-sepolia ETH** for gas (a faucet works). With a standard gasless EIP-3009 facilitator
   (below), the facilitator pays gas and the wallet needs only USDC.

## ⚠️ Facilitator caveat (read before a live run)

`settle.mjs` currently POSTs to `${X402_FACILITATOR_URL}/settle` with
`{ requirements, walletKey: X402_WALLET_PRIVATE_KEY }` — i.e. it **hands the private key to the
facilitator**, which then broadcasts the transfer. That is a **simplified/demo interface**, and
it is **not** how the public x402 facilitators (Coinbase CDP, x402.org) work — they accept a
*signed payment authorization*, never a raw key, and they should. So:

- **You cannot just point `X402_FACILITATOR_URL` at a public facilitator** — the interfaces
  don't match, and no reputable facilitator will take your key.
- **Two real options:**
  1. **Self-host** a facilitator that implements this `/settle` (key-handoff) interface against
     base-sepolia, and set `X402_FACILITATOR_URL` to it. Fine for a local evidence run.
  2. **(Recommended follow-up)** upgrade `settle.mjs` to the *standard* x402 client flow: sign
     an **EIP-3009 `transferWithAuthorization`** locally with the wallet key and POST only the
     **signed payload** to a standard base-sepolia facilitator — the key never leaves the
     machine, and gas is sponsored by the facilitator. Then `X402_FACILITATOR_URL` is a real
     public URL and the key-handoff smell is gone.

Until one of those is in place, keep the x402 rail **hermetic** (it already proves the
cross-rail aggregate-cap moat from recorded fixtures — the live settle is evidence-only, never
gated).

## How the gateway uses it

The gateway custodies these env vars and injects them into the *downstream* x402-adapter
process — the **agent never sees the key**. The adapter extracts the authoritative cost from
the rail's own settlement response (`maxAmountRequired`, atomic USDC → cents at 10,000
atomic/cent, exact-only), so the agent's claimed amount is never trusted.

```
agent ──tools/call(x402)──▶ gateway ──inject custody env──▶ x402-adapter ──▶ facilitator (base-sepolia)
```

## Security

- The private key is in `auths/.env` (**gitignored** — verified) and is **never** committed,
  logged, or written into this doc. This doc holds only the public address + var names.
- This is a **burner**: fund it with only throwaway testnet USDC. Never reuse your MetaMask key.
- Note: `auths-mcp/.env` is **not** gitignored — if you ever store secrets there instead, add
  `.env` to `auths-mcp/.gitignore` first. (The key is in `auths/.env`, which is safe.)

## Status

- [x] Burner wallet generated; key in `auths/.env`; address above.
- [ ] Fund it with base-sepolia USDC from MetaMask.
- [ ] Set `X402_FACILITATOR_URL` (self-hosted, or after the EIP-3009 upgrade) before any live run.
