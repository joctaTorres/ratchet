# Per-change success criterion in the batch manifest

## Why

A batch manifest's change intents currently carry only `name` and `after` — the
only success bar lives at the phase level. Authors want each change to state, in
one short line, what "done" means for *it*. Today adding `success:` to a change
in `batch.yaml` is silently dropped by the schema, so the field must be made real
end to end: parsed, surfaced to the coding agent, and visible in derived status.

## What Changes

- **Schema**: add an optional `success` (non-empty when present) to
  `ChangeIntentSchema` in `src/core/batch/manifest.ts`. Backward compatible —
  existing manifests without it stay valid. Implements
  `features/batch-change-success/manifest-schema.feature`.
- **Engine context**: thread the picked change intent's `success` into the
  engine via `ResolvedStepContext` (`src/core/batch/engine/contract.ts`) and
  populate it in `src/commands/batch/apply.ts`.
- **Agent instructions**: when the change has a `success`, emit a `Change
  success criteria:` line in `src/core/batch/engine/instructions.ts`, kept
  agent-neutral and alongside the existing phase goal/success lines. Implements
  `features/batch-change-success/step-instructions.feature`.
- **Derived status**: carry `success` onto `ChangeStatusInfo` in
  `src/core/batch/status.ts` so `batch status --json` exposes it. Implements
  `features/batch-change-success/status-output.feature`.
- **Authoring surface**: document the optional per-change `success` in the
  manifest template (`schemas/ratchet/templates/batch.yaml`) and in the shared
  `propose-batch` workflow content (`src/core/templates/workflows/propose-batch.ts`).
  Implements `features/batch-change-success/authoring.feature`.
- **Data**: enrich the three phase-one changes in
  `.ratchet/batches/ci-npx-release/batch.yaml` with short, clear `success` lines
  (the concrete request that motivated this change).

## Design

**Optional, non-empty.** `success: z.string().min(1).optional()` mirrors how
phase `success` is validated (`min(1)`) but stays optional so it is purely
additive — no migration, no churn to existing manifests or fixtures. Zod strips
unknown keys today, which is exactly why the field is currently lost; promoting
it to a schema field is the whole fix at the parse layer.

**Threading, not restructuring.** `ResolvedStepContext.change` is a bare name
string and several call sites depend on that. Rather than reshape it into an
object, add a sibling optional field (`changeSuccess?: string`) to the context.
`apply.ts` already resolves the picked `ChangeIntent` in `pickNextStep`, so it
can pass `change.success` through with no extra lookup. `instructions.ts` then
conditionally appends one line next to the existing `Phase success criteria:`
line. This keeps the change small and the existing transition logic untouched.

**Multi-agent standard.** Per `multi-agent-support`, the agent-facing surfaces
must be tool-agnostic. The instructions line refers to "the change" generically
(no agent named); the `propose-batch` guidance lives in shared template content
rendered per agent via the registry, so the guidance lands for every supported
agent — not just one. No agent-specific copies are introduced.

**Status passthrough.** `derivePhaseStatus` already maps each `ChangeIntent` to
a `ChangeStatusInfo`; adding `success: intent.success` is a one-field passthrough
so the apply-batch orchestrator can relay it without re-reading the manifest.

## Tasks

- [x] 1.1 Add optional non-empty `success` to `ChangeIntentSchema` in `src/core/batch/manifest.ts`
- [x] 1.2 Unit-test parse: success retained when present, valid when absent, rejected when empty (`manifest-schema.feature`)
- [x] 2.1 Add `changeSuccess?: string` to `ResolvedStepContext` in `src/core/batch/engine/contract.ts`
- [x] 2.2 Populate `changeSuccess` from the picked change intent in `src/commands/batch/apply.ts`
- [x] 2.3 Emit an agent-neutral `Change success criteria:` line in `src/core/batch/engine/instructions.ts` only when present
- [x] 2.4 Unit-test instructions: line present with success, absent without, names no specific agent (`step-instructions.feature`)
- [x] 3.1 Add `success?` to `ChangeStatusInfo` and pass it through in `src/core/batch/status.ts`
- [x] 3.2 Unit-test `batch status --json` includes/omits per-change success (`status-output.feature`)
- [x] 4.1 Document the optional per-change `success` field in `schemas/ratchet/templates/batch.yaml` changes example
- [x] 4.2 Document the optional short per-change `success` in `src/core/templates/workflows/propose-batch.ts` change-intent guidance
- [x] 4.3 Test the authoring guidance renders for every registered agent (`authoring.feature`)
- [x] 5.1 Enrich the three phase-one changes in `.ratchet/batches/ci-npx-release/batch.yaml` with short, clear `success` lines
- [x] 5.2 Run `pnpm lint` and `pnpm test`; confirm the new scenarios and existing batch suites pass
