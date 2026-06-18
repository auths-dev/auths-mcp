#!/usr/bin/env node
// paid-stub.mjs — a stub MCP downstream with ONE metered tool (`paid_call`) that returns a RECORDED
// x402 SettlementResponse (NO real money). Lets the live-wire check exercise the gateway's metered
// path — extract the cost from the rail response, settle it, sign a settlement — hermetically.
// The shape matches the x402 SettlementResponse + PaymentRequirements the real adapter returns:
// requirements.maxAmountRequired (atomic USDC, 6 decimals → cents) is the metered cost; the
// settlement.transaction is the on-chain reference. Dependency-free newline-delimited JSON-RPC.

const PROTOCOL_VERSION = "2024-11-05";

// 1500000 atomic USDC = 1.50 USDC = 150 cents (the gateway extracts this, it is NOT declared here).
const RECORDED_X402 = {
  rail: "x402",
  requirements: {
    scheme: "exact",
    network: "base-sepolia",
    maxAmountRequired: "1500000",
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
    extra: { name: "USDC", version: "2" },
  },
  settlement: {
    success: true,
    transaction: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    network: "base-sepolia",
    payer: "0x857b06519E91e3A54538791bDbb0E22373e36b66",
  },
};

const TOOLS = [
  {
    name: "paid_call",
    description: "A metered x402 call (stub — returns a recorded base-sepolia settlement, no money).",
    inputSchema: {
      type: "object",
      properties: { amount_atomic: { type: "integer" }, network: { type: "string" } },
    },
  },
];

async function handle(method, params) {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "paid-stub", version: "0.1.0", mode: "hermetic" },
      };
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call":
      return {
        content: [{ type: "text", text: JSON.stringify(RECORDED_X402) }],
        isError: false,
      };
    case "notifications/initialized":
      return null;
    default:
      throw { code: -32601, message: `method not found: ${method}` };
  }
}

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
    return;
  }
  const { id, method, params } = msg;
  try {
    const result = await handle(method, params);
    if (id === undefined || result === null) return;
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
