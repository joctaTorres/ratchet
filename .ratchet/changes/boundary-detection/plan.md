# boundary-detection

## Why

Phase 3 (`stacked-pr-grouping-modes`) of the `per-stage-agents-and-prs` batch
extends PR grouping from a single whole-batch PR to stacked `per-phase` and
`per-change` PRs. Before the engine can spawn a PR agent at each group boundary
or compute a stacked base for it, it needs one authoritative answer to *"where
are the PR group boundaries and what identifies each group?"* — derived from the
batch's ordered phases/changes and the resolved `prGrouping` mode. This change
lands that single answer as a pure, deterministic function (no filesystem, no
spawn) so every downstream Phase 3 consumer reads it instead of re-deriving
boundary rules inline. `grouping-mode-schema` already validates the two new modes
as vocabulary; this is the first change that gives them meaning.

## What Changes

- A new pure module `src/core/batch/engine/boundary.ts` exports
  `detectPrGroupBoundaries(batch, mode)` — the single home for the boundary
  policy — plus its plain-data input/output types. Given the batch's ordered
  phases (each with its ordered change names) and a resolved `PrGrouping` mode,
  it returns the ordered list of `PrGroupBoundary` objects:
  - `off` → `[]` (no boundaries, no PR ever).
  - `whole-batch` → exactly one boundary, `kind: 'batch'`, identity = batch name,
    member changes = every change across all phases in order, trigger = the last
    change overall.
  - `per-phase` → one boundary per phase that has ≥1 change, `kind: 'phase'`,
    identity = phase name, member changes = that phase's changes, trigger = the
    phase's last change; empty phases are skipped.
  - `per-change` → one boundary per change across all phases in order,
    `kind: 'change'`, identity = change name, member changes = `[change]`,
    trigger = that change.
  - An empty batch (no changes in any phase) → `[]` under every mode.
  Each boundary carries a contiguous 0-based `index` ("group N") so the follow-on
  `stacked-base-selection` change can base group N on group N-1.
- `src/core/batch/engine/index.ts` re-exports the new function and its types on
  the public engine surface, mirroring how `selection.ts`/`transition.ts` policy
  helpers are exposed.
- A new unit test `test/batch-engine/boundary-detection.test.ts` proves the
  mapping for all four modes plus the edge cases (empty phase skipped, empty
  batch, contiguous indices, unique identities), with no filesystem and no spawn.
  Implements `features/pr-group-boundaries/boundary-detection.feature`.
- `docs/engine/agent-runtime.md` documents the boundary-detection policy (see
  Documentation task).

Not a breaking change: the function is a new, unwired building block. No engine
transition, step selection, spawn path, CLI verb, or config surface changes here;
nothing yet *calls* `detectPrGroupBoundaries`. Setting `per-phase`/`per-change`
still spawns nothing (that wiring lands in `engine-spawn-at-boundaries` /
`apply-boundary-pr-wiring` later in Phase 3) — the intended intermediate state.

## Design

**One authoritative home for the boundary policy (`delegated-lifecycle` —
"'Done' has one definition").** The batch will grow three consumers that all need
to agree on *where the PR groups are*: `stacked-base-selection` (base group N on
group N-1), `engine-spawn-at-boundaries` (spawn one PR agent per boundary), and
`apply-boundary-pr-wiring` (surface a PR step per boundary). If each re-derived
"is this change a boundary?" inline, the rules would drift exactly as the
standard warns a second done-rule does. So the ordered boundary list and each
group's identity are computed **once** in `detectPrGroupBoundaries` and honored
by every consumer — the same single-home discipline that `hasJournaledVerify` /
`hasJournaledPr` / `isChangeDone` already enforce in `transition.ts`. This change
adds no lifecycle *instruction* text and spawns no agent; it is a pure policy the
orchestration layer will consult, keeping boundary semantics out of any inline
engine branch.

**Structural mapping, not a runtime completion check.** "Batch state" here is the
batch's *structure* — its ordered phases and, within each, its ordered change
names — because the boundary *set* is fixed by the plan, not by how far the run
has progressed: per-phase boundaries are each phase's last change, per-change
boundaries are every change, whole-batch is the one batch-completion boundary,
regardless of which changes happen to be done yet. Runtime completion is what a
*later* consumer folds in to decide *when* a boundary fires: `boundary.triggerChange`
is the change whose completion the engine matches against (mirroring how
`pickNextStep` already treats "the terminal phase's" completion as the
whole-batch trigger). Keeping this function structural is what makes it pure and
exhaustively unit-testable over tiny in-memory inputs — no `ChangeDiskState`,
journal, or disk read enters it.

**Plain-data input, mirroring `selection.ts` (not the Zod manifest types).**
Like `SelectablePhase`/`SelectableChange`, the input is a minimal plain
projection rather than `BatchManifest`, so the function stays decoupled from the
schema layer and trivial to construct in tests:

```ts
export interface BoundaryPhase {
  name: string;
  /** Ordered change names within the phase. */
  changes: string[];
}
export interface BoundaryBatchState {
  /** The batch's stable name — the group identity for a whole-batch group. */
  name: string;
  /** Ordered phases, each with its ordered change names. */
  phases: BoundaryPhase[];
}

export type PrGroupKind = 'batch' | 'phase' | 'change';
export interface PrGroupBoundary {
  /** 0-based position in the ordered list — "group N" for stacked base. */
  index: number;
  kind: PrGroupKind;
  /** Stable identity: batch name, phase name, or change name. */
  groupId: string;
  /** Ordered change names whose combined diff this group's PR contains. */
  changes: string[];
  /** The group's last change — the completion the engine matches to fire it. */
  triggerChange: string;
}

export function detectPrGroupBoundaries(
  batch: BoundaryBatchState,
  mode: PrGrouping,
): PrGroupBoundary[];
```

The engine adapts its live `BatchManifest` to `BoundaryBatchState` at the call
site downstream (`{ name, phases: phases.map(p => ({ name: p.name, changes:
p.changes.map(c => c.name) })) }`) — a one-liner, exactly as callers build
`SelectablePhase[]` today. The `mode` parameter reuses the `PrGrouping` type from
`src/core/batch/config.ts` (the vocabulary source of truth) rather than a second
enum, so the four cases stay exhaustive as the enum evolves.

**Deterministic construction of identity and index.** Group identities are stable
names taken straight from the user's manifest — batch name, phase name, or change
name — which are unique within a batch (change names map to change directories,
phase names are unique). The `index` is the boundary's position in the returned
ordered list, assigned sequentially after empty phases are skipped, so `per-phase`
over `[p1:{a,b}, p2:{}, p3:{c}]` yields indices `0`(p1), `1`(p3) — contiguous, no
gap for the skipped phase — which is precisely the "group N / group N-1" ordering
`stacked-base-selection` will consume. Empty groups never appear: a phase with no
changes produces no boundary, and a batch with no changes at all produces `[]`
under every mode (nothing to open a PR for).

**Generalizable, forge-/ecosystem-agnostic (`generalizable-defaults`).** The
function ships no default that runs in or is written into a user repo, and embeds
no toolchain, package-manager, or forge literal: identities are the user's own
manifest names and the mode strings are the neutral vocabulary
`grouping-mode-schema` already validated. There is no `git`/`gh`/`pnpm` string
anywhere in the policy — stacked-branch and forge concerns stay entirely in later
changes.

**Testing (`testing`).** Pure policy proven at the unit layer (the pyramid's base;
no filesystem, no process spawn), cloning the `selection.test.ts` shape — `import
{ describe, it, expect } from 'vitest'`, `.js`-suffixed source import, small
local factory helpers to build in-memory `BoundaryBatchState`, one behavior per
`it`, `toEqual` on plain objects. `test/batch-engine/boundary-detection.test.ts`
(header naming `features/pr-group-boundaries/boundary-detection.feature`) asserts:
`off` → `[]`; `whole-batch` → one `batch` boundary spanning all changes in order,
trigger = last change, index 0; `per-phase` → one `phase` boundary per non-empty
phase with the phase's identity/members/last-change trigger, in phase order;
`per-change` → one `change` boundary per change in order; a phase with no changes
is skipped and indices stay contiguous; an empty batch → `[]` under every mode;
group indices are `0..n-1` and identities are unique. This is the change's
proof-of-work (the phase-level blackbox e2e
`test/cli-e2e/batch-pr-grouping-modes.test.ts` lands later with
`grouping-modes-e2e-and-docs`). The full suite and the coverage gate stay green at
or above the enforced `COVERAGE_THRESHOLD`.

**Documentation (`documentation`, mandatory).** The boundary-detection policy is a
new engine building block, documented where the engine runtime is described (the
same Reference home `pr-spawn-at-completion` used). `docs/engine/agent-runtime.md`
gains a short "PR group boundary detection" subsection stating accurately what
this change adds: a pure function maps the batch's ordered phases/changes and the
resolved `prGrouping` mode to the ordered list of PR group boundaries — per-phase
= each phase's last change, per-change = every change, whole-batch = one boundary
at batch completion, off = none — each carrying a stable group identity and a
0-based index, and noting the spawn/base-selection wiring that consumes it lands
in later Phase 3 changes (documenting *what is*, not aspirational behavior, per
the standard). No user-facing CLI/flag/config surface changes here — the
`prGrouping` config vocabulary was already documented by `grouping-mode-schema`
and the README PR-opening section already notes the stacked modes — so, per the
standard's "do not over-document visually" guidance, no `README.md` change and no
new Mermaid diagram are added (the stacked-flow diagram lands with the change that
implements stacked spawning).

## Tasks

- [x] 1.1 Add `src/core/batch/engine/boundary.ts`: export the plain-data types
  `BoundaryPhase`, `BoundaryBatchState`, `PrGroupKind`, `PrGroupBoundary` and the
  pure function `detectPrGroupBoundaries(batch, mode)`, importing `PrGrouping`
  from `../config.js`. Implement the four mode cases and the empty-phase /
  empty-batch skips with contiguous 0-based indices, exactly as the Design
  specifies. Keep it filesystem- and spawn-free (a documented single-home policy
  in the `transition.ts`/`selection.ts` mold).
- [x] 1.2 Re-export `detectPrGroupBoundaries` and its types from
  `src/core/batch/engine/index.ts`, matching how the other pure engine policy
  helpers are surfaced.
- [x] 2.1 (`testing`) Add `test/batch-engine/boundary-detection.test.ts` (header
  naming `features/pr-group-boundaries/boundary-detection.feature`) in the
  `selection.test.ts` style: local factory helpers for `BoundaryBatchState`, one
  `describe` per mode plus edge-case `it`s covering `off` empty, `whole-batch`
  single spanning boundary, `per-phase` per-non-empty-phase identity/order,
  `per-change` per-change identity/order, empty phase skipped with contiguous
  indices, empty batch → `[]` under all four modes, and unique identities. Run
  the suite and confirm it plus the coverage gate stay green at/above the enforced
  `COVERAGE_THRESHOLD`.
- [x] 3.1 (`documentation`, mandatory — `documentation` standard / "Reference
  documentation") Add a "PR group boundary detection" subsection to
  `docs/engine/agent-runtime.md` accurately describing `detectPrGroupBoundaries`'s
  mapping (the four modes, group identity, 0-based index) and noting that the
  spawn / stacked-base consumers land in later Phase 3 changes; match the doc's
  existing tone and terminology. No `README.md` or diagram change (no new
  user-facing surface; vocabulary already documented by `grouping-mode-schema`).
