# Anthropic (Claude)

Anthropic's Claude is the live model that drives the **believability leg**: a real
`claude-opus-4-8` tool-loop runs a short code-triage task behind the gateway and, mid-task,
decides to patch a file it was only granted permission to *read and comment on*. That
emergent out-of-bounds `write_file` is the beat the gateway refuses at the boundary.

This is **drop-in** — the recorder already exists. Adding a key flips it from *deferred* to
*recording*.

## Prerequisites

- An **Anthropic API key** (`sk-ant-…`). Get one from the
  [Anthropic Console](https://console.anthropic.com/).
- Python 3.

## Setup

```bash
export ANTHROPIC_API_KEY=sk-ant-...        # a real key — required
python3 examples/live/record.py --out transcript.recorded.json
```

`record.py` drives a real Anthropic tool-loop and records each `tools/call` the model emits
into the **same transcript schema** the hermetic replay mode consumes. The model, system
prompt, and injected task are all disclosed on screen when the run executes.

`ANTHROPIC_AUTH_TOKEN` is accepted as an alternative to `ANTHROPIC_API_KEY`.

## No key → deferred, not faked

If neither `ANTHROPIC_API_KEY` nor `ANTHROPIC_AUTH_TOKEN` is set, `record.py` records
nothing and exits `3`. The committed frozen replay transcript stands in for it until you
attach a real recording. It does **not** stub a model or fabricate a run.

| Exit | Meaning |
| --- | --- |
| `0` | a real run was recorded to `--out` |
| `3` | no API key — recording **deferred** (out-of-band evidence); not a failure |
| `1` | a real run was attempted but failed (network/model) — reported honestly |

## What the key finishes vs. what's already proven

- **Already proven without a key (hermetic, gated):** the gateway bounds the agent's tool
  calls deterministically over the committed transcript — byte-stable verdicts, tampered
  transcripts fail closed.
- **Finished by the Anthropic key:** the *live* recording — proof that a real model, left
  to its own decisions, produces the out-of-bounds call the gateway refuses. This is the
  visceral demo beat, and it is evidence, never the gate.

## Notes

- The recording is **out-of-band believability evidence**, attached alongside the suite —
  it is not part of the automated check.
- An Anthropic key does **not** touch the payment rails; for those see
  **[Payment Providers](../payment-providers/index.md)**.
