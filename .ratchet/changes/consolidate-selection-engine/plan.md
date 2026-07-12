# consolidate-selection-engine

## Why

Runnable-step selection exists three times: the engine's `selectRunnableStep`
(`src/core/batch/engine/selection.ts`) is dead — its only callers are its own
unit tests — while the live selector `pickNextStep` sits in the CLI
(`src/commands/batch/apply.ts`), and `computeBatchStatus`
(`src/core/batch/status.ts`) re-implements the same "first ungated phase's
first runnable change" eligibility walk inline to derive `next`. Three copies
of one rule is how selection fixes land in one place and silently miss the
others (ratchet issue #83, confirmed OPEN and unfixed 2026-07-09). Fixes #83.

## What Changes

- `pickNextStep` becomes the single selection engine: it moves — with its five
  branch selectors (`selectChangeOrBoundaryProof`, `selectDecomposeStep`,
  `selectTerminalProofStep`, `selectWholeBatchPrStep`, `selectStackedPrStep`),
  `pendingBoundaryProof`, `RUNNABLE_STATUSES`, `PickPrContext`, the
  `ApplyTarget` type, and `boundaryStateFromPhases` — from
  `src/commands/batch/apply.ts` into `src/core/batch/engine/selection.ts`, and
  is exported through `src/core/batch/engine/index.ts`.
- The dead `selectRunnableStep` is deleted, along with `pickRunnableChange` and
  the `SelectablePhase`, `SelectableChange`, `SelectedStep`, `NoStepReason`,
  and `SelectionResult` types and their `engine/index.ts` exports. The unit
  coverage that only the dead path had (`test/batch-engine/selection.test.ts`)
  is ported onto `pickNextStep`.
- The duplicated gate/eligibility walk is unified: the "first ungated phase's
  first runnable change" walk is extracted into one exported helper in
  `selection.ts`, called by both `computeBatchStatus` (to derive the
  change-level `next`) and `pickNextStep`'s change branch — status derivation
  and step selection share one code path.
- Reference docs and stale code comments that describe the two-selector world
  are updated (`docs/engine/overview.md` prose, flow list, and diagram;
  comments in `status.ts` and `apply.ts`).
- No behavior change: `batch apply` selects the same steps, in the same order,
  before and after the move. Implements
  `features/selection-engine/single-owner.feature`.

## Design

**Why the engine owns selection.** The engine is the home of batch
orchestration policy (gating, boundaries, transitions); the CLI should stay a
thin driver. `pickNextStep` is already pure over data (`BatchStatusInfo`,
manifest `Phase[]`, recorded proof phases, PR gating inputs — it reads neither
config nor the journal), so it moves verbatim: same signature, same
load-bearing branch order (change/boundary-proof → decompose → terminal proof
→ whole-batch PR → stacked PR), byte-identical selection behavior.

**Imports and cycle safety.** `selection.ts` imports `prJournalKey` from
`./instructions.js` and `detectPrGroupBoundaries`/`BoundaryBatchState`/
`PrGroupBoundary` from `./boundary.js` directly — never via the engine index,
so no index cycle forms. Its imports from `status.ts` (`BatchStatusInfo`,
`ChangeStatus`), `manifest.ts` (`Phase`), and `config.ts` (`PrGrouping`) are
type-only and erased at compile time, which is what lets `status.ts`
runtime-import the shared eligibility helper from `selection.ts` without a
cycle.

**The unification point.** The duplicated walk is exactly: skip gated phases,
pick the first change whose derived status is in {`ready`, `in-progress`,
`awaiting-verify`}. That becomes one exported helper in `selection.ts` (e.g.
`firstRunnableChange(phases)`), keyed on the single `RUNNABLE_STATUSES` set.
`computeBatchStatus` calls it to derive the change-level `next` (its
aggregate-counters loop stays as is); `selectChangeOrBoundaryProof` calls it
and then layers the boundary-proof interposition on the picked phase. One set,
one walk — status and selection agree by construction instead of by mirrored
comments.

**Porting the dead path's coverage.** `selectRunnableStep`'s six unit tests
encode real invariants (DAG-ordered pick, unmet-dep hold, parked hold,
gated-phase skip, all-done yields no step, blocked/parked yields no step) but
against a shape (`SelectablePhase[]` with raw `after` edges) that dies with it.
They are ported as pure unit tests over in-memory `BatchStatusInfo`-shaped
input — the surviving selector's real input — mapping the dead shape's facts
onto derived statuses (`after` unmet → `blocked`, parked → `blocked`/parked
status, done → `done`) and asserting `pickNextStep` returns the expected
`ApplyTarget` or `undefined`. No filesystem, no process spawn: these stay at
the unit layer of the test pyramid (testing standard), and porting them keeps
the 95% line-coverage floor intact when the dead path's covered lines are
deleted.

**Test imports move with the code.** Eight test files import `pickNextStep` /
`ApplyTarget` from `commands/batch/apply.js`; they are updated to import from
the engine. `apply.ts` keeps no re-export — a lingering CLI alias is exactly
the drift-by-two-import-paths this change removes. `boundaryStateFromPhases`
stays shared by `pickNextStep` and `runStackedPr`, now exported from the
engine so `apply.ts` imports it like any other engine seam.

**Documentation (documentation standard).** `docs/engine/overview.md` is the
Reference home of the selection story and currently documents both selectors
(prose at lines ~196–231 and ~502, the flow list at ~660). It is rewritten to
name `pickNextStep` in `src/core/batch/engine/selection.ts` as the single
selection engine and to describe the shared eligibility walk; the Mermaid
flow diagram is checked against the moved code and kept accurate. Stale code
comments naming `selectRunnableStep` (`status.ts:338`, `status.ts:415`,
`apply.ts:491`) are updated in the same pass — doc drift is a defect this
phase exists to clear.

**Trade-offs.** Moving code rather than re-implementing it maximizes the
chance selection order is provably unchanged (the existing selection tests —
proof-gate, proof-at-boundary, PR-step, stacked-PR-step, terminal-phase,
drive-decomposition — all keep passing against the moved implementation).
The alternative of teaching `selectRunnableStep` the five branches and
deleting `pickNextStep` was rejected: `pickNextStep` is the battle-tested
implementation with the full branch set; `selectRunnableStep` never ran in
production.

## Tasks

- [x] 1.1 Move `pickNextStep`, its five branch selectors, `pendingBoundaryProof`, `RUNNABLE_STATUSES`, `PickPrContext`, `ApplyTarget`, and `boundaryStateFromPhases` from `src/commands/batch/apply.ts` into `src/core/batch/engine/selection.ts`, importing `prJournalKey` from `./instructions.js` and the boundary policies from `./boundary.js` directly (not via the engine index), with type-only imports for `BatchStatusInfo`/`ChangeStatus`/`Phase`/`PrGrouping`
- [x] 1.2 Export `pickNextStep`, `ApplyTarget`, and `boundaryStateFromPhases` from `src/core/batch/engine/index.ts`; update `apply.ts` to import them from the engine (no local copy, no re-export) and update the eight test files importing `pickNextStep`/`ApplyTarget` from `commands/batch/apply.js` to import from the engine
- [x] 2.1 Extract the runnable-change eligibility walk (skip gated phases, first change with status in `RUNNABLE_STATUSES`) into one exported helper in `selection.ts` and use it from `selectChangeOrBoundaryProof`
- [x] 2.2 Replace `computeBatchStatus`'s inline change-level `next` walk in `src/core/batch/status.ts` with a call to the shared helper, leaving the aggregate-counters loop intact and the derived `next` value unchanged
- [x] 3.1 Port the six unit tests in `test/batch-engine/selection.test.ts` onto `pickNextStep` as pure unit tests over in-memory `BatchStatusInfo`-shaped input (no filesystem), preserving each invariant: ordered pick, dep-blocked hold, parked hold, gated-phase skip, all-done → no step, all-blocked-or-parked → no step
- [x] 3.2 Delete `selectRunnableStep`, `pickRunnableChange`, and the `SelectablePhase`/`SelectableChange`/`SelectedStep`/`NoStepReason`/`SelectionResult` types; remove their `engine/index.ts` exports; verify by grep that no source or test file references `selectRunnableStep`
- [x] 4.1 Update `docs/engine/overview.md` to describe the single selection engine (prose, flow list, and Mermaid diagram) and fix the stale code comments naming `selectRunnableStep` in `status.ts` and `apply.ts`
- [x] 4.2 Run the full suite (`npm test`) and confirm it passes with selection order unchanged and the 95% coverage floor intact
