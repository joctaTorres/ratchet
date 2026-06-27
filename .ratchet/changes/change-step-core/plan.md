# Extract a change-scoped engine core: ChangeStepContext + runChangeStep

## Why

Today the only entry point to advancing a change is
`RatchetBatchEngine.runStep(context: ResolvedStepContext)`, and it is
batch-coupled: it acquires a per-batch lock, derives the next transition from
on-disk state, and bundles transition-derivation, instruction-building, the
single agent spawn, and outcome-mapping into one private `runStepLocked`.

The `propose-headless` phase needs to spawn one agent for a **forced** transition
on a **single** change with no batch in sight. That forces a seam: a
change-scoped core, `runChangeStep(ctx)`, that takes a definite (forced)
transition and spawns exactly one agent for it. This first change extracts that
core and re-points batch apply at it, with batch behaviour provably unchanged.
Project-level settings resolution and relocating run state to
`.ratchet/changes/<change>/.run/` are deliberately **out of scope** — they are
the next changes in the phase (`standalone-settings-and-state`). The headless
`ratchet propose` verb is the change after that (`propose-command`).

## What Changes

- **New `ChangeStepContext`** (in the engine's contract): the change-scoped
  subset `runChangeStep` needs to drive one forced transition — `change`,
  `changeDone`, a **forced** `transition`, `phase`, `settings`, `journal`, and
  optional `resume`. It still carries `batch` for now purely as the run-state
  locus (relocating that locus is the next change), so this slice stays thin.
- **New `runChangeStep(ctx: ChangeStepContext)`** on `RatchetBatchEngine`
  (exported from the engine index): builds instructions for the forced
  transition, selects the runtime, spawns **exactly one** agent, snapshots the
  journal delta, and maps the session to an `EngineStepOutcome` →
  `StepResult`. It does **not** re-derive the transition and does **not** take
  the batch lock — both remain the caller's concern.
- **`runStep` delegates**: `runStepLocked` keeps the per-batch lock,
  `computeNextTransition` derivation, and park-precedence check, then calls
  `runChangeStep` with the forced/derived transition instead of inlining the
  spawn-and-map body. `ResolvedStepContext` stays the batch-facing boundary the
  CLI builds; runStep adapts it into a `ChangeStepContext`.
- No change to `src/commands/batch/apply.ts`, the manifest, settings
  resolution, or run-state file locations in this slice.

Implements `features/change-step/run-change-step-core.feature` and
`features/change-step/batch-apply-delegates.feature`.

## Tasks

- [x] Add a `ChangeStepContext` type to `src/core/batch/engine/contract.ts`
      (change-scoped fields + forced `transition`; `batch` retained only as the
      run-state locus) and export it from `src/core/batch/engine/index.ts`.
- [x] Write `test/core/batch/engine/change-step.test.ts`: with an injected
      runtime, `runChangeStep` spawns exactly one agent for the forced
      transition, returns a `StepResult` for the same change/transition, honours
      the forced transition without calling `computeNextTransition`, maps a
      clean exit to `advanced`, and maps a non-zero/uncompleted exit to
      `blocked` (resumable).
- [x] Implement `runChangeStep(ctx)` on `RatchetBatchEngine` by extracting the
      spawn-and-map body of `runStepLocked` (instructions → runtime select →
      single spawn → journal-delta snapshot → `mapSessionToOutcome` →
      `toStepResult`); no lock, no transition derivation inside it.
- [x] Re-point `runStepLocked` to delegate to `runChangeStep`: keep the batch
      lock, `computeNextTransition` derivation, and park-precedence in `runStep`;
      pass the forced transition through a `ChangeStepContext`.
- [x] Run `pnpm vitest run test/core/batch/engine/change-step.test.ts` and the
      existing batch-engine apply suites
      (`test/batch-engine/engine.test.ts`,
      `test/batch-engine/engine-agent-override.test.ts`,
      `test/cli-e2e/batch-bundled-engine.test.ts`); confirm all pass — batch
      behaviour (lock, transition derivation, parking, persisted outcome)
      unchanged.
