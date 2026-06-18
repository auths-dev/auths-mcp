#!/usr/bin/env node
// stub-downstream.mjs — a minimal MCP server the live-wire check wraps as the downstream.
// One non-metered `read` tool that returns a fixed result. Dependency-free newline-delimited
// JSON-RPC over stdio, matching the gateway's downstream client (see the payment adapters).

const PROTOCOL_VERSION = "2024-11-05";

const TOOLS = [
  {
    name: "read_file",
    description: "Read a file (stub — returns a fixed result, no real I/O).",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "The path to read." } },
    },
  },
  {
    name: "write_file",
    description:
      "Write a file (stub). Present so the live-wire check can prove an OUT-OF-SCOPE call is " +
      "refused by the gateway BEFORE it reaches this downstream.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        contents: { type: "string" },
      },
    },
  },
];

async function handle(method, params) {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "stub-downstream", version: "0.1.0" },
      };
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call": {
      const args = params?.arguments ?? {};
      const path = args.path ?? "(unknown)";
      return {
        content: [{ type: "text", text: `# ${path}\n…contents of ${path}…` }],
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
    return;
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
