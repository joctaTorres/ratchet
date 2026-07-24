# attributed-failure-surface

## Why

When a per-stage `agent[:model]` spec names an invalid model id, the agent binary
rejects its argv and exits non-zero almost immediately — and today the surfaced step
failure is only a generic "Agent exited with code N" plus a raw stderr tail, with no
clue that a specific stage/agent/model/scope combination was in play. The operator has
to reverse-engineer the cross-scope merge to find which setting to fix. Phase 1 shipped
the spec parser and `stage-scope-resolution` shipped the per-stage supplying-scope
lookup; this change threads both to the failure surface.

## What Changes

- `resolveBatchSettings` additionally exposes `agentStageScopes` on
  `ResolvedBatchSettings` — the per-stage supplying scope of the resolved `agent`
  setting, computed by the already-shipped `resolveAgentStageScopes` over the same
  low→high layers the merge already builds. Resolved `settings` and `sources` stay
  byte-for-byte unchanged.
- The engine step context (`BaseStepContext` in `engine/contract.ts`) gains an
  optional `agentStageScopes` field; `batch apply` threads it from settings
  resolution into every change-step context.
- `Engine.buildSpawnRequest` additionally returns the `AgentSpec` it already parses
  once per transition; `runChangeStep` builds a model attribution — stage, agent,
  exact model string, supplying scope — only when the parsed spec explicitly names a
  model AND the context carries a scope for the running transition's stage, and hands
  it through `spawnAndMap` into `mapSessionToOutcome`.
- `mapSessionToOutcome` (`engine/outcome.ts`): `MapOutcomeInput` gains an optional
  `modelAttribution`. On the failed branch only (non-zero exit, no completion), when
  attribution is present AND the agent wrote zero journal entries during the session
  (the argv-rejection signature), the outcome's `detail` opens with the attribution
  hint — phrased as "if this model id is invalid…", never a diagnosis — above the
  existing truncated stderr tail. Every other input surfaces byte-for-byte today's
  output; `blocker` and `message` are untouched even when the hint fires.
- No retry, no fallback model, no new outcome state: the enriched failure still maps
  `failed` → `blocked` and parks through the existing flow.
- Implements `features/model-failure-attribution/attribution-hint.feature` and
  `features/model-failure-attribution/unchanged-surfaces.feature`.

## Design

**Enrichment fires on a signature, never on stderr content.** Locked in the batch
brainstorm: agent error text differs per agent and version, so pattern-matching stderr
would rot. The gate is structural — explicit model in the parsed spec, non-zero exit
(or signal), no completion entry, and zero session journal entries (an agent that made
any journal progress got past argv parsing, so the hint would mislead). The hint text
is a fixed template over stage/agent/model/scope; stderr is surfaced verbatim below
it, uninterpreted. The copy is a hint, not a diagnosis: "…if this model id is invalid
or not available to this agent, correct the `agent` setting at that scope and
resume" — it names the exact model string and where it came from, and asserts nothing
about why the agent died.

**Attribution is data threaded from resolution, not re-derived in the engine.** The
supplying scope is computed where the layers live: `resolveBatchSettings` already
assembles the `{scope, agent}` layers (project ← manifest) for its per-stage merge, so
it calls the pure `resolveAgentStageScopes` (shipped by `stage-scope-resolution`) over
those same layers and returns the result as `agentStageScopes`. The engine never
re-reads config: `batch apply` puts the map on the step context, `runChangeStep` looks
up the running transition's stage, and `buildSpawnRequest`'s existing single
`parseAgentSpec` call supplies agent+model — no second parse, no scope logic in the
engine. Scope labels render as "the project config" vs "the batch manifest" (the only
two scopes the agent layers carry); the label map is exhaustive over `SettingSource`
so a future scope renders as its name rather than crashing.

**Thin slice: change transitions under batch apply.** Attribution covers the
propose/apply/verify transitions driven with a threaded scope map. The decomposition
and PR spawn paths pass no attribution (their failure surfaces are byte-for-byte
unchanged), and the standalone headless verbs do not thread `agentStageScopes` — their
`--agent` flag can override the spec after scope resolution, so a threaded scope could
lie; with no scope present the mapper's gate keeps today's surface. Because
`modelAttribution` is optional on `MapOutcomeInput` and consulted in exactly one
branch, every non-threading caller is unchanged by construction.

**Standards.** *delegated-lifecycle*: the engine stays mechanical — this change adds
outcome surfacing, no lifecycle instruction text, no second done-rule; the spawn still
delegates to `/rct:<transition>` untouched. *multi-agent-support*: the hint hardcodes
no agent name (agent/model/scope are data from the resolved spec), no adapter is
special-cased, and no generated per-agent artifact changes, so there is no per-agent
output surface to enumerate. *generalizable-defaults* is not implicated: nothing ships
a default into consuming repositories — the hint is runtime output over the user's own
config values.

**Testing (testing standard).** The mapper enrichment is pure, so it lands at the unit
layer in `test/batch-engine/outcome.test.ts`: hint fires only on the full signature
(model + scope + non-zero + no completion + zero session entries), and byte-for-byte
equality against the unattributed mapping for bare-name, no-scope, progressed
(session entries present), zero-exit, blocker, and completion inputs. The
`agentStageScopes` exposure lands in `test/core/batch/config.test.ts` (resolved
settings/sources unchanged, scopes exposed per layering). The engine wiring gets the
phase's integration file `test/batch-engine/model-failure-attribution.test.ts`
(header names both `.feature` files), driving `runChangeStep` with an injected
runtime exiting non-zero with no journal writes: an explicit-model, scope-threaded
transition surfaces the hint naming stage/agent/model/scope above the stderr tail; a
bare-name spec and a progressed failure surface unchanged; the step parks blocked and
resumable with exactly one spawn. The `model-failure-proof-and-docs` sibling extends
this same file with doctor coverage. Full suite and coverage gate stay green.

**Documentation (documentation standard).** The component touched is the engine's
outcome mapping, documented in `docs/engine/overview.md` — its "outcome mapping"
rules (the `mapSessionToOutcome` section) gain the attributed-failure condition: when
the failed step's resolved spec explicitly named a model and the session wrote no
journal entries, the failure detail opens with the stage/agent/model/scope hint above
the stderr tail. `docs/configuration/config-yaml.md`'s cross-scope merge section
already states that resolution attributes each stage's winning spec to its scope
(shipped by `stage-scope-resolution`); it gains the factual sentence that this
attribution is what the failure hint names. Existing overview diagrams stay accurate
(the mapper's place in the flow is unchanged — no diagram change needed, and none goes
stale). `README.md` is reviewed for staleness; it does not describe the failure
surface, so no content change is expected.

## Tasks

## 1. Per-stage scope exposure (config layer)

- [x] 1.1 Extend `ResolvedBatchSettings` in `src/core/batch/config.ts` with `agentStageScopes: Partial<Record<AgentStage, SettingSource>>`, computed inside `resolveBatchSettings` by calling the shipped `resolveAgentStageScopes` over the exact agent layers the merge already builds; resolved `settings` and `sources` byte-for-byte unchanged
- [x] 1.2 Extend `test/core/batch/config.test.ts`: for scalar, stage-map, and mixed project/manifest layerings assert `agentStageScopes` matches the supplying scope per stage and that `settings`/`sources` equal today's values byte-for-byte

## 2. Attribution threading (engine)

- [x] 2.1 Add optional `agentStageScopes` to `BaseStepContext` in `src/core/batch/engine/contract.ts`; thread it from `resolveBatchSettings` into the step contexts built by `src/commands/batch/apply.ts` (decompose/PR and standalone headless contexts left unthreaded)
- [x] 2.2 Return the parsed `AgentSpec` from `Engine.buildSpawnRequest` alongside the request (it already parses once per transition; the `RATCHET_BATCH_AGENT_CMD` override path returns no spec); in `runChangeStep` build `modelAttribution` — `{ stage: transition, agent, model, scope }` — only when the spec names a model and `ctx.agentStageScopes?.[transition]` is present, and pass it through `spawnAndMap` into the mapper input

## 3. Attributed failure surface (outcome mapper)

- [x] 3.1 Add optional `modelAttribution` to `MapOutcomeInput` in `src/core/batch/engine/outcome.ts`; on the `nonZero && !completion` branch, when attribution is present and `sessionEntries.length === 0`, prepend the hint — naming the stage, agent, exact model string, and supplying scope ("the project config" / "the batch manifest"), phrased as "if this model id is invalid…" — above the truncated stderr tail in `detail`, leaving `blocker`/`message` and every other branch byte-for-byte unchanged
- [x] 3.2 Extend `test/batch-engine/outcome.test.ts` (header names the `.feature` files): hint fires only on the full signature; byte-for-byte equality with the unattributed mapping for bare-name, missing-scope, progressed, zero-exit, blocker, and completion inputs; hint text identical regardless of stderr content with stderr verbatim below

## 4. Integration proof (engine wiring)

- [x] 4.1 Create `test/batch-engine/model-failure-attribution.test.ts` (header names both `.feature` files) driving `runChangeStep` over a tmpdir fixture with an injected runtime exiting non-zero writing no journal entries: an explicit-model transition with threaded `agentStageScopes` surfaces a blocked, resumable step whose detail names stage, agent, model string, and supplying scope above the stderr tail, with exactly one spawn and no fallback model; a bare-name spec and a session-progressed failure surface byte-for-byte unchanged
- [x] 4.2 Run `pnpm test test/batch-engine/model-failure-attribution.test.ts` and the full `pnpm test` suite; both green with the coverage gate satisfied

## 5. Documentation (documentation standard)

- [x] 5.1 Update `docs/engine/overview.md`'s outcome-mapping section with the attributed-failure rule (signature and hint contents) and add to `docs/configuration/config-yaml.md`'s cross-scope merge section the factual note that the failure hint names the attributed scope; confirm existing overview diagrams remain accurate and review `README.md` for staleness (no described behavior changes)
