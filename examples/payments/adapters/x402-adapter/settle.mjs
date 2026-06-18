// settle.mjs — the near-pluggable x402/USDC settle core.
//
// This is the ONE place that knows the x402 response shape (PRD §11, bound-don't-build):
// it produces the x402 SettlementResponse + PaymentRequirements the gateway EXTRACTS the
// metered cost from (`requirements.maxAmountRequired`, ATOMIC USDC at 6 decimals → cents
// — coinbase/x402 spec v1). The gateway's `auths-mcp-core` holds zero payment code; it
// only reads the response this returns and meters it into the SAME cross-rail cap as the
// Stripe rail (cross-rail summing — the moat).
//
// Two modes, ONE response shape — but UNLIKE Stripe, a key alone does NOT cover x402:
//
//   * HERMETIC (default): return the recorded base-sepolia TESTNET settlement fixture's
//     shape so the adapter is runnable and self-checkable without a wallet — the SAME
//     shape a live settle returns and the SAME fixture the hermetic gateway probe drives
//     over. The hermetic gateway probe uses the committed fixture directly, NOT this
//     adapter. NO on-chain settle, NO real money.
//
//   * LIVE (a funded base-sepolia USDC TESTNET wallet + an x402 facilitator URL in the
//     gateway's custody vault): build the x402 PaymentRequirements, settle through the
//     facilitator on base-sepolia, and return the real SettlementResponse with the
//     on-chain tx. *** This leg needs a FUNDED TESTNET WALLET + FACILITATOR — a key
//     alone does NOT cover it. *** It is built but EVIDENCE-ONLY (no wallet in this env)
//     and is NEVER faked: with no wallet+facilitator it REFUSES rather than fabricating
//     an on-chain settle. A mainnet network is refused outright (test-money only).

import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress } from "viem";

/** USDC has 6 decimals; cents are its 2-decimal minor unit, so 1 cent = 1e4 atomic. */
const USDC_ATOMIC_PER_CENT = 10_000;

/** The x402 networks this adapter will settle — TESTNETS only. A mainnet network is
 *  refused: the live x402 leg is test-money only (a funded base-sepolia wallet), never
 *  real-money mainnet. */
const TESTNETS = new Set(["base-sepolia"]);

/** True when a live x402 settle is configured: BOTH a funded testnet wallet key AND a
 *  facilitator URL are present. A key alone is NOT enough for x402 (unlike Stripe) — the
 *  on-chain settle needs the facilitator to broadcast the signed transfer. */
export function hasLiveWallet(env = process.env) {
  return (
    typeof env.X402_WALLET_PRIVATE_KEY === "string" &&
    env.X402_WALLET_PRIVATE_KEY.length > 0 &&
    typeof env.X402_FACILITATOR_URL === "string" &&
    env.X402_FACILITATOR_URL.length > 0
  );
}

/** Guard: only TESTNET settles are allowed here. A mainnet network would move real money
 *  and is refused (test-money only — a funded base-sepolia testnet wallet). */
export function assertTestnetOnly(network) {
  if (!TESTNETS.has(String(network))) {
    throw new Error(
      `x402-adapter refuses network ${network}: TESTNET only (${[...TESTNETS].join(", ")}) — ` +
        `the live x402 settle is test-money only, never real-money mainnet`,
    );
  }
}

/** Settle (or, hermetically, recall) an x402 USDC payment on a base-sepolia testnet and
 *  return the SettlementResponse + PaymentRequirements the gateway extracts the cost
 *  from. `amountAtomic` is the intended amount in ATOMIC USDC (6 decimals); the
 *  AUTHORITATIVE cost the gateway meters is read back out of the returned
 *  `requirements.maxAmountRequired`, not from this input. */
export async function settle({
  amountAtomic,
  network = "base-sepolia",
  env = process.env,
} = {}) {
  assertTestnetOnly(network);
  if (hasLiveWallet(env)) {
    return await liveTestnetSettle({ amountAtomic, network, env });
  }
  return await hermeticSettle({ amountAtomic, network, env });
}

/** LIVE: settle a REAL x402 USDC transfer on base-sepolia through the facilitator and
 *  return the real SettlementResponse with the on-chain tx.
 *
 *  *** OUT OF HERMETIC SCOPE — needs a FUNDED base-sepolia USDC TESTNET WALLET +
 *  FACILITATOR URL (a key alone does NOT cover x402). *** Never faked: with no wallet +
 *  facilitator this path is never reached (hasLiveWallet gates it); if reached without a
 *  reachable facilitator it THROWS rather than fabricating an on-chain settle. Real,
 *  evidence-only — there is no wallet/facilitator in this env, so this never runs here.
 */
async function liveTestnetSettle({ amountAtomic, network, env }) {
  assertTestnetOnly(network);
  if (!isAtomicAmount(amountAtomic)) {
    throw new Error(`x402 amount must be a positive integer of atomic USDC, got ${amountAtomic}`);
  }
  // Build the PaymentRequirements the facilitator settles against (x402 spec v1 §5.1).
  const requirements = {
    scheme: "exact",
    network,
    maxAmountRequired: String(amountAtomic),
    asset: env.X402_USDC_ASSET ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // base-sepolia USDC
    payTo: env.X402_PAY_TO, // required for a live settle; signExactEvmPayment rejects a non-address
    resource: env.X402_RESOURCE ?? "",
    description: "One metered x402 tool call",
    mimeType: "application/json",
    maxTimeoutSeconds: 60,
    extra: { name: "USDC", version: "2" },
  };
  // Sign the EIP-3009 authorization LOCALLY: the private key signs in-process and is NEVER
  // placed in the request. We POST the SIGNED PaymentPayload — not the key (x402 spec v1 §5.2).
  const paymentPayload = await signExactEvmPayment({ requirements, network, env });
  const res = await fetch(`${env.X402_FACILITATOR_URL.replace(/\/$/, "")}/settle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ x402Version: 1, paymentPayload, paymentRequirements: requirements }),
  });
  const settlement = await res.json();
  if (!res.ok || settlement?.success !== true) {
    const msg = settlement?.error ?? `HTTP ${res.status}`;
    // Never fabricate a settle: a failed facilitator settle is an error, not a faked tx.
    throw new Error(`x402 facilitator settle failed (base-sepolia): ${msg}`);
  }
  if (String(settlement.network) !== network) {
    throw new Error(`x402 facilitator settled on ${settlement.network}, expected ${network}`);
  }
  return { rail: "x402", requirements, settlement };
}

/** Sign an x402 "exact"-scheme EVM PaymentPayload for `requirements` with the funded burner
 *  key — entirely LOCALLY. The private key is used ONLY to produce the EIP-3009
 *  `transferWithAuthorization` signature in-process; it is NEVER returned, logged, or placed
 *  in any network request. The returned payload carries the SIGNATURE, not the key, and is
 *  self-checked offline (the signature must recover the burner address) before it is sent.
 *
 *  This is the §12 non-negotiable made literal: a facilitator that wants your raw key is
 *  wrong — only the signed authorization crosses the wire. */
export async function signExactEvmPayment({ requirements, network = "base-sepolia", env = process.env }) {
  const key = env.X402_WALLET_PRIVATE_KEY;
  if (typeof key !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("X402_WALLET_PRIVATE_KEY is missing or not a 0x-prefixed 32-byte hex key");
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(requirements.payTo))) {
    throw new Error(`x402 payTo ${requirements.payTo} is not a 0x address — set X402_PAY_TO`);
  }
  const account = privateKeyToAccount(key); // key stays in-process; only `account` escapes

  // EIP-3009 TransferWithAuthorization. The EIP-712 domain comes from the rail's OWN
  // requirements.extra (name/version) — the adapter never hard-codes the token's domain.
  const domain = {
    name: requirements.extra?.name ?? "USDC",
    version: requirements.extra?.version ?? "2",
    chainId: chainIdFor(network),
    verifyingContract: requirements.asset,
  };
  const types = {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  };
  const nowSec = Math.floor(Date.now() / 1000);
  const authorization = {
    from: account.address,
    to: requirements.payTo,
    value: BigInt(requirements.maxAmountRequired),
    validAfter: 0n,
    validBefore: BigInt(nowSec + (Number(requirements.maxTimeoutSeconds) || 60)),
    nonce: `0x${randomBytes(32).toString("hex")}`,
  };

  const signature = await account.signTypedData({
    domain,
    types,
    primaryType: "TransferWithAuthorization",
    message: authorization,
  });

  // OFFLINE self-check (no network): the signature MUST recover the burner. This proves the
  // signing is correct AND that we actually hold the key — independent of the facilitator.
  const recovered = await recoverTypedDataAddress({
    domain,
    types,
    primaryType: "TransferWithAuthorization",
    message: authorization,
    signature,
  });
  if (recovered.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error("EIP-3009 local signature self-check failed — refusing to settle");
  }

  // The x402 "exact" EVM PaymentPayload — JSON-safe strings; carries the SIGNATURE, never the key.
  return {
    x402Version: 1,
    scheme: "exact",
    network,
    payload: {
      signature,
      authorization: {
        from: authorization.from,
        to: authorization.to,
        value: String(authorization.value),
        validAfter: String(authorization.validAfter),
        validBefore: String(authorization.validBefore),
        nonce: authorization.nonce,
      },
    },
  };
}

/** The chainId for a SUPPORTED testnet (testnet-only — a mainnet network is refused upstream). */
function chainIdFor(network) {
  if (network === "base-sepolia") return 84532;
  throw new Error(`x402-adapter has no chainId for non-testnet network ${network}`);
}

/** HERMETIC: return the recorded base-sepolia TESTNET settlement fixture's shape (no
 *  wallet, no network, no on-chain settle). The amount is overlaid onto the fixture so a
 *  config can request a specific cost; the returned shape is doc-accurate and is what the
 *  gateway extracts `maxAmountRequired` from — identical in shape to the live response.
 *  This is NOT a faked on-chain settle: it is the RECORDED response shape, the same one
 *  the live facilitator returns, used only so the adapter is runnable+self-checkable. */
async function hermeticSettle({ amountAtomic, network, env }) {
  assertTestnetOnly(network);
  const fixturePath = env.X402_SETTLEMENT_FIXTURE ?? defaultFixturePath(env);
  const raw = await readFile(fixturePath, "utf8");
  const fixture = JSON.parse(raw);
  const requirements = fixture.requirements ?? {};
  const settlement = fixture.settlement ?? {};
  if (isAtomicAmount(amountAtomic)) {
    requirements.maxAmountRequired = String(amountAtomic);
  }
  // The hermetic settle is ALWAYS a testnet (no real money).
  requirements.network = network;
  settlement.network = network;
  return { rail: "x402", requirements, settlement };
}

/** Resolve the recorded fixture the hermetic settle recalls. The gateway suite holds the
 *  canonical recorded responses; the adapter reads the SAME ones so its extracted cost
 *  matches the probe's. Honors X402_SETTLEMENT_FIXTURE, else the suite fixtures dir. */
function defaultFixturePath(env) {
  const dir =
    env.AUTHS_MCP_RAIL_FIXTURES ??
    new URL("../../../../../auths/.recurve/claims/auths-mcp/probes/fixtures", import.meta.url)
      .pathname;
  return `${dir}/x402-settlement.testnet.json`;
}

function isAtomicAmount(n) {
  return Number.isInteger(n) && n > 0;
}

/** Extract the cost the gateway meters from an x402 settlement response — the mirror of
 *  the gateway's own extraction (auths-mcp-core::rail::extract_x402), here so the adapter
 *  can SELF-CHECK that the response it returns yields the expected cost. The gateway is
 *  the authority; this is a parity check, not a second source of truth.
 *
 *  Converts `requirements.maxAmountRequired` (ATOMIC USDC, 6 decimals) → cents, refusing
 *  a mainnet network, a failed settle, a non-0x tx, and a sub-cent residue (exactly as
 *  the Rust extractor does). */
export function extractCost(response) {
  if (!response || typeof response !== "object") {
    throw new Error("not an x402 settlement response");
  }
  const req = response.requirements ?? {};
  const set = response.settlement ?? {};
  if (!TESTNETS.has(String(req.network))) {
    throw new Error(`x402 network ${req.network} is not a supported testnet — refusing`);
  }
  if (set.success !== true) {
    throw new Error("x402 settlement.success is false — a failed settle has no metered cost");
  }
  const tx = String(set.transaction ?? "");
  if (!tx.startsWith("0x") || tx.length <= 2) {
    throw new Error(`x402 settlement.transaction ${tx} is not a 0x… tx hash`);
  }
  const atomic = Number(req.maxAmountRequired);
  if (!Number.isInteger(atomic) || atomic < 0) {
    throw new Error(`x402 maxAmountRequired ${req.maxAmountRequired} is not a non-negative integer`);
  }
  if (atomic % USDC_ATOMIC_PER_CENT !== 0) {
    throw new Error(`x402 maxAmountRequired ${atomic} atomic USDC is a sub-cent amount — refusing`);
  }
  return {
    amount_cents: atomic / USDC_ATOMIC_PER_CENT,
    rail: "x402",
    reference: tx,
  };
}
