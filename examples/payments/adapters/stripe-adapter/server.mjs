#!/usr/bin/env node
// server.mjs — the near-pluggable Stripe-test MCP server (AGENT-PAY-1).
//
// A wrapped downstream MCP server the gateway proxies. It exposes ONE paid tool —
// `paid_call` (a Stripe TEST-MODE charge) — and returns the Stripe Charge object the
// gateway EXTRACTS the metered cost from (`charge.amount_captured`, cents). The gateway
// never learns Stripe's shape; this adapter is the only place that does (PRD §11,
// bound-don't-build). `auths-mcp-core` holds zero payment code.
//
// The gateway is the metering authority: it reads the cost out of the response THIS
// returns and reserves/settles it against the cross-rail cap (refusing an over-cap
// charge BEFORE this adapter is even asked to settle, since the reservation is checked
// before the rail is touched). The adapter just produces the rail response.
//
// Dependency-free: a minimal MCP JSON-RPC-over-stdio server (initialize / tools/list /
// tools/call), matching this repo's no-toolchain launcher. The Stripe call uses Node's
// built-in `fetch` (Node ≥18). See charge.mjs for the LIVE vs HERMETIC charge core.
//
// LIVE vs HERMETIC: with a `sk_test_…` key in the env (the gateway custodies it, never
// the agent) it issues a REAL test-mode charge; with no key it returns the recorded
// test-mode Charge fixture's shape so it is runnable and self-checkable without a key.
// The live charge is real and evidence-only (no key in this env) — never faked.

import { charge as issueCharge, extractCost, hasTestKey } from "./charge.mjs";

const PROTOCOL_VERSION = "2024-11-05";

const TOOLS = [
  {
    name: "paid_call",
    description:
      "Issue a Stripe TEST-MODE charge and return the Charge object. The gateway extracts " +
      "the metered cost from charge.amount_captured (cents) and meters it against the " +
      "cross-rail cap. A charge that would cross the cap is refused by the gateway BEFORE " +
      "this tool is invoked.",
    inputSchema: {
      type: "object",
      properties: {
        amount_cents: {
          type: "integer",
          description: "The intended charge amount in cents (the AUTHORITATIVE cost is read back from the response).",
        },
        currency: { type: "string", description: "ISO currency (usd).", default: "usd" },
        endpoint: { type: "string", description: "The rail endpoint (e.g. /charge)." },
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
          name: "stripe-adapter",
          version: "0.1.0",
          mode: hasTestKey() ? "live-test" : "hermetic",
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
      const charge = await issueCharge({
        amountCents: args.amount_cents,
        currency: args.currency ?? "usd",
      });
      const cost = extractCost(charge);
      // Return the FULL Charge object (the gateway extracts amount_captured itself) plus
      // a convenience echo of the extracted cost. The cost the gateway meters is read
      // from `charge.amount_captured`, not from this echo.
      return {
        content: [{ type: "text", text: JSON.stringify({ rail: "stripe", charge, extracted: cost }) }],
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
