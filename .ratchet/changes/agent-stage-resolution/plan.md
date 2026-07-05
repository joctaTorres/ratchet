# agent-stage-resolution

## Why

The sibling change `agent-stage-map-schema` taught the batch `agent` setting to
*accept and validate* a partial `{propose, apply, verify}` stage-map, but a map
still behaves exactly like an unset agent — `scalarAgent` reduces any map to
`undefined`, so every stage falls back to the default agent. This change makes a
configured map actually *route*: each transition spawns the agent mapped to its
lifecycle stage, closing Phase 1 of the `per-stage-agents-and-prs` batch (its
proof-of-work `test/batch-engine/agent-stage-routing.test.ts`).

## What Changes

- A new pure resolver `resolveAgentForStage(setting, stage)` in
  `src/core/batch/agent-setting.ts` returns the agent a given lifecycle stage
  maps to: a scalar covers every stage; a map returns its entry for that stage
  (or `undefined` when the stage is unmapped); an unset setting returns
  `undefined`. `undefined` means "the caller falls back to `DEFAULT_AGENT`".
- `resolveBatchSettings` (`src/core/batch/config.ts`) gains a **per-stage
  cross-scope merge** for `agent` (replacing the whole-value nearest-wins the
  schema change left in place): partial stage-maps merge nearest-wins per stage
  over a lower-scope scalar/map, a nearer scalar replaces the whole value
  (covers every stage), and an unset scope contributes nothing.
- The engine's `buildSpawnRequest` (`src/core/batch/engine/engine.ts`) resolves
  the spawn adapter for the **running transition's stage** — `resolveAdapter`
  falls back to the scalar `agent` (for a scalar value) then `DEFAULT_AGENT` (for
  an unmapped stage or unset agent) exactly as today for scalar/unset configs.
- The two other per-agent seams that must agree with the spawned binary —
  `rctInvocation` (`engine/instructions.ts`, the invocation TOKEN the agent is
  told to run) and `ensureCommandInSpawnLocus` (`engine/skill-locus.ts`, the rct
  command rendered into the spawn locus) — resolve the **same per-stage agent**
  for the transition, so a stage routed to a non-default agent gets that agent's
  invocation syntax and command file, not the default agent's.
- The phase-decomposition path (not a lifecycle stage) keeps using the scalar /
  default agent: a stage-map's per-stage entries never affect decomposition.
- Implements `features/agent-stage-resolution/resolution.feature`.

Not a breaking change: every existing scalar `agent`, every unset `agent`, and
every single-scope config resolves and spawns exactly as before — only a
configured stage-map (new in the schema change) gains behavior.

## Design

**One stage vocabulary, shared with the engine's `Transition`.** The stage keys
`propose | apply | verify` (`AGENT_STAGE_KEYS` from the schema change) are, by
construction, the engine's `Transition` union (`engine/contract.ts`). So the
transition the engine is already forcing IS the stage to resolve — no mapping
table, no new enum. `resolveAgentForStage` takes an `AgentStage` and the engine
passes `ctx.transition` directly.

**The resolver is pure and default-free (`testing`).** `resolveAgentForStage`
returns `string | undefined` and deliberately does NOT bake in `DEFAULT_AGENT`:
the single source of the default stays `resolveAdapter`, which already maps a
`undefined`/unset name to `DEFAULT_AGENT`. This keeps "which stage maps where"
(the resolver) separate from "what if nothing maps" (the one default), and lets
the resolver be unit-tested over in-memory inputs with no spawn — the bottom of
the test pyramid.

```ts
export function resolveAgentForStage(
  setting: AgentSetting | undefined,
  stage: AgentStage
): string | undefined {
  if (typeof setting === 'string') return setting;   // scalar covers every stage
  if (setting) return setting[stage];                // map entry, or undefined if unmapped
  return undefined;                                   // unset → caller's DEFAULT_AGENT
}
```

`scalarAgent` (the schema change's bridge) is retained only for the
decomposition path, which has no stage; every stage-bearing consumer switches to
`resolveAgentForStage`.

**Per-stage cross-scope merge in `resolveBatchSettings`.** `agent` moves out of
the generic `SETTING_KEYS` whole-value loop into a dedicated merge (mirroring how
`permissions` already gets bespoke per-field merge semantics), fed the scalar
scopes low→high (project ← manifest; the user/global scope carries no scalar
`agent`). The merge tracks a `base` (the nearest scalar seen) and an accumulating
partial `stages` map:

- a **scalar** scope sets `base` and clears `stages` (a scalar covers every
  stage, so it overrides any lower-scope per-stage overrides — nearest-wins);
- a **map** scope merges its entries into `stages` (nearer stage wins), leaving a
  lower `base` in place as the fallback for stages it does not name.

The resolved `agent` is then: `undefined` when nothing was set; the `base` scalar
when no map contributed; the partial `stages` map when only maps contributed; and
a **materialized full map** (`stages[stage] ?? base` for each stage) when a scalar
`base` and a partial map both contributed — so the scalar fallback is preserved
inside a `string | AgentStageMap` value without widening the type. `sources.agent`
is set to the nearest scope that contributed any `agent` value (the `sources`
shape is unchanged; `batch config` still shows one source per key). This is the
"partial stage-maps merge nearest-wins per stage over the scalar/default" the
definition of done requires; it is proven by unit tests directly over
`resolveBatchSettings` with project + manifest layers.

**`buildSpawnRequest` resolves for the transition's stage
(`delegated-lifecycle`).** The change is surgical: `buildSpawnRequest` gains an
optional `stage?: AgentStage` and swaps `scalarAgent(context.settings.agent)` for
a stage-aware lookup — `stage ? resolveAgentForStage(settings.agent, stage) :
scalarAgent(settings.agent)` — before the unchanged
`resolveAdapter(..., this.adapters)` call. The transition call site passes
`ctx.transition`; the decomposition call site passes no stage. The
`RATCHET_BATCH_AGENT_CMD` override, the `UnknownAgentError` propagation (unknown
agent rejected BEFORE any spawn), and the delegation itself are untouched: the
engine still spawns the canonical `/rct:<transition>` skill invocation — this
change only selects WHICH agent's adapter renders and runs it, never re-authoring
the lifecycle. "Done" is still the shared skill's definition; no second done-rule
is introduced.

**All three per-agent seams agree (`multi-agent-support`).** Routing a stage to
another agent is only correct if the spawned binary, the invocation token, and the
rendered command file all name the same agent — otherwise, e.g., `apply` routed to
`opencode` would be handed claude's `/rct:apply` syntax against the `opencode`
binary. So the same per-stage resolution is applied at all three seams that pick
an agent for a transition:

- `engine.ts buildSpawnRequest` → the spawn adapter (the binary);
- `instructions.ts rctInvocation` → the invocation token (`resolveAgentForStage(
  settings.agent, context.transition) ?? DEFAULT_AGENT`, then the command
  adapter, exactly as it derives the token today);
- `skill-locus.ts ensureCommandInSpawnLocus` → gains an optional `stage`, and
  `ensureSkillInSpawnLocus` (which holds `ctx.transition`) passes it, so the rct
  command is rendered into the spawn locus for the resolved stage agent.

Nothing here special-cases one agent: resolution keys off free-form agent names
and every name flows through the existing per-agent adapter registries. The
decomposition path (`rctDecomposeInvocation`, the decompose `ensureCommandInSpawn
Locus` call) keeps its `scalarAgent`/default resolution — decomposition is not one
of the three stages, so a stage-map never reaches it, and per-stage agent surfaces
stay confined to propose/apply/verify.

Per-agent output surface (enumerated per `multi-agent-support`): no new generated
artifact or file is added — this change only re-selects, per stage, among the
agents already in the spawn-adapter registry (`BUILTIN_ADAPTERS`: claude, codex,
cursor, gemini, opencode) and their matching command adapters. Every registered
agent is equally routable; adding a new agent still requires no edit here.

**Rejection before any spawn.** Two guards satisfy "unknown agent names and
invalid stage keys are rejected before any spawn": an **invalid stage key** is
rejected by the schema (`AgentStageMapSchema.strict()`, the sibling change) when
project config / the manifest is loaded — before `resolveBatchSettings` returns,
so no engine step runs; an **unknown agent name** (scalar or mapped) is rejected
by `resolveAdapter`'s `UnknownAgentError` inside `buildSpawnRequest`, which the
engine already catches and turns into a failed step with no process spawned.

**Testing (`testing`).** Two pyramid layers:

- **Unit** (`test/core/batch/`): `resolveAgentForStage` over scalar / full-map /
  partial-map / unset for each stage; and `resolveBatchSettings` per-stage merge
  across project + manifest layers (map-over-map, map-over-scalar-base,
  scalar-over-map, single-scope unchanged), each isolated via the `fs.mkdtemp`
  fixture and naming `resolution.feature` in the header.
- **Integration** (`test/batch-engine/agent-stage-routing.test.ts`, the phase
  proof-of-work): drive `buildSpawnRequest`/the engine through the existing fake
  adapter + `Spawner` seam (as `engine-agent-override.test.ts` does) and assert
  the adapter spawned for each transition matches the stage's mapped agent; an
  unmapped stage and an unset agent spawn `DEFAULT_AGENT`; an unknown mapped agent
  fails before any spawn; and the decomposition step ignores the stage-map. This
  is the wiring only the engine can exercise, kept off the unit layer.

The full suite and the coverage gate stay green at or above the enforced
`COVERAGE_THRESHOLD`.

**Documentation (`documentation`, mandatory).** The `agent` config key is a
user-facing surface; this change turns its per-stage map from "validated but
inert" into "actually routing", so the Reference entry must describe the new
behavior. The existing "Per-stage agent map" section in
`docs/configuration/config-yaml.md` (added by the schema change) is updated to
document that each stage now spawns its mapped agent, the nearest-wins per-stage
cross-scope merge (partial map over a lower-scope scalar/map; a nearer scalar
covers every stage), and the `mapped-stage → scalar → default agent` fallback;
`README.md`'s `agent` mention is kept consistent. This updates an existing
Reference table row / section rather than introducing a new core component with
its own overview, so — per the standard's "do not over-document visually"
guidance and matching the sibling change's rationale — no new overview Mermaid
diagram is warranted; tone and terminology match the existing docs.

## Tasks

- [x] 1.1 Add `resolveAgentForStage(setting, stage)` to
  `src/core/batch/agent-setting.ts` (pure, returns `string | undefined`; scalar
  covers every stage, map returns its stage entry or `undefined`, unset returns
  `undefined`); keep `scalarAgent` for the stage-less decomposition path.
- [x] 1.2 Replace the whole-value `agent` handling in `resolveBatchSettings`
  (`src/core/batch/config.ts`) with the per-stage cross-scope merge (base scalar +
  accumulating partial `stages`; scalar resets, map merges nearest-wins;
  materialize a full map when a scalar base and a partial map both contribute),
  setting `sources.agent` to the nearest contributing scope and leaving all other
  keys' resolution unchanged.
- [x] 1.3 Resolve the transition's stage in `buildSpawnRequest`
  (`src/core/batch/engine/engine.ts`): add an optional `stage?: AgentStage`, use
  `resolveAgentForStage` for it (falling back through `resolveAdapter` to the
  scalar then `DEFAULT_AGENT`), pass `ctx.transition` at the transition call site
  and no stage at the decomposition call site; leave the override seam and
  `UnknownAgentError` handling untouched.
- [x] 1.4 Make `rctInvocation` (`engine/instructions.ts`) and
  `ensureCommandInSpawnLocus` (`engine/skill-locus.ts`, via a new optional `stage`
  threaded from `ensureSkillInSpawnLocus`'s `ctx.transition`) resolve the same
  per-stage agent, so the invocation token and the rendered rct command match the
  spawned binary; keep the decomposition invocation/locus on `scalarAgent`/default.
- [x] 2.1 Add unit tests in `test/core/batch/` (header names
  `agent-stage-resolution/resolution.feature`) for `resolveAgentForStage` (scalar/
  full-map/partial-map/unset × each stage) and for `resolveBatchSettings` per-stage
  cross-scope merge (map-over-map, map-over-scalar-base, scalar-over-map,
  single-scope unchanged), isolated via the `fs.mkdtemp` fixture.
- [x] 2.2 Add the phase proof-of-work integration test
  `test/batch-engine/agent-stage-routing.test.ts` (fake adapter + `Spawner` seam)
  asserting per-stage adapter resolution: each transition spawns its mapped agent;
  unmapped stage and unset agent spawn `DEFAULT_AGENT`; an unknown mapped agent
  fails before any spawn; the decomposition step ignores the stage-map. Confirm the
  full suite and coverage gate stay green.
- [x] 3.1 (`documentation`, mandatory — `documentation` standard / "Reference
  documentation") Update the "Per-stage agent map" section in
  `docs/configuration/config-yaml.md` to document per-stage routing, the
  nearest-wins per-stage cross-scope merge, and the `mapped-stage → scalar →
  default` fallback, and keep the `agent` mention in `README.md` consistent; no new
  Mermaid diagram (existing Reference section updated in place).
