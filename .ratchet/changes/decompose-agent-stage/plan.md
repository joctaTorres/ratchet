# Decompose agent stage & open-pr rename

## Why

The batch `decompose` step is the only lifecycle step whose agent and model cannot be
selected — it resolves through a scalar/default path (with a `uniformAgentScope`
workaround) while `propose`, `apply`, `verify`, and `pr` are all routable per stage.
Batch authors need to run phase decomposition on a chosen agent+model like every other
stage. Separately, the PR skill's command id `pr-open` reads awkwardly and should be
`open-pr` for a natural, consistent name across agents.

## What Changes

Implements `features/decompose-stage/routing.feature`,
`features/decompose-stage/attribution.feature`, and
`features/open-pr-command/rename.feature`.

- **Decompose becomes a routable agent stage.** `decompose` joins the per-stage agent-map
  vocabulary, so `agent.decompose` (scalar or `agent[:model]` spec) is selectable from
  **both** `.ratchet/config.yaml` (`batch.agent.decompose`) and the batch manifest
  (`settings.agent.decompose`), merged nearest-wins per stage.
- The decomposition spawn routes through the `decompose` stage exactly as the PR step
  routes through `pr`: stage-aware agent resolution, stage-matched rendered command +
  invocation, and model-failure attribution keyed to `stage: decompose` with its
  supplying scope.
- Unmapped/unset `decompose` under a per-stage map falls back to the default agent with
  no model flag — **byte-for-byte** today's behavior (no behavior change for existing
  configs; decompose only gains routing when explicitly named).
- The `uniformAgentScope` workaround (helper + engine call + tests) is **removed**; it
  existed solely because decompose was not a real stage.
- **PR skill renamed `pr-open` → `open-pr`** (command id, workflow file + symbols,
  profile lists, generated per-agent artifacts, docs). Mechanical, no behavior change.
  **BREAKING (cosmetic):** a previously-rendered `rct-pr-open` command file in a user
  tree becomes an inert orphan; the engine renders/invokes `open-pr` going forward. The
  `pr` **stage key stays `pr`** (config-facing, unchanged).

## Design

**Stage vocabulary is the one seam.** `AGENT_STAGE_KEYS` in `src/core/batch/agent-setting.ts`
gains `'decompose'` → `['propose','apply','verify','pr','decompose']`. This is the single
source of truth: `AgentStageMapSchema` (used by both project-config and manifest scopes)
and every `for (const stage of AGENT_STAGE_KEYS)` fold pick it up automatically, and
`.strict()` still rejects unknown keys. `Transition` (`propose|apply|verify`) and
`StepKind` (`+decompose+pr`) in `engine/contract.ts` are **unchanged** — the agent-map
vocabulary already legitimately diverges from `Transition` (`pr` is a stage but not a
transition), and this extends the same established pattern rather than touching lifecycle
semantics. *(instruction-fed-config: the routing decision stays resolved config data
consumed via the resolved `BatchSettings`/`agentStageScopes` the engine already receives;
no skill reads config. multi-agent-support: `decompose` is agent-neutral — the routed
agent's own command adapter renders the command and invocation, no agent is special-cased.)*

**Decompose spawn mirrors the PR step.** In `runDecompositionStepLocked`
(`src/core/batch/engine/engine.ts`) the two spawn-prep calls take the `'decompose'` stage:
`ensureCommandInSpawnLocus(DECOMPOSE_COMMAND_ID, settings, root, deps, 'decompose')` and
`buildSpawnRequest({...}, instructions, root, env, 'decompose')`, so
`resolveAgentForStage(agent, 'decompose')` governs resolution (scalar covers it; map entry
routes it; unmapped → `DEFAULT_AGENT`). `rctDecomposeInvocation`
(`engine/instructions.ts`) switches from `scalarAgent(...)` to the same `'decompose'`-stage
resolution so the rendered command file and the invocation token match the routed agent.
Attribution collapses to the one-liner the PR step uses —
`const scope = context.agentStageScopes?.decompose;` — and `uniformAgentScope` (in
`batch/config.ts`), its import + call in `engine.ts`, and its unit tests are deleted.

**Rename via the single-source constant.** `PR_OPEN_COMMAND_ID` in
`engine/skill-locus.ts` changes `'pr-open'` → `'open-pr'`; all consumers read the constant,
so the id flows through the locus guarantee, invocation, and command-adapter path
resolution without per-site logic edits. The workflow module
`src/core/templates/workflows/pr-open.ts` → `open-pr.ts` (and its exported `PR_OPEN_*`
symbols) is renamed; the body stays forge-agnostic (no gitlab/`open-mr` split, per
generalizable-defaults — it names no single forge CLI). `CORE_WORKFLOWS` and
`ALL_WORKFLOWS` in `src/core/profiles.ts` swap `'pr-open'` → `'open-pr'` so `ratchet init`
emits the new id.

**Per-agent outputs (multi-agent-support — enumerated).** The `open-pr` command renders for
every agent in the supported-tools registry:
- claude — `.claude/commands/rct/open-pr.md` (invoked `/rct:open-pr`)
- cursor — `.cursor/commands/rct-open-pr.md` (`/rct-open-pr`)
- opencode — `.opencode/commands/rct-open-pr.md` (`/rct-open-pr`)
- gemini — `.gemini/commands/rct-open-pr.md` (`/rct-open-pr`)
- github-copilot — `.github/prompts/rct-open-pr.prompt.md`
- codex — `<CODEX_HOME>/prompts/rct-open-pr.md`

**Testing (testing standard).** Unit-level where possible (pure resolution over in-memory
layers), integration for the engine spawn wiring. Proof-of-work is a config→argv
end-to-end test for the decompose stage (real adapters + fake spawner), matchable via
`exit-zero`/`contains:`, mirroring `agent-model-selection.test.ts`. Full suite + 95%
coverage gate stay green.

## Tasks

- [x] 1.1 Add `'decompose'` to `AGENT_STAGE_KEYS` in `src/core/batch/agent-setting.ts`; confirm `AgentStageMapSchema` accepts `decompose:` and still rejects unknown keys.
- [x] 1.2 Route the decompose spawn through the `'decompose'` stage in `runDecompositionStepLocked` (`engine.ts`): pass the stage to `ensureCommandInSpawnLocus` and `buildSpawnRequest`.
- [x] 1.3 Switch `rctDecomposeInvocation` (`engine/instructions.ts`) to `'decompose'`-stage resolution so the rendered command + invocation match the routed agent.
- [x] 1.4 Replace decompose attribution with `context.agentStageScopes?.decompose`; delete `uniformAgentScope` (helper in `batch/config.ts`, its import + call in `engine.ts`).
- [x] 2.1 Rename `PR_OPEN_COMMAND_ID` `'pr-open'` → `'open-pr'` in `engine/skill-locus.ts`.
- [x] 2.2 Rename `src/core/templates/workflows/pr-open.ts` → `open-pr.ts` and its exported `PR_OPEN_*` symbols; keep the body forge-agnostic; update all importers.
- [x] 2.3 Swap `'pr-open'` → `'open-pr'` in `CORE_WORKFLOWS` and `ALL_WORKFLOWS` in `src/core/profiles.ts`.
- [x] 3.1 Unit tests: decompose stage routing from config.yaml and batch.yaml (agent+model flag), nearest-wins manifest-over-project, scalar coverage, unmapped→default (no flag, argv byte-for-byte), malformed `decompose` spec rejected at config load.
- [x] 3.2 Unit tests: decompose model-failure attribution keyed to `stage: decompose` + supplying scope; no-model decompose failure unchanged. Delete `uniformAgentScope` tests; retarget any decompose→default-under-map test to the stage-routed path (same outcome).
- [x] 3.3 Update `pr-open` → `open-pr` references in `test/batch-engine/pr-instruction-stacked-base.test.ts` and `engine-spawn-at-boundaries` test (id, invocation token, rendered file path); assert `open-pr` renders for all registered agents (iterate the registry).
- [x] 3.4 Proof-of-work: config→argv end-to-end test for the decompose stage (real adapters + fake spawner), matchable via `exit-zero`/`contains:`; run the full suite and confirm the 95% coverage gate is green.
- [x] 4.1 **Documentation (required — `documentation` standard).** Update `docs/configuration/config-yaml.md` to document `decompose` in the stage-map syntax alongside `propose/apply/verify/pr`; update `docs/engine/agent-runtime.md` and `docs/configuration/generated-artifacts.md` for the `decompose` stage routing and the `pr-open` → `open-pr` rename (id, `/rct:open-pr` invocation, per-agent paths); update `docs/commands/doctor.md` if it names the stage set; update `README.md` for the new `decompose` stage selector and the `open-pr` skill name. Keep any affected Mermaid diagram accurate.
