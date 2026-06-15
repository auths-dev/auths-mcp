# Live mode — record a real Claude tool-loop (the believability leg)

This is the **evidence** half of the bounded-agent gateway. A real
MCP-speaking model runs a short code-triage task against tools behind the
gateway, and the model *itself* — mid-task — decides to patch a file it was only
granted permission to read and comment on. That emergent out-of-bounds
`write_file` is the beat the gateway refuses at the boundary.

```
export ANTHROPIC_API_KEY=sk-ant-...        # a REAL key — required
python3 record.py --out transcript.recorded.json
```

`record.py` drives a real **Anthropic (Claude) API tool-loop** (`claude-opus-4-8`)
and records each `tools/call` the model emits into the **same transcript schema**
the hermetic replay mode consumes.

## Live is evidence — never the hermetic check

The recording is **out-of-band believability evidence**. The hermetic check never
runs the model: replay mode drives a **frozen, committed transcript** (under
`examples/replay/`) deterministically — no model, no network, byte-stable
verdicts. The frozen transcript is what gets checked; the live recording proves
the over-reach is *genuinely emergent*, not a hardcoded string.

## No key → deferred, not faked

If no `ANTHROPIC_API_KEY` (or `ANTHROPIC_AUTH_TOKEN`) is present, `record.py`
**exits 3 and records nothing** — the live recording is *deferred* as out-of-band
evidence, to be attached later. It does **not** stub a model or fabricate a run.
The committed frozen replay transcript stands in for it in the meantime.

| Exit | Meaning |
| --- | --- |
| `0` | a real run was recorded to `--out` |
| `3` | no API key — recording **deferred** (out-of-band evidence); not a failure |
| `1` | a real run was attempted but failed (network/model) — reported honestly |

The model, system prompt, and injected task are all disclosed on screen when the
run executes.
