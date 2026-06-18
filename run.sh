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
# Defaults to the committed gate fixture; override with TRANSCRIPT=… to replay a recorded
# transcript (e.g. one captured by examples/live/record.py) through the same sandbox.
TRANSCRIPT="${TRANSCRIPT:-$HERE/examples/replay/transcript.json}"

# GATEWAY_BIN: the smoke points the launcher at a freshly built gateway the way the
# release CI's vendored binary will later be found. Default to the auths monorepo's
# release output (sibling repo), overridable for CI staging.
: "${GATEWAY_BIN:=$HERE/../auths/target/release/auths-mcp-gateway}"
export GATEWAY_BIN

# A throwaway, fully self-contained sandbox under .scratch/ (gitignored). The
# gateway's `replay` builds a real delegation chain, which shells the `auths` CLI's
# `id create`; that step needs a HEADLESS keychain. The platform default backend on
# macOS is the secure enclave, which (correctly) refuses passphrase-less public-key
# export — AUTHS-E4203. So we mirror the demo harnesses (the-intern-that-couldnt,
# the suite's own harness/env.sh): pin the FILE keychain backend with a fixed
# test-only passphrase, and override HOME / AUTHS_HOME / git config so the smoke can
# NEVER touch the user's real ~/.auths, ~/.gitconfig, or system git. Self-contained
# in this wrapper — no ~/.auths.
SCRATCH="$HERE/.scratch"
# LAB_DIR is honored by `auths-mcp-gateway replay` as the lab root it builds the
# throwaway registry (and where AUTHS_HOME/keychain resolve) under.
export LAB_DIR="$SCRATCH/lab"
export HOME="$SCRATCH/home"
export AUTHS_HOME="$LAB_DIR/registry"
export AUTHS_REPO="$LAB_DIR/registry"
export AUTHS_KEYCHAIN_BACKEND="file"
export AUTHS_KEYCHAIN_FILE="$LAB_DIR/keys.enc"
# Fixed, obviously-test-only passphrase (12+ chars, 3 character classes). Not a secret.
export AUTHS_PASSPHRASE="Mcp-Sm0ke-Wrap!"
export GIT_CONFIG_GLOBAL="$SCRATCH/home/.gitconfig"
export GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME="Parent Root";    export GIT_AUTHOR_EMAIL="root@auths.demo"
export GIT_COMMITTER_NAME="Parent Root"; export GIT_COMMITTER_EMAIL="root@auths.demo"
# The gateway locates the `auths` CLI + signer beside GATEWAY_BIN by default; pin
# them explicitly when present so a relocated gateway still resolves headlessly.
GW_DIR="$(cd "$(dirname "$GATEWAY_BIN")" 2>/dev/null && pwd || true)"
[ -n "$GW_DIR" ] && [ -x "$GW_DIR/auths" ]      && export AUTHS_BIN="$GW_DIR/auths"
[ -n "$GW_DIR" ] && [ -x "$GW_DIR/auths-sign" ] && export AUTHS_SIGN="$GW_DIR/auths-sign"

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

# Start from a clean sandbox: `id create` (org root) is non-idempotent — a stale
# registry from a prior run fails "Identity already exists". Each --check is hermetic.
rm -rf "$SCRATCH"
mkdir -p "$HOME" "$AUTHS_HOME"

# Drive the gateway through the launcher in replay mode (no model, no network).
# The gateway re-derives a verdict for every call from the signed chain and checks
# it against that call's transcript `expect`; it exits non-zero on ANY divergence.
say "driving the gateway in replay mode over the frozen transcript…"
out="$(node "$LAUNCHER" replay --transcript "$TRANSCRIPT" 2>&1)"
rc=$?

if [ $rc -ne 0 ]; then
  printf '%s\n' "$out" | sed 's/^/    /'
  fail "replay smoke RED — the gateway did not reproduce the transcript's verdicts (exit $rc)."
fi

# The gateway's own exit 0 is the AUTHORITATIVE gate: in replay it re-derives each call's
# verdict from the signed chain and exits non-zero on ANY divergence from the transcript's
# `expect`. We re-assert independently here as a secondary smoke: extract the set of verdicts
# the FROZEN transcript exercises (its `expect` fields) and confirm each is present in the
# gateway's verdict stream — matched as an EXACT token (word-bounded, never a loose
# substring), so e.g. `allowed` can't spuriously match inside another verdict. Deriving the
# expectations from the transcript keeps the smoke honest as the committed scenario evolves.
expects="$(grep -oE '"expect"[[:space:]]*:[[:space:]]*"[a-z-]+"' "$TRANSCRIPT" \
             | grep -oE '[a-z-]+"$' | tr -d '"' | sort -u)"
[ -n "$expects" ] || fail "replay smoke RED — the transcript declares no \`expect\` verdicts to assert"

for verdict in $expects; do
  printf '%s' "$out" | grep -qE "(^|[^a-z-])$verdict([^a-z-]|\$)" \
    || fail "replay smoke RED — transcript expects verdict \"$verdict\" but it is absent from the gateway output"
done

ok "install-and-wrap smoke GREEN — every verdict the frozen transcript exercises ($(echo $expects | tr '\n' ' ')) was reproduced byte-stably"

# ── M2 "the moat" — offline self-audit of the spend log the run just wrote ──────────────────
# The clean run's gateway-written spend log must re-verify OFFLINE as `consistent`: every signed
# proof re-verifies through the same verifier the gate uses, and the re-derived spend matches.
printf '%s' "$out" | grep -q "audit: consistent" \
  || { printf '%s\n' "$out" | sed 's/^/    /'; fail "self-audit RED — the clean run's spend log did not re-verify as \`consistent\`"; }
ok "self-audit GREEN — the clean run's spend log re-verified offline as consistent"

# Red-team: a TAMPERED signed proof in the log is CAUGHT by the offline audit. A fresh sandbox so
# the tampered run cannot collide with the clean one. The replay itself exits non-zero (the live
# gate ALSO refuses the forged calls) — expected; we assert the OFFLINE audit independently catches
# it, i.e. a hostile operator cannot hand you a doctored log that audits clean.
say "audit red-team: tampering every signed proof, then re-auditing the persisted log…"
tlab="$SCRATCH/lab-tamper"
tamper_out="$(LAB_DIR="$tlab" AUTHS_HOME="$tlab/registry" AUTHS_REPO="$tlab/registry" \
  AUTHS_KEYCHAIN_FILE="$tlab/keys.enc" AUTHS_MCP_REPLAY_TAMPER=1 \
  node "$LAUNCHER" replay --transcript "$TRANSCRIPT" 2>&1 || true)"
printf '%s' "$tamper_out" | grep -q "audit: tampered-proof" \
  || { printf '%s\n' "$tamper_out" | sed 's/^/    /'; fail "audit red-team RED — a tampered proof was NOT caught by the offline audit"; }
ok "audit red-team GREEN — the offline audit independently caught a tampered proof (tampered-proof)"

# The offline `verify-spend` CLI: a SEPARATE process re-audits the same log + registry from disk —
# the moat as a standalone tool an external party can run, not just an in-process self-check.
audit_args="$(printf '%s' "$out" | sed -n 's/.*audit-cmd: //p' | head -1)"
[ -n "$audit_args" ] || fail "verify-spend RED — the replay emitted no audit-cmd line to re-run"
# shellcheck disable=SC2086
vs_out="$("$GATEWAY_BIN" verify-spend $audit_args 2>&1 || true)"
printf '%s' "$vs_out" | grep -q "verify-spend: consistent" \
  || { printf '%s\n' "$vs_out" | sed 's/^/    /'; fail "verify-spend RED — the standalone CLI did not re-audit the log as consistent"; }
ok "verify-spend CLI GREEN — a standalone process re-audited the gateway-written log offline as consistent"
