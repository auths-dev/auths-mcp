#!/usr/bin/env node
// server.mjs — the testnet-flagged x402/USDC MCP server (AGENT-PAY-2).
//
// A wrapped downstream MCP server the gateway proxies. It exposes ONE paid tool —
// `paid_call` (an x402/USDC settle on base-sepolia) — and returns the x402
// SettlementResponse + PaymentRequirements the gateway EXTRACTS the metered cost from
// (`requirements.maxAmountRequired`, ATOMIC USDC at 6 decimals → cents). The gateway
// never learns x402's shape; this adapter is the only place that does (PRD §11,
// bound-don't-build). `auths-mcp-core` holds zero payment code.
//
// The cross-rail moat (PRD §11): the gateway meters the extracted x402 cost into the
// SAME cross-rail cap as the Stripe rail. A small x402 amount that a per-rail x402 silo
// would wave through is refused `usage-cap-exceeded` when, summed with the Stripe spend,
// it would cross the one cap — the reservation refuses BEFORE this tool is asked to
// settle (the reservation is checked before the rail is touched). The adapter just
// produces the rail response.
//
// Dependency-free: a minimal MCP JSON-RPC-over-stdio server (initialize / tools/list /
// tools/call), matching this repo's no-toolchain launcher. See settle.mjs for the LIVE
// vs HERMETIC settle core.
//
// *** LIVE x402 SCOPE FLAG ***  Unlike Stripe, a KEY ALONE DOES NOT COVER x402: the LIVE
// on-chain settle needs a FUNDED base-sepolia USDC TESTNET WALLET *and* an x402
// facilitator URL (both in the gateway's custody vault, never the agent). Without both
// it runs HERMETIC (returns the recorded testnet settlement shape — NOT a faked on-chain
// settle, just the recorded response the gateway extracts from). The live settle is
// real, evidence-only (no wallet in this env), and is NEVER faked.

import { settle as doSettle, extractCost, hasLiveWallet } from "./settle.mjs";

const PROTOCOL_VERSION = "2024-11-05";

const TOOLS = [
  {
    name: "paid_call",
    description:
      "Settle an x402/USDC payment on the base-sepolia TESTNET and return the " +
      "SettlementResponse + PaymentRequirements. The gateway extracts the metered cost " +
      "from requirements.maxAmountRequired (atomic USDC, 6 decimals → cents) and meters " +
      "it into the SAME cross-rail cap as the Stripe rail. A call that would cross the " +
      "cap ACROSS rails is refused by the gateway BEFORE this tool is invoked.",
    inputSchema: {
      type: "object",
      properties: {
        amount_atomic: {
          type: "integer",
          description:
            "The intended amount in ATOMIC USDC, 6 decimals (the AUTHORITATIVE cost is read back from maxAmountRequired).",
        },
        network: { type: "string", description: "x402 network (base-sepolia).", default: "base-sepolia" },
        endpoint: { type: "string", description: "The rail endpoint (e.g. /metered-tool)." },
      },
    },
  },
];

/** Handle one JSON-RPC request, returning the result object (or throwing for an error). */
async function handle(method, params) {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: {
          name: "x402-adapter",
          version: "0.1.0",
          // honest mode flag: live needs a funded testnet WALLET + facilitator, not just a key.
          mode: hasLiveWallet() ? "live-testnet" : "hermetic",
          network: "base-sepolia",
        },
      };
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call": {
      const name = params?.name;
      if (name !== "paid_call") {
        throw { code: -32601, message: `unknown tool: ${name}` };
      }
      const args = params?.arguments ?? {};
      const response = await doSettle({
        amountAtomic: args.amount_atomic,
        network: args.network ?? "base-sepolia",
      });
      const cost = extractCost(response);
      // Return the FULL x402 response (the gateway extracts maxAmountRequired itself) plus
      // a convenience echo of the extracted cost. The cost the gateway meters is read from
      // requirements.maxAmountRequired, not from this echo.
      return {
        content: [{ type: "text", text: JSON.stringify({ ...response, extracted: cost }) }],
        isError: false,
      };
    }
    case "notifications/initialized":
      return null; // notification, no response
    default:
      throw { code: -32601, message: `method not found: ${method}` };
  }
}

// ── Minimal newline-delimited JSON-RPC over stdio ─────────────────────────────
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (line) void dispatch(line);
  }
});

async function dispatch(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return; // ignore non-JSON noise
  }
  const { id, method, params } = msg;
  try {
    const result = await handle(method, params);
    if (id === undefined || result === null) return; // notification
    respond({ jsonrpc: "2.0", id, result });
  } catch (err) {
    if (id === undefined) return;
    const error =
      err && typeof err === "object" && "code" in err
        ? err
        : { code: -32603, message: String(err?.message ?? err) };
    respond({ jsonrpc: "2.0", id, error });
  }
}

function respond(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}
