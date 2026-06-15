# Examples — the live show, the replay gate, and the three scenario configs

The product's own examples (not `auths-demos`). One gateway, two modes, three
configs (PRD §7).

## Two modes, one gateway

- **Live mode** — `live/record.py` (the believability leg, PRD §7 / D7). A real
  Anthropic (Claude) API tool-loop runs a short code-triage task against tools
  behind the gateway; the model *itself* emits an out-of-bounds `tools/call`,
  which `record.py` captures into the same transcript schema the gate replays.
  This leg is **evidence-only, never gated** — with a real `ANTHROPIC_API_KEY`
  it records a run; with no key it **defers** (records nothing, never fakes a
  run) and the committed frozen transcript stands in for the gate. See
  `live/README.md`.
- **Replay mode** — `../run.sh --check`. Drives the gateway from the **frozen
  transcript** in `replay/transcript.json` — no network, no model, deterministic
  verdicts. This is the hermetic gate `matrix --gate` runs. Editing the transcript
  to drop a proof or forge a wider scope must still fail closed.

## The three scenarios are configs, not demos

| Config | Scenario | The beat |
| --- | --- | --- |
| `scenarios/scope.config.json` | the **intern** | grant `{fs.read}`; model tries `fs.write` → `OutsideAgentScope` |
| `scenarios/budget.config.json` | the **credit-limit** | grant `$5`; model loops a metered tool past it → `UsageCapExceeded` |
| `scenarios/killswitch.config.json` | the **agent-that-wouldn't-die** | revoke mid-run → next call `Revoked` |

Each is ~20 lines over the *same* binary — proving the O(n)-bash-demos →
O(1)-product collapse.

> **Status: placeholders.** Config keys and the recorded transcript are pinned
> during the build (the broker + replay scenarios). The shapes here show the
> intended surface.
