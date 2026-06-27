---
title: Change-step core
sidebar_position: 1
---

# Change-step core: `ChangeStepContext` + `runChangeStep`

The change-scoped engine core drives **one forced transition on a single
change**. It is the shared path both `batch apply` and the headless
`propose`/`apply`/`verify` verbs run through. It does not acquire the per-batch
lock and does not derive the transition from disk — both remain the caller's
concern.

Exported from `src/core/batch/engine/index.ts`.

## `ChangeStepContext`

The change-scoped subset `runChangeStep` consumes.

```ts
interface ChangeStepContext {
  /**
   * Run-state locus only. When set, run files live under
   * `.ratchet/batches/<batch>/run/`; when absent, change-locally under
   * `.ratchet/changes/<change>/.run/`.
   */
  batch?: string;
  change: string;
  /** The picked change intent's own definition of done (required). */
  changeDone: string;
  /** A forced transition — runChangeStep does not re-derive it from disk. */
  transition: Transition; // 'propose' | 'apply' | 'verify'
  phase: {
    name: string;
    goal: string;
    success: string;
    proofOfWork: ProofOfWork;
  };
  settings: BatchSettings;
  /** Prior journal entries for this change (resume context). */
  journal: JournalEntry[];
  /** Appended verbatim to the agent instructions as an "Additional guidance:" block. */
  guidance?: string;
  /** Resume context when the step was parked. */
  resume?: {
    kind: 'blocked' | 'awaiting-approval';
    reason: string;
    answer?: string;
    feedback?: string;
  };
}
```

Field notes:

- **`batch`** — optional; it is the run-state locus only. The `guidance` field
  is left undefined by `batch apply`, so batch instructions stay byte-identical.
  (`batch` was made optional, and `guidance` added, by later changes in the same
  phase; see [Run-state locus](./run-state.md).)
- **`transition`** — forced. `runChangeStep` spawns the agent for it verbatim and
  never calls `computeNextTransition`.

## `RatchetBatchEngine.runChangeStep(ctx)`

```ts
runChangeStep(ctx: ChangeStepContext): Promise<StepResult>
```

For one forced transition it:

1. Honors an unresolved park before any spawn (a parked change returns its parked
   `StepResult` without spawning).
2. Resolves the run-state locus: `.ratchet/batches/<batch>/run/` when `batch` is
   set, else `.ratchet/changes/<change>/.run/`.
3. Builds the agent instructions for the forced transition (including any
   `guidance`), selects the runtime, and spawns **exactly one** agent.
4. Snapshots the journal delta and the on-disk change-state delta for the
   session, maps the session to an `EngineStepOutcome`, and appends the outcome
   journal entry at the resolved locus.
5. Returns a `StepResult`.

It does **not** take the per-batch lock and does **not** derive the transition.

## `StepResult`

```ts
type StepState =
  | 'advanced'
  | 'blocked'
  | 'awaiting-approval'
  | 'phase-gated'
  | 'nothing-ready';

interface StepResult {
  state: StepState;
  change: string;
  transition: Transition;
  /** Present when state is `blocked`: the question requiring an answer. */
  blocker?: string;
  /** Present when state is `awaiting-approval`: the proposal summary. */
  approvalRequest?: string;
  /** Pointer to journal entries this step produced. */
  journalRefs?: number[];
  message?: string;
}
```

## `batch apply` delegation

`RatchetBatchEngine.runStep` keeps the batch-facing boundary: it acquires the
per-batch lock, derives the next transition via `computeNextTransition`, and
applies the park-precedence check, then adapts its `ResolvedStepContext` into a
`ChangeStepContext` and delegates the spawn-and-map body to `runChangeStep`.
Batch behavior — lock, transition derivation, parking, persisted outcome — is
unchanged.
