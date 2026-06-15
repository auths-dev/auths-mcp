# AI Providers

An **AI provider** supplies the live model that drives the agent tool-loop — the
*believability leg* of the gateway. A real model runs a task against tools behind the
gateway and, mid-task, **decides on its own** to do something it wasn't granted; the
gateway refuses that call at the boundary. Because the over-reach is the model's own
decision (not a hardcoded script), it proves the enforcement holds against a realistic
agent.

## Live is evidence — never the automated check

The live model run is **out-of-band evidence**. The hermetic check never runs a model: it
replays a **frozen, committed transcript** deterministically (no model, no network,
byte-stable verdicts). The frozen transcript is what gets gated; the live recording proves
the over-reach is *genuinely emergent*.

So: **you only need an AI-provider key to record live evidence.** The gateway's enforcement
is proven without one.

## How a provider plugs in

The recorder (`examples/live/record.py`) drives the provider's API in a tool-loop and
records each `tools/call` the model emits into the transcript schema the replay mode
consumes. Setting a provider's key switches the recorder from *deferred* to *recording* —
it never stubs or fabricates a run.

## Providers

| Provider | Model | Page |
| --- | --- | --- |
| **Anthropic** | `claude-opus-4-8` | **[Anthropic (Claude) →](anthropic.md)** |
