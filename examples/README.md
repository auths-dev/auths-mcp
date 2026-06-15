# Examples — the live show, the replay gate, and the three scenario configs

The product's own examples (not `auths-demos`). One gateway, two modes, three
configs (PRD §7).

## Two modes, one gateway

- **Live mode** — `../run.sh`. A real MCP-speaking model runs a short task against
  tools behind the gateway; the audience watches the model *itself* emit an
  out-of-bounds `tools/call` and the gateway refuse it with a named verdict, then
  watch an in-bounds call succeed with a real downstream result + a receipt.
  *(Not built yet — requires a model endpoint.)*
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
