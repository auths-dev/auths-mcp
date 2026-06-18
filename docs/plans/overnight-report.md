# Overnight build report — `dev-agentMoney`

Autonomous `/loop` run against the milestone plan in `docs/plans/`. Branch: `dev-agentMoney`
(both repos). Rules in force: park-don't-fake · no push · no publish · no mainnet · secrets
never logged/committed · adversarial review on the **code** milestones (M2/M3.2/M4/M6);
self-review on trivial doc/shell changes (noted per row).

> **Two diffs to give your own eyes regardless** (flagged as work lands): the `auths audit`
> verifier (M2) and the EIP-3009 payment code (M3.2).

## Status table

| Milestone | Status | Confidence | Needs your eyes |
|---|---|---|---|
| M1.4 cleanups | ✅ done | high | no |
| M1 live transcript | ✅ done (round-trip) | high | no — but see note¹ |
| M2 the moat | ⏳ queued | — | **yes (verifier)** |
| M3 cross-rail (hermetic) | ⏳ queued | — | — |
| M3.2 x402 EIP-3009 + real settle | ⏳ queued | — | **yes (payment code)** |
| M4 delegation tree | ⏳ queued | — | — |
| M6 hardening | ⏳ queued | — | — |
| M5 console scaffold | ⏳ queued | — | — |
| M8 demos | ⏳ queued | — | — |

## Iteration log

### Iteration 1 — setup + M1.4 (start)
- Confirmed both repos on `dev-agentMoney`; gateway binary present; `auths/.env` correctly
  gitignored (secret invisible). Only uncommitted items were my own untracked planning docs.
- **M1.4a (README de-stale):** the `## Status` block still said *"Scaffold. The product isn't
  built yet… `--check` currently exits non-zero… the gateway is a stub"* — stale: the gateway
  is built and `--check` is GREEN. Rewritten to reflect reality.
- **M1.4b (run.sh assertion):** the gateway's own non-zero exit on any verdict divergence is
  the **authoritative structured gate**; the shell `grep "verdict.*$verdict"` is a redundant
  secondary check whose only flaw was loose substring matching. Tightened to an exact
  word-boundary token match (no gateway change needed — a JSON-emission rewrite would be
  disproportionate for a redundant check). Documented that the Rust exit-code is the real gate.
- Review: doc + shell only → self-reviewed (full adversarial subagent reserved for the code
  milestones). Gate: `./run.sh --check` re-run.

### Iteration 2 — M1 live (real recording + replay round-trip)
- System Python had a stale `anthropic` (0.18.1) that crashed on newer `httpx` (`proxies=`
  TypeError) — **not a fake, an env mismatch**. Isolated a throwaway venv with current
  `anthropic` (0.109.2); the key loaded from `auths/.env` via `set -a; . auths/.env; set +a`
  (never echoed/committed).
- **Recorded a REAL `claude-opus-4-8` tool-loop** (`examples/live/record.py`): the model read
  the two files and posted a `create_comment` triage — 3 calls, all in-scope (`fs.read`,
  `github.comment`). It even self-declined to over-reach, citing read+comment-only delegation.
- Made `run.sh` honor a `TRANSCRIPT=…` override (1 line; default fixture unchanged). Verified:
  the recorded transcript **replays GREEN through the gateway** (live→record→replay round-trip
  proven), and the committed fixture still passes. Evidence: `examples/live/transcript.recorded.json`
  (secret-scanned clean).
- **¹ Note (honest):** this run had **no emergent over-reach**, so it only exercises the
  `allowed` verdict. The live *refusal* (`outside-agent-scope`) is covered by the committed
  fixture (`examples/replay/transcript.json`: read=allowed, write=refused) + the hermetic
  `--check`, not by a live recording. Re-running `record.py` would eventually capture an
  emergent `write_file` over-reach for a live-refusal transcript — left as optional (didn't
  burn repeated API runs chasing emergent behavior).
- Review: data + 1-line shell → self-reviewed (secret scan clean, both `--check` paths green,
  fixture intact). Did NOT overwrite the committed fixture.
