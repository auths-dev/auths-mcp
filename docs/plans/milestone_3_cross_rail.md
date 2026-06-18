# Milestone 3 — Cross-rail aggregate budget (the flagship)

> **Goal.** One authority spanning Stripe **and** USDC/x402, where each rail alone reads "in budget" but the **aggregate** refuses the next call before money moves.
> **Strategy.** AGENT-4 — the single most platform-proof capability: a cap *above* rails no one vendor can see.
> **Status today.** The engine sums across rails; the **hermetic** path is green. Gaps: multi-rail **live routing** (3.1), the **x402 live-settle rewrite** (3.2 — the current `settle.mjs` is non-conformant), and the end-to-end proof (3.3). Wallet funded (**20 USDC** base-sepolia) + facilitator set (`x402.org`).

## Why
Stripe can cap spend on Stripe; it cannot cap "$5 total across Stripe and everything else," because it can't see the other rail and the other rail can't see it. Only a budget anchored *above both*, in an identity neither owns, can — and that's the demo that makes a payments exec's stomach drop.

## Baseline — what already exists (do not rebuild)
- **Aggregate engine:** `auths/crates/auths-mcp-core/src/budget.rs::CrossRailBudget` (≈296) — sums settled across rails; reserve/settle; durable `SettledCounter`.
- **Rail extraction:** `auths-mcp-core/src/rail.rs::extract` — Stripe `charge.amount_captured`; x402 atomic-USDC `requirements.maxAmountRequired / 10_000` (exact-only, sub-cent refused, testnet-guarded).
- **Adapters:** `stripe-adapter` (`charge.mjs` live `sk_test_` + hermetic fixture) — **built, green**. `x402-adapter` — hermetic path **green**, but its `settle.mjs` *live* branch is **non-conformant**: it POSTs `{ requirements, walletKey }`, handing the **raw private key** to the facilitator, which no real x402 facilitator accepts (and which leaks the key). Live x402 needs the rewrite in 3.2.
- **Config:** `auths-mcp/examples/payments/cross-rail.config.json` — one `$5` grant, a `rails:` map.

## Where the work lands
| Epic | Repo | Path |
|---|---|---|
| 3.1 Multi-rail live routing | `auths` | `crates/auths-mcp-gateway/src/proxy.rs` |
| 3.2 x402 live settle (`settle.mjs` rewrite) | `auths-mcp` | `examples/payments/adapters/x402-adapter/settle.mjs` |
| 3.3 Aggregate + concurrency proof | `auths-mcp` + `auths` | `examples/payments/cross-rail.config.json`, `budget.rs` test |

## Epics & subtasks
### 3.1 — Multi-rail live routing · `auths`
- `wrap` currently fronts a single downstream; teach `proxy.rs` to front the `rails:` map under **one** `Arc<Mutex<CrossRailBudget>>`.
- Route `paid_call` to the configured rail; extract cost via `rail::extract`; reserve against the **shared** budget before the rail is touched.

### 3.2 — x402 live settle: rewrite `settle.mjs` to the real x402 protocol · `auths-mcp`
**Already done (setup):** burner wallet funded with **20 USDC** on base-sepolia (`0x7dcbaC2…`; key in `auths/.env`, gitignored), and `X402_FACILITATOR_URL=https://x402.org/facilitator` (the free Base-Sepolia testnet facilitator — `eip155:84532`, v1+v2, no API key). See `docs/x402/wallet.md`.

**The actual work — the blocker:** `settle.mjs`'s live branch is **non-conformant**. It POSTs `{ requirements, walletKey }` (the raw key) to the facilitator; the real x402 `/settle` wants a **signed `PaymentPayload`** (an EIP-3009 `transferWithAuthorization` signature), *never* a key — so today it both **fails** against a real facilitator and **leaks the key** to it. Rewrite to the standard flow:
- **Sign the EIP-3009 `TransferWithAuthorization` locally with `viem`** (now a real dep of the adapter; **do not hand-roll** the EIP-712/keccak/secp256k1 — that's how payment-crypto bugs happen). `privateKeyToAccount(key)` → `account.signTypedData({ domain, types, primaryType: "TransferWithAuthorization", message })`. **The key is used ONLY to sign, in-process — it is never placed in any request body, header, or log.**
- **Prove the key-handling OFFLINE (no network):** `recoverTypedDataAddress(...) === account.address`. This deterministically proves the signature is correct **and** that we actually hold the key — *independently of whether the facilitator accepts the payload.* **This is the security guarantee, and it stands even if the broadcast leg needs format iteration** — the leak is gone the moment the key stops crossing the wire, regardless of the live settle's success.
- **Build the x402 `exact`-scheme EVM `PaymentPayload`** = `{ x402Version, scheme: "exact", network, payload: { signature, authorization } }`; POST `{ x402Version, paymentPayload, paymentRequirements }` (no `walletKey`) to `${X402_FACILITATOR_URL}/settle`. The facilitator broadcasts **and sponsors gas** → the wallet needs only USDC (0 ETH is fine).
- Keep `assertTestnetOnly` (base-sepolia only) + `extractCost` (atomic USDC → cents, exact-only) unchanged.
- **The regression test that would have caught the leak (deterministic, no network):** sign → assert `recoverTypedDataAddress === burner`, **and** assert the serialized `/settle` body contains **no** occurrence of `X402_WALLET_PRIVATE_KEY`. Then **one tiny real settle** (sub-cent) from the funded burner against `x402.org` for the on-chain tx hash.

```js
// settle.mjs (rewritten) — SIGN locally with viem, send the SIGNED payload, NEVER the key.
import { privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress } from "viem";
import { randomBytes } from "node:crypto";

const account = privateKeyToAccount(env.X402_WALLET_PRIVATE_KEY);   // key stays in-process, period

// EIP-3009 TransferWithAuthorization — the domain/version come from the rail's own requirements.extra
const domain = { name: req.extra.name, version: req.extra.version,  // "USDC","2"
                 chainId: 84532, verifyingContract: req.asset };    // base-sepolia USDC
const types  = { TransferWithAuthorization: [
  { name: "from", type: "address" }, { name: "to", type: "address" },
  { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" },
  { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" } ] };
const authorization = {
  from: account.address, to: req.payTo, value: BigInt(req.maxAmountRequired),
  validAfter: 0n, validBefore: BigInt(Math.floor(Date.now()/1000) + req.maxTimeoutSeconds),
  nonce: `0x${randomBytes(32).toString("hex")}` };

const signature = await account.signTypedData({ domain, types,
  primaryType: "TransferWithAuthorization", message: authorization });

// OFFLINE PROOF (no network): the signature recovers the burner — key is correct AND ours.
const who = await recoverTypedDataAddress({ domain, types,
  primaryType: "TransferWithAuthorization", message: authorization, signature });
if (who.toLowerCase() !== account.address.toLowerCase())
  throw new Error("EIP-3009 self-check failed — refusing to settle");

// x402 "exact" EVM PaymentPayload — carries the SIGNATURE, never the key.
const paymentPayload = { x402Version: 1, scheme: "exact", network,
  payload: { signature, authorization: {
    ...authorization, value: String(authorization.value),
    validAfter: "0", validBefore: String(authorization.validBefore) } } };

const res = await fetch(`${env.X402_FACILITATOR_URL.replace(/\/$/,"")}/settle`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ x402Version: 1, paymentPayload, paymentRequirements: req }), // NO walletKey
});
```

### 3.3 — Aggregate + concurrency proof · `auths-mcp` + `auths`
- Scenario: $2 Stripe + $2.50 USDC, then a $1 call on **either** rail → `UsageCapExceeded` before the rail.
- Property test in `budget.rs`: parallel calls on both rails never double-spend (reserve holds + settle).

## Grounded sketch — one budget, every rail
```rust
let ceiling = rail::extract(rail, &downstream_quote)?.amount_cents;   // engine extracts; never the agent's number
match budget.reserve(ceiling)? {                       // available = cap − settled − Σ(holds)
    ReserveOutcome::Reserved { hold, .. } => {
        let resp   = call_rail(rail, req).await?;       // only now is the rail touched
        let actual = rail::extract(rail, &resp)?.amount_cents;
        gate.settle(&mut budget, hold, actual)?;        // advance the CROSS-rail SETTLED counter
    }
    ReserveOutcome::Refused { cap_cents, would_be_cents } =>          // refused BEFORE any money moves
        return Verdict::UsageCapExceeded { cap_cents, would_be_cents },
}
```

## Rigor — don't be sloppy
- **DRY — "bound, don't build":** cost extraction lives **only** in `rail::extract`; adapters return the rail's *native* response; the gateway holds **zero** payment code. A new rail = one `extract` arm + one adapter.
- **One budget, no silos:** exactly **one** `CrossRailBudget` per delegation across all rails. A per-rail counter re-creates the gap the moat closes ($4.99 + $4.99 under a $5 cap).
- **Type-driven money:** `ExtractedCost { amount_cents, rail, reference }`; **integer cents**, parsed once in `session.rs` (`$`→cents; atomic-USDC→cents exact-only). **No floats** in money.
- **Trust the rail, not the agent:** reserve a *ceiling* before; settle the *actual* (`amount_captured` / `maxAmountRequired`) after.
- **Concurrency:** reserve/settle behind `Arc<Mutex<CrossRailBudget>>`; the durable monotonic `SettledCounter` is the source of truth; holds are transient. Property-test it.
- **Never transmit the key (x402):** the wallet key signs **locally** (EIP-3009); only the *signed* `PaymentPayload` crosses the wire. A facilitator interface that wants your raw key is wrong — it's the exact bearer-secret leak this whole product exists to kill. Use the official `x402` client; don't hand-roll EIP-712/3009.

## Done-when (acceptance)
- [ ] One `$5` grant fronts both rails through `wrap`.
- [ ] $2 Stripe + $2.50 USDC then $1 on either rail → `UsageCapExceeded` before the rail.
- [ ] Concurrency property test green (no double-spend under parallel calls).
- [ ] `settle.mjs` rewritten to the standard x402 flow (signed EIP-3009 `PaymentPayload`, **key never transmitted**); one real sub-cent settle lands against `x402.org/facilitator` from the funded burner; mainnet refused.

## Dependencies
- **Blocks:** Demo 1 (the flagship). **Blocked by:** M1 (live wrap), M2 (the moat gate).
