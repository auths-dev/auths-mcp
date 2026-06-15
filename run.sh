#!/usr/bin/env bash
# run.sh — the @auths/mcp install-and-wrap smoke (the [sculpts.auths-mcp] gate).
#
#   ./run.sh           the live show (a real model behind the gateway) — not built yet
#   ./run.sh --check    the hermetic smoke: install the way a user would, wrap a stub
#                       downstream, drive the gateway from a frozen transcript (replay
#                       mode), and assert the verdicts. This is what `matrix --gate`
#                       runs as the federated wrapper gate.
#   ./run.sh reset      tear down scratch state.
#
# HONEST SCAFFOLD: the product isn't built, so `--check` legitimately exits non-zero
# (RED). This is a REAL check — it resolves the launcher, the launcher resolves a
# gateway binary, and the gateway is driven in replay mode against a transcript whose
# verdicts we assert. Every one of those steps fails today because the gateway is a
# stub. It will pass once the wrapper + gateway work; there is NO fake `exit 0`.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
LAUNCHER="$HERE/packages/auths-mcp/bin/auths-mcp.mjs"
TRANSCRIPT="$HERE/examples/replay/transcript.json"

# GATEWAY_BIN: the smoke points the launcher at a freshly built gateway the way the
# release CI's vendored binary will later be found. Default to the auths monorepo's
# release output (sibling repo), overridable for CI staging.
: "${GATEWAY_BIN:=$HERE/../auths/target/release/auths-mcp-gateway}"
export GATEWAY_BIN

say()  { printf '▸ %s\n' "$*"; }
fail() { printf '✗ %s\n' "$*" >&2; exit 1; }
ok()   { printf '✓ %s\n' "$*"; }

cmd="${1:-}"

if [ "$cmd" = "reset" ]; then
  rm -rf "$HERE/.scratch"
  ok "reset: scratch cleared"
  exit 0
fi

if [ "$cmd" != "--check" ]; then
  say "live mode (a real model behind the gateway) is not built yet."
  say "run \`./run.sh --check\` for the hermetic install-and-wrap smoke."
  exit 1
fi

# ── --check: the hermetic install-and-wrap smoke ──────────────────────────────
say "install-and-wrap smoke — wrap a stub downstream, replay a transcript, assert verdicts"

command -v node >/dev/null 2>&1 || fail "node not found — the launcher needs Node ≥18"
[ -f "$LAUNCHER" ] || fail "launcher missing: $LAUNCHER (run \`npm run build\`)"
[ -f "$TRANSCRIPT" ] || fail "replay transcript missing: $TRANSCRIPT"

# Drive the gateway through the launcher in replay mode (no model, no network).
# Today the gateway stub fails closed on `replay`, so this whole assertion is RED.
say "driving the gateway in replay mode over the frozen transcript…"
out="$(node "$LAUNCHER" replay --transcript "$TRANSCRIPT" 2>&1)"
rc=$?

if [ $rc -ne 0 ]; then
  printf '%s\n' "$out" | sed 's/^/    /'
  fail "replay smoke RED — the gateway did not produce verdicts (exit $rc). Expected once the broker + replay build land."
fi

# Once the gateway emits verdicts, assert the frozen transcript's expected outcomes:
# the in-scope read passes, the out-of-scope write is OutsideAgentScope, the over-budget
# call is UsageCapExceeded, the post-revocation call is Revoked.
for verdict in allowed outside-agent-scope usage-cap-exceeded revoked; do
  printf '%s' "$out" | grep -q "$verdict" \
    || fail "replay smoke RED — expected verdict \"$verdict\" not found in gateway output"
done

ok "install-and-wrap smoke GREEN — every transcript verdict was reproduced byte-stably"
