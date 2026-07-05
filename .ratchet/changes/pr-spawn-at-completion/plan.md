# pr-spawn-at-completion

## Why

Phase 2 of the `per-stage-agents-and-prs` batch opens a single whole-batch PR at
completion. The config surface (`prGrouping`, the `pr` stage) landed in
`pr-grouping-config` and the shared, forge-agnostic instruction landed in
`pr-open-instruction` — but nothing spawns the PR agent yet. This is the engine
orchestration slice: at batch completion under `prGrouping: whole-batch`, spawn
exactly one PR agent that delegates to the shared `/rct:pr-open` command, route it
through the `pr` stage of the agent map, and record the PR-open outcome in
run-state so a resumed loop never double-opens. It mirrors how
`runDecompositionStep` landed the engine-spawned decomposition step before the CLI
surfaced it; the user-visible `batch apply` wiring is the next change
(`pr-step-apply-wiring`).

## What Changes

- A new engine method `RatchetBatchEngine.runPrStep(context: PrStepContext)` in
  `src/core/batch/engine/engine.ts` spawns **exactly one** PR agent for a
  completed batch, mirroring `runDecompositionStep`: take the per-batch lock,
  guarantee the shared command in the spawn locus, build instructions, and route
  through the existing `spawnAndMap` tail with `transition: 'pr'` and
  `parkForApproval: false`. No new spawn/stream/journal machinery is written —
  the shared tail is reused verbatim.
- Two **preconditions** guard the spawn inside `runPrStep`, so the guarantees hold
  at the engine layer independent of any CLI wiring:
  1. `prGrouping` does not resolve to `whole-batch` (i.e. `off` or unset) → return
     a `nothing-ready` result, **no agent spawned**, nothing recorded.
  2. the run-state journal already carries a PR-open completion
     (`hasJournaledPr`) → return a `nothing-ready` result, **no second agent
     spawned**, nothing recorded (idempotent resume).
- `StepKind` in `src/core/batch/engine/contract.ts` gains a fourth kind, `'pr'`
  (alongside `propose | apply | verify | decompose`), so a PR step's `StepResult`
  and journal entry name their kind for rendering without inventing a per-change
  transition. A new `PrStepContext` interface carries what the engine needs: the
  `batch`, the terminal `phase` framing, `settings`, optional `resume`, and the
  resolved `baseBranch` / `workBranch` supplied as **data**.
- `buildPrInstructions(context: PrStepContext)` in
  `src/core/batch/engine/instructions.ts` builds the PR agent's prompt by
  **delegating** to the shared `/rct:pr-open` command (never re-authoring the PR
  steps inline). The invocation token is resolved through the agent the `pr` stage
  maps to (`resolveAgentForStage(settings.agent, 'pr')`), and the resolved work /
  base branch ride in the prompt as the "Input" data the `pr-open` body expects.
- `hasJournaledPr(journal)` and a `prJournalKey(batch)` helper in
  `src/core/batch/engine/transition.ts` / `instructions.ts` are the single home of
  the "PR already opened" run-state rule, mirroring `hasJournaledVerify`: the PR
  step is done iff the batch journal carries a `completion` entry with
  `transition === 'pr'`.
- Documents the completion PR step and the `pr` stage delegation in
  `docs/engine/agent-runtime.md`.
- Implements `features/pr-spawn-at-completion/whole-batch-pr-spawn.feature`.

Not a breaking change: `runPrStep` is a new method spawned nowhere in the
user-facing loop yet (the `batch apply` wiring is `pr-step-apply-wiring`), the new
`'pr'` `StepKind` is a superset addition, and every existing transition path is
untouched. With `prGrouping` at its `off` default no PR agent is ever spawned, so
existing batches behave exactly as before.

## Design

**Engine orchestrates the spawn; the shared skill authors the PR steps
(`delegated-lifecycle`).** `runPrStep` is deliberately the exact structural twin of
`runDecompositionStep`: it takes the batch lock (`withBatchLock`), guarantees the
canonical command in the spawn locus, builds instructions, and hands the prepared
request to the shared `spawnAndMap` tail — the engine SELECTS the step, spawns one
agent, and JOURNALS the outcome, but never re-authors the commit/push/PR-open
steps inline. Those live once in `PR_OPEN_BODY` (`pr-open-instruction`); the engine
delegates to `/rct:pr-open` via the command guaranteed into the locus. The
"PR opened" done-rule is computed once in `hasJournaledPr` and honored by every
consumer (the engine precondition here, and the CLI selection in
`pr-step-apply-wiring`), the same single-home discipline as `hasJournaledVerify`
and `isChangeDone`.

**Guaranteed in the spawn locus by the existing render-or-fail path
(`delegated-lifecycle`).** Before building the request or selecting a runtime,
`runPrStep` calls
`ensureCommandInSpawnLocus(PR_OPEN_COMMAND_ID, settings, projectRoot, deps, 'pr')`
— reusing the constant `pr-open-instruction` added and the render-or-fail
implementation `decompose-phase` already exercises. The `pr` stage argument makes
the render resolve the SAME agent the spawn will use, so the rendered command
matches the spawned binary. A locus the engine cannot render into (e.g. `remote`)
throws `SkillLocusError`; `runPrStep` catches it, prints the actionable message,
and returns a `failed` step with **no agent spawned** — byte-identical to the
decomposition path's catch. No change to `ensureCommandInSpawnLocus` is needed (it
already render-or-fails any id and already accepts the `pr` stage).

**The `pr` stage routes like any other stage (`multi-agent-support`).** The spawn
agent for the PR step is resolved through `resolveAgentForStage(settings.agent,
'pr')` — the same resolver `buildSpawnRequest` uses for `propose|apply|verify`, and
the same one the invocation token is derived from in `buildPrInstructions`. A
stage-map that routes `pr` to a specific agent spawns that agent with that agent's
own `/rct:...` invocation syntax; a scalar `agent` string routes every stage
(including `pr`) to it; an unset `agent`/unmapped `pr` falls back to
`DEFAULT_AGENT`. `buildSpawnRequest` is called with `stage: 'pr'`, so
`resolveAdapter` rejects an unknown agent name (`UnknownAgentError`) before any
spawn, mapped to a `failed` step exactly as the change path does. No agent is
special-cased and no per-agent PR copy is authored.

**Resolved inputs delivered as DATA, not read from the skill
(`instruction-fed-config`).** The `PR_OPEN_BODY` skill is a static, config-blind
template whose "Input" section says the surrounding instructions identify the work
and base branch. `buildPrInstructions` supplies exactly that as data in the spawn
prompt — the resolved `workBranch` and `baseBranch` from `PrStepContext`, plus the
batch/phase framing and the `ratchet batch report` channel keyed by
`prJournalKey(batch)`. The engine reads `prGrouping` (a config value) to DECIDE
whether to spawn, but never bakes an "if config says X" branch into the skill body;
resolved behavior arrives as prompt data. Branch **resolution** itself (which
git branch is base / work) is the CLI's job when it assembles `PrStepContext` in
`pr-step-apply-wiring`, mirroring how the CLI resolves `priorResults` for a
`DecompositionStepContext`; this change consumes the resolved names as context
data and keeps the engine method pure and unit-testable.

**No forge-specific code in ratchet (`generalizable-defaults`).** The engine
carries zero forge knowledge: it spawns an agent that detects and uses whatever
forge CLI the environment provides (the `pr-open` body's job). The only defaults
this change introduces are ecosystem-agnostic — `prGrouping` gating on the neutral
`whole-batch` value, and threading git branch names (git is universal; the forge
is not). No package manager, test runner, or forge command is hard-coded. When the
agent finds no usable forge CLI it stops and reports; that non-zero/blocker outcome
surfaces through the shared mapping as a reported step failure (below), never a
ratchet-specific fallback.

**Failures surface through the existing outcome mapping — no new failure logic.**
`spawnAndMap` already maps a non-zero exit or a journaled blocker to a
`failed`/`blocked` `StepResult` and records a `blocker` (NOT `completion`) journal
entry via `outcomeKind`. So a commit/push/PR-open failure is a reported step
failure for free, and — because only a `completion` entry with `transition: 'pr'`
satisfies `hasJournaledPr` — a failed PR step leaves the idempotency flag UNSET, so
a subsequent run is free to retry. Only a genuinely successful PR-open (the agent
reports `--complete`, exit 0) journals the `pr` completion that makes the resume
guard skip re-opening. This is why idempotency needs no bespoke lock: it rides the
same journal-as-source-of-truth the verify gate uses.

**Result states reuse the existing vocabulary.** The two no-op preconditions
(`prGrouping` not `whole-batch`; PR already journaled) return the existing
`nothing-ready` `StepState` — nothing runnable — with `transition: 'pr'`. A locus
or unknown-agent failure returns `failed`. A successful spawn flows through
`spawnAndMap` to `advanced`/`blocked`/`failed` as the agent's session dictates. No
new `StepState` is introduced.

**Testing (`testing`).** Proven at the engine layer with a fake spawner, following
the pyramid and cloning the self-contained harness in
`test/batch-engine/agent-stage-routing.test.ts` (mkdtemp root, a module-level
`calls: AgentSpawnRequest[]`, `fakeAdapter`/`fakeAdapters` keyed by real agent ids,
a `spawner` that captures the request, `skillLocusDeps: { exists: () => true,
writeText: () => {} }`, and a `PrStepContext` builder). The phase's blackbox e2e
lands later with `whole-batch-pr-e2e-and-docs`; this change's proof is the unit
suite:
- A new `test/batch-engine/pr-spawn-at-completion.test.ts` (header naming
  `features/pr-spawn-at-completion/whole-batch-pr-spawn.feature`) asserts:
  - `prGrouping: whole-batch`, no prior PR journal → **exactly one** spawn whose
    `instructions` contain the `pr` stage agent's `/rct:pr-open` invocation and the
    resolved work/base branch, and a `completion` entry with `transition: 'pr'` is
    appended at the batch locus.
  - a `pr` stage-map routes the spawn to the mapped agent (assert `calls[0].command`
    and the invocation token); a scalar `agent` routes `pr` to it; an unset agent
    spawns `DEFAULT_AGENT`.
  - `prGrouping: off` and unset → **zero** spawns (`calls` empty), result
    `nothing-ready`, no journal entry.
  - a pre-seeded `pr` completion in the batch journal → **zero** spawns on re-run
    (idempotent), no second entry.
  - a fake spawner exiting non-zero without a reported completion → result state is
    a failure and NO `pr` completion is journaled (retry stays possible).
  - a `remote` locus (real `skillLocusDeps`, `engineControlsLocus` false) → a
    `failed` step with the actionable `SkillLocusError` message and **zero** spawns.
- A focused unit test for `hasJournaledPr` (true only for a `completion` +
  `transition: 'pr'` entry; false for a `blocker` entry or a `verify` completion),
  colocated with the existing `transition.ts` predicate tests.
- The full suite and the coverage gate stay green at or above the enforced
  `COVERAGE_THRESHOLD`.

**Documentation (`documentation`, mandatory).** The completion PR step is a new
engine-orchestrated flow, documented where the engine runtime is described:
- `docs/engine/agent-runtime.md` — add the `pr` step to the step/transition
  description: at batch completion under `prGrouping: whole-batch` the engine
  spawns one PR agent that delegates to `/rct:pr-open` (already in the command-id
  table from `pr-open-instruction`), routed via the `pr` stage, with the outcome
  recorded in run-state so a resumed loop never double-opens; note the
  `off`/unset behavior (no spawn) and that a failure surfaces as a reported step
  failure.
- This extends an existing Reference section rather than introducing a new
  top-level flow, so — per the standard's "do not over-document visually" guidance
  — no new Mermaid diagram is added here; the whole-batch PR-flow overview diagram
  lands with `whole-batch-pr-e2e-and-docs` (as the phase plan scopes it). The
  user-facing `prGrouping` / `pr` config keys were already documented by
  `pr-grouping-config`, so no `config-yaml.md` / `README.md` change is needed for
  this engine-internal slice.

## Tasks

- [x] 1.1 Add `'pr'` to `StepKind` in `src/core/batch/engine/contract.ts` and a
  new `PrStepContext` interface: `{ batch: string; phase: StepPhase; settings:
  BatchSettings; resume?: StepResume; baseBranch: string; workBranch: string }`.
  Document that `baseBranch`/`workBranch` are resolved upstream and delivered as
  data (instruction-fed-config), like `DecompositionStepContext.priorResults`.
- [x] 1.2 Add `hasJournaledPr(journal)` to `src/core/batch/engine/transition.ts`
  beside `hasJournaledVerify` (true iff a `completion` entry has `transition ===
  'pr'`), with a doc comment naming it the single home of the "PR opened" rule.
  Add `prJournalKey(batch)` to `src/core/batch/engine/instructions.ts` returning a
  non-colliding key (e.g. `pr:${batch}`) for the PR step's outcome/report channel,
  mirroring `decompositionJournalKey` and the proof-of-work key prefix.
- [x] 1.3 Add `buildPrInstructions(context: PrStepContext)` to
  `src/core/batch/engine/instructions.ts`: delegate to `/rct:pr-open` with the
  invocation token resolved through `resolveAgentForStage(settings.agent, 'pr')`
  (falling back to `DEFAULT_AGENT`'s adapter for a synthetic/unmapped agent, like
  `rctDecomposeInvocation`); inject the batch/phase framing, the resolved
  `workBranch`/`baseBranch` as the "Input" data the `pr-open` body expects, and the
  `ratchet batch report <batch> --change <prJournalKey> ...` channel. Keep the
  prose agent-neutral; only the invocation token is agent-specific.
- [x] 1.4 Add `runPrStep(context: PrStepContext)` to
  `src/core/batch/engine/engine.ts`, mirroring `runDecompositionStep`: take
  `withBatchLock`; **precondition A** — if `settings.prGrouping !== 'whole-batch'`
  return a `nothing-ready` `StepResult` (`transition: 'pr'`), no spawn;
  **precondition B** — read the batch journal (`readJournalTolerant`) and if
  `hasJournaledPr` return a `nothing-ready` result, no spawn; else
  `ensureCommandInSpawnLocus(PR_OPEN_COMMAND_ID, settings, projectRoot, deps,
  'pr')` inside a try/catch mapping `SkillLocusError` → `failed` (print message, no
  spawn); build instructions via `buildPrInstructions`; `buildSpawnRequest(...,
  stage: 'pr')` inside a try/catch mapping `UnknownAgentError` → `failed`; then
  route through `spawnAndMap` with `locus: { batch }`, `change: prJournalKey(batch)`,
  `transition: 'pr'`, `parkForApproval: false`, and a no-op `diskAfter` snapshot
  (there is no change directory, like the decomposition path).
- [x] 2.1 Add `test/batch-engine/pr-spawn-at-completion.test.ts` (header names
  `features/pr-spawn-at-completion/whole-batch-pr-spawn.feature`) cloning the
  `agent-stage-routing.test.ts` harness, covering every scenario: one spawn under
  `whole-batch` delegating to `/rct:pr-open` with branch data + a journaled `pr`
  completion; `pr` stage routing (mapped/scalar/default agent); `off`/unset → zero
  spawns + `nothing-ready` + no journal; pre-seeded `pr` completion → zero spawns
  on re-run; non-zero exit → failure + no `pr` completion journaled; `remote` locus
  → `failed` + zero spawns.
- [x] 2.2 Add a focused `hasJournaledPr` unit test (colocated with the existing
  `transition.ts` predicate tests): true only for `completion` + `transition:
  'pr'`; false for a `blocker` `pr` entry and for a `verify` completion. Confirm the
  full suite + coverage gate stay green.
- [x] 3.1 (`documentation`, mandatory) Update `docs/engine/agent-runtime.md`: add
  the completion `pr` step — spawned once under `prGrouping: whole-batch`,
  delegating to `/rct:pr-open`, routed via the `pr` stage, outcome recorded in
  run-state for idempotent resume, no spawn when `off`/unset, failure surfaced as a
  reported step failure. No new Mermaid diagram (the PR-flow overview lands with
  `whole-batch-pr-e2e-and-docs`).
