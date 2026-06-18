# Milestone 8 — The demo suite (packaged, runnable, recorded)

> **Goal.** Every hero demo runs from one command (hermetic default + live opt-in) and has a ≤90-second recording — each engineered to make a specific stakeholder feel the ground move.
> **Strategy.** The demos are how the wedge sells. They must be reproducible, honest, and the *same gated path* as the tests — never a separate happy path.
> **Status today.** Scenario configs + adapters + the `--check` gate exist; the demos are not yet packaged or filmed.

## Why
"Bounded, revocable, self-verifiable authority across a boundary you don't own" is abstract until someone *watches* a $1 call get refused before money moves, or an attacker's stolen credential do nothing. The suite turns the moat into a felt experience for the exact people who can't build it.

## The through-line
Every scene works **across a boundary the vendor doesn't own** and is **verifiable without trusting anyone in the middle** — the thing a platform can't ship without dismantling its own lock-in. If a demo doesn't make a Stripe/Anthropic person think *"we structurally can't ship that,"* it isn't a hero demo.

## Where the work lands
| Epic | Repo | Path |
|---|---|---|
| 8.1 One command per demo | `auths-mcp` | `examples/` (reuse scenarios + adapters) |
| 8.2 Record ≤90s | `auths-mcp` | recordings |
| 8.3 "The token that does nothing" | `auths-mcp` | new scenario + recording |

## Epics & subtasks
### 8.1 — One command per demo · `auths-mcp`
- Each demo = a config + a runner that reuses the **same** `examples/scenarios/*` + `examples/payments/*` + adapters the `--check` gate and tests use. Hermetic by default; `--live` opt-in disclosed on screen.

### 8.2 — Record each ≤90s · `auths-mcp`
- asciinema/screen capture of the *real* run, not a mockup.

### 8.3 — "The token that does nothing" (NEW — confirmed) · `auths-mcp`
- New scenario + recording. Details below.

## The suite

**Cold open — "One line. A tool you didn't write. Bounded."** *(needs M1, M7)*
```
npx @auths/mcp wrap --scope fs.read --budget $5 --ttl 30m -- \
  npx -y @modelcontextprotocol/server-filesystem ~/project
```
A live agent is hard-bounded against a stock server the author never heard of auths. The adoption surface.

**Demo 1 — "The $5 that spans the walled gardens" → Stripe** *(needs M3)*
$2 Stripe + $2.50 USDC, then $1 on either rail → `UsageCapExceeded` before the charge. *Stripe can't cap "$5 across Stripe and everything else"; only a budget above both rails can, and neither vendor was in the loop.*

**Demo 2 — "Revoke a tool you don't host" → Anthropic** *(needs M1, M2)*
Mid-task, hit revoke; the agent's next call to a third-party tool is refused `Revoked` — no vendor cooperation, no propagation window.

**Demo 3 — "Don't trust the operator" → the marketplace nightmare** *(needs M2)*
The gateway is run by a hostile operator who tries to lift the budget, forge a receipt, and drop a call. All three fail; your independent `auths audit` re-derives the true spend. *The feature whose whole point is that you don't have to trust them.*

**Demo 4 — "Agents hiring agents, bounded all the way down"** *(needs M4)*
Manager $100 → research $10 → scraper $1; the injected scraper can't spend $2; one revoke at the root kills the subtree.

**Demo 5 — "Prompt-inject it. It still can't."** *(needs M1, M6)*
The model is injected to delete the repo and wire $1,000; it *tries*; the gate refuses each on scope/budget. *Enforcement is below the model — guardrails are suggestions; this is physics.*

### Demo 6 (8.3) — "The token that does nothing" → every security/eng leader *(needs M1, M2; ties to the Novo Nordisk breach)*
- **The setup.** Side by side: (left) a classic leaked **GitHub PAT / API key** committed to a public repo; (right) an auths "credential" leaked the **same** way.
- **The moment.** An attacker grabs both. The left one **owns everything** — broad, ambient, long-lived access (the Novo Nordisk pattern: a token in a repo → two months → 1.3 TB → $25M ransom). The right one does **nothing**: it's a *public identifier* (no private key to bear), or a **scoped, short-TTL, revocable** delegation — expired, out-of-scope, or revoked in one signed event. There is no bearer secret in the repo to steal. In auths-mcp specifically, the agent never even holds a token: each call is a **signed per-action proof** (`verify_commit_against_kel_scoped`), and the real downstream secret is held by the gateway's `CustodyVault`, injected into the *downstream* child, never the agent's reach.
- **The gut-punch.** *The exact thing that cost Novo Nordisk 1.3 TB and a $25M ransom — a token sitting in a repo — is not a thing that exists in this model. And your secrets manager (Vault, a cloud key store) is itself the next crown-jewel honeypot; auths has no central secret to steal and verifies offline.*
- **Honesty guardrail (must be on screen):** this **shrinks blast radius + dwell time and makes access revocable and auditable** — it does **not** make breach impossible. A stolen *live* delegation still works to its scope inside its window; the win is TTL + scope + instant revoke + signed audit, not "unbreakable."
- **Proves.** "No long-lived unbounded bearer secret" + cross-boundary, no-central-broker verification.

## Grounded sketch — a demo is the gate, filmed
```bash
auths-demo cross-rail          # hermetic by default (fixtures); exits non-zero on ANY verdict miss
auths-demo cross-rail --live   # opt-in: real sk_test_ + funded testnet wallet, disclosed on screen
auths-demo token-does-nothing  # the leaked-credential side-by-side
```

## Rigor — don't be sloppy
- **DRY:** demos reuse the exact configs + adapters the gate/tests use. A demo-only fork is theater — the demo's assertion **is** the `--check` gate, not a separate happy path.
- **Honesty:** hermetic by default, live opt-in disclosed on screen, never a faked verdict (`record.py`'s exit-3-on-no-key discipline is the model). No `exit 0` that wasn't earned. The token demo carries its "shrinks, not unbreakable" caption.
- **Reproducible:** one command on a clean machine (depends on M7); the recording is of the real run.

## Done-when (acceptance)
- [ ] Cold open + Demos 1–6 each run from one command (hermetic default + `--live` opt-in).
- [ ] Each has a ≤90-second recording of the real run.
- [ ] Each demo's assertion is the shared gate, not a bespoke path.
- [ ] The token demo displays the honesty caption on screen.

## Dependencies
- **Blocked by:** the milestones each demo cites (M1–M6) + M7 (one-command on a clean machine).
