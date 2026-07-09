# engine-spawn-at-boundaries

## Why

Phase 2 gave the engine a single, whole-batch PR spawn: `runPrStep` opens one PR
at batch completion and guards against double-opening with a batch-wide flag
(`hasJournaledPr`). Phase 3's `per-phase` and `per-change` modes need the engine
to spawn one PR agent per *group boundary*, each stacked on the prior group, and
to record each group's outcome independently so a resumed loop opens every group
exactly once. This change makes the engine's PR step group-aware; the pure
policies it consumes (`detectPrGroupBoundaries`, `selectStackedBases`) and the
payload seam (`pr-instruction-stacked-base`) already shipped.

## What Changes

Implements `features/stacked-pr-spawn/boundary-spawn.feature` and
`features/stacked-pr-spawn/per-group-idempotency.feature`.

- The engine's PR step spawns exactly one PR agent for a **single fired group
  boundary** under `per-phase`/`per-change`, injecting that group's resolved
  stacked base (`baseBranch`/`workBranch`) into the delegated instructions
  payload and routing through the `pr`-stage adapter.
- **Per-group run-state keying**: each group's PR outcome is journaled under a
  per-group key (`pr:<batch>:<groupId>`); the whole-batch group keeps its
  existing `pr:<batch>` key unchanged.
- **Group-aware idempotency**: a new single-home predicate
  `hasJournaledPrForGroup(journal, key)` replaces the batch-wide guard inside the
  engine's PR step, so a resumed run never re-opens a group whose PR is recorded,
  while distinct groups are guarded independently.
- The active-grouping precondition widens from `whole-batch`-only to any active
  mode via the shared `isPrGroupingActive` predicate; `off` still spawns nothing.
- A commit/push/PR-open failure continues to surface as a reported step failure
  and leaves the group un-journaled (retryable) — preserved, now per group.
- No change to the shared `PR_OPEN_BODY`, `prInputContext`, or the `pr-open`
  command surface: the stacked base already rides in as payload data.
- Reference docs (`docs/engine/agent-runtime.md`) and `README.md` are updated to
  describe per-group spawning and per-group run-state keying.

Out of scope (owned by later changes in the phase): `batch apply`'s
`pickNextStep` surfacing a per-boundary PR target (`apply-boundary-pr-wiring`)
and the stacked grouping-mode e2e + overview Mermaid diagram
(`grouping-modes-e2e-and-docs`).

## Design

**Group context is delivered to the engine as data (instruction-fed-config,
delegated-lifecycle).** `PrStepContext` (`src/core/batch/engine/contract.ts`)
gains an optional `boundary?: PrGroupBoundary`. The resolved stacked base already
lives in `baseBranch`/`workBranch`, computed by `selectStackedBases` from
`detectPrGroupBoundaries` — the two pure policies remain the single home of "where
are the boundaries" and "what does group N stack on"; the engine consumes their
output and never re-derives boundary rules inline. The stacked base reaches the
PR agent only through the `ratchet instructions` payload (`prInputContext` →
`buildPrInstructions`); the engine does not add any config read, and the shared
`PR_OPEN_BODY` stays config-blind.

**Per-group journal key.** `prJournalKey(batch, boundary?)` in
`src/core/batch/engine/instructions.ts` returns the existing `pr:<batch>` when
the boundary is absent or `kind === 'batch'` (whole-batch is unchanged and
Phase 2 tests keep passing), and `pr:<batch>:<groupId>` for `phase`/`change`
boundaries. The engine's `spawnAndMap` already writes the journal entry with
`change = key`, so per-group entries fall out of the existing write path.

**Group-aware idempotency (delegated-lifecycle: one definition of done).** Add
`hasJournaledPrForGroup(journal, key)` to `src/core/batch/engine/transition.ts`
next to `hasJournaledPr`, matching `kind === 'completion' && transition === 'pr'
&& change === key`. `runPrStepLocked` uses this predicate against the resolved
per-group key instead of the batch-wide `hasJournaledPr`. Because a whole-batch
entry is keyed `pr:<batch>`, the same predicate covers whole-batch (key
`pr:<batch>`) and every stacked group, so there is exactly one done-rule for "this
group's PR is open." `hasJournaledPr` stays for any batch-wide caller Phase 2
left in place (untouched here).

**Precondition.** `runPrStepLocked`'s guard changes from
`settings.prGrouping !== 'whole-batch'` to `!isPrGroupingActive(settings.prGrouping)`
(the shared predicate from `grouping-mode-schema`), so `per-phase`/`per-change`
proceed and `off` returns `nothing-ready` with no spawn.

**pr-stage adapter (multi-agent-support).** The spawn keeps passing `stage: 'pr'`
to `buildSpawnRequest`, which resolves the adapter via
`resolveAgentForStage(settings.agent, 'pr') ?? DEFAULT_AGENT` and render-or-fails
the command through `ensureCommandInSpawnLocus(PR_OPEN_COMMAND_ID, …, 'pr')` for
every registered agent. No agent is special-cased; the delegation names the
canonical `pr-open` command, not an agent-specific mechanism.

**Failure surfacing.** Unchanged shared tail: `outcomeKind` maps `failed` to a
`blocker` (not `completion`), so a failed open is never journaled as done and the
group stays retryable; `SkillLocusError`/`UnknownAgentError` continue to map to a
`failed` `StepResult`.

**Branch naming.** Group branch names are plain strings resolved upstream and
carried as `workBranch`/`baseBranch` data — no forge or toolchain literal enters
the engine (generalizable-defaults). The engine treats them opaquely; the shared
`pr-open` agent performs the actual commit/push/open against the supplied names.

**Testing (testing standard).** Unit tests cover the new pure helpers
(`prJournalKey` per-group vs whole-batch, `hasJournaledPrForGroup` matching and
group isolation). An integration test drives `runPrStep` over a tmpdir fixture
batch with the fake spawn seam (cloning `pr-spawn-at-completion.test.ts`):
per-phase and per-change group contexts (built by composing
`detectPrGroupBoundaries` + `selectStackedBases`) each spawn exactly one agent
with the stacked base in the payload, routed via a `pr`-stage fake adapter;
recording a group then re-running spawns nothing; a second un-recorded group
still spawns; a failing spawner yields a `failed` result with no journal entry;
`off` spawns nothing; whole-batch keeps its `pr:<batch>` key. Tests iterate the
fake adapter registry so the `pr`-stage routing is asserted agent-neutrally.

## Tasks

- [x] 1.1 Add optional `boundary?: PrGroupBoundary` to `PrStepContext` in
  `src/core/batch/engine/contract.ts`, importing the type from `./boundary.js`.
- [x] 1.2 Extend `prJournalKey` in `src/core/batch/engine/instructions.ts` to
  `prJournalKey(batch, boundary?)`: `pr:<batch>` when absent or `kind==='batch'`,
  else `pr:<batch>:<groupId>`.
- [x] 1.3 Add `hasJournaledPrForGroup(journal, key)` to
  `src/core/batch/engine/transition.ts` (single home of the per-group done-rule)
  and re-export it where `hasJournaledPr` is exported.
- [x] 2.1 In `runPrStepLocked` (`src/core/batch/engine/engine.ts`), replace the
  `!== 'whole-batch'` precondition with `!isPrGroupingActive(settings.prGrouping)`.
- [x] 2.2 In `runPrStepLocked`, resolve the per-group key via
  `prJournalKey(batch, context.boundary)` and guard with
  `hasJournaledPrForGroup(journal, key)` so a resumed run never re-opens a
  recorded group and distinct groups are guarded independently.
- [x] 2.3 Confirm the spawn path still passes `stage: 'pr'` to
  `buildSpawnRequest` and delegates via `buildPrInstructions`/`PR_OPEN_COMMAND_ID`
  with the group's stacked base flowing through unchanged (no new config read, no
  agent special-casing).
- [x] 3.1 Unit-test `prJournalKey` (whole-batch vs per-phase vs per-change keys)
  and `hasJournaledPrForGroup` (matches its group, ignores other groups, ignores
  non-pr/non-completion entries) under `test/batch-engine/`, mirroring the
  `.feature` in the header.
- [x] 3.2 Add an integration test
  `test/batch-engine/engine-spawn-at-boundaries.test.ts` (fake spawn seam,
  tmpdir fixture) proving: one spawn per fired group with the stacked base in the
  payload; `pr`-stage adapter routing over the fake adapter registry; per-group
  idempotency on resume; independent guarding of a second group; `failed` result
  with no journal entry on a non-zero spawn; no spawn under `off`; whole-batch key
  unchanged. Header names both feature files.
- [x] 3.3 Run the suite and coverage gate; keep them green at or above the
  enforced `COVERAGE_THRESHOLD`.
- [x] 4.1 **Documentation (required, non-optional — `documentation` standard).**
  Update `docs/engine/agent-runtime.md` to document that under
  `per-phase`/`per-change` the engine spawns one PR agent per group boundary with
  the injected stacked base and records each group's outcome in run-state keyed
  by group (`pr:<batch>:<groupId>`), keeping the existing engine PR-flow overview
  accurate; update `README.md` where it describes the PR-grouping/PR-spawn
  behavior. (The comprehensive stacked-grouping overview Mermaid diagram is owned
  by `grouping-modes-e2e-and-docs`; this task keeps the engine reference accurate
  for the per-group spawn behavior this change adds.)
