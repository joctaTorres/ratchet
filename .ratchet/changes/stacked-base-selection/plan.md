# stacked-base-selection

## Why

Phase 3 (`stacked-pr-grouping-modes`) of the `per-stage-agents-and-prs` batch
turns the two stacked modes (`per-phase`, `per-change`) into real stacked PRs.
`boundary-detection` already answers *"where are the PR groups and what
identifies each one?"* as an ordered, 0-based list of `PrGroupBoundary` objects.
The missing piece before any PR can be spawned is *"what branch does each group's
PR target?"*: for stacked PRs, group N must base on group N-1's branch (and the
first group on the batch's base branch) so each PR's diff stays scoped to its own
unit while dependent code still compiles. This change lands that answer as a
single pure, deterministic function so every downstream Phase 3 consumer computes
the stacked base one way, not inline.

## What Changes

- A new pure module `src/core/batch/engine/stacked-base.ts` exports
  `selectStackedBases(boundaries, batchBaseBranch, branchForGroup)` — the single
  home for the stacked-base policy — plus its plain-data output type
  `StackedBase`. Given the ordered `PrGroupBoundary[]` (from
  `detectPrGroupBoundaries`), the batch's base branch, and a `branchForGroup`
  resolver that names each group's own branch, it returns one `StackedBase` per
  boundary, in order:
  - group 0 → `baseBranch` = the batch base branch; `headBranch` =
    `branchForGroup(boundary0)`.
  - group N (N ≥ 1) → `baseBranch` = `branchForGroup(boundary N-1)` (the previous
    group's own branch); `headBranch` = `branchForGroup(boundary N)`.
  - each `StackedBase` also carries its originating `boundary` so a consumer keeps
    the group identity/trigger without a second lookup.
  - an empty boundary list → `[]` (nothing to stack).
- `src/core/batch/engine/index.ts` re-exports `selectStackedBases` and
  `StackedBase` on the public engine surface, mirroring how `detectPrGroupBoundaries`
  and the other pure policy helpers are surfaced.
- A new unit test `test/batch-engine/stacked-base-selection.test.ts` proves the
  stacking rule and edge cases over in-memory boundary orderings, with no
  filesystem and no spawn. Implements
  `features/stacked-pr-base/stacked-base-selection.feature`.
- `docs/engine/agent-runtime.md` documents the stacked-base-selection policy (see
  Documentation task).

Not a breaking change: the function is a new, unwired building block. No engine
transition, step selection, spawn path, CLI verb, or config surface changes here;
nothing yet *calls* `selectStackedBases`. Setting `per-phase`/`per-change` still
spawns nothing — the stacked-base value is threaded into the spawn/instruction
payload later in Phase 3 (`pr-instruction-stacked-base`,
`engine-spawn-at-boundaries`, `apply-boundary-pr-wiring`) — the intended
intermediate state.

## Design

**One authoritative home for the stacked-base policy (`delegated-lifecycle` —
"'Done' has one definition").** Three later changes need to agree on *what branch
a group's PR targets*: `pr-instruction-stacked-base` (carry the resolved base as
instruction data), `engine-spawn-at-boundaries` (inject the computed base into the
delegated payload), and `apply-boundary-pr-wiring` (surface a PR step per
boundary). If each re-derived "group N bases on group N-1" inline, the rule would
drift exactly as the standard warns a second done-rule does. So the stacking rule
is computed **once** in `selectStackedBases` and honored by every consumer — the
same single-home discipline `detectPrGroupBoundaries` already established for
boundaries and `hasJournaledPr`/`isChangeDone` enforce in `transition.ts`. This
change adds no lifecycle *instruction* text and spawns no agent; it is a pure
policy the orchestration layer consults, keeping base semantics out of any inline
engine branch.

**Structural mapping over the ordered boundaries, not a runtime check.** The base
for group N is fixed by the *ordering* of the detected boundaries — the previous
boundary's group branch — not by how far the run has progressed. So the input is
the already-ordered `PrGroupBoundary[]` and the function maps purely over array
position: position 0 bases on the batch base branch, position N bases on the group
branch of position N-1. This keeps it pure (no `ChangeDiskState`, journal, or disk
read) and exhaustively unit-testable over tiny in-memory orderings, mirroring
`boundary-detection`.

**Branch naming is supplied, not baked in (`instruction-fed-config`,
`generalizable-defaults`).** The function does not invent or embed a stacked
branch-naming scheme; it receives a `branchForGroup: (boundary) => string`
resolver and consumes it as data. The concrete group branch name — like the
`baseBranch`/`workBranch` that `PrStepContext` already documents as "RESOLVED
UPSTREAM … delivered as data" — is the caller's (engine's) concern, resolved once
and threaded in. This keeps `selectStackedBases` decoupled from any git/forge
literal and from a premature commitment to a naming convention that
`engine-spawn-at-boundaries` owns: there is no `git`/`gh`/`pnpm`/`origin` string
anywhere in the policy. It also makes the stacking rule provable in isolation — a
test supplies a trivial `b => \`pr/${b.groupId}\`` and asserts the base chain —
without standing up a real repo.

**Plain-data output carrying the boundary.** The output mirrors
`boundary-detection`'s plain-projection style — a minimal `StackedBase` rather
than a Zod type — so it is trivial to construct and assert in tests and decoupled
from the schema layer:

```ts
export interface StackedBase {
  /** The boundary this base was computed for — carries index/kind/groupId/trigger. */
  boundary: PrGroupBoundary;
  /** The branch this group's PR opens FROM — branchForGroup(boundary). */
  headBranch: string;
  /**
   * The branch this group's PR targets: the PREVIOUS group's headBranch, or the
   * batch base branch for the first group.
   */
  baseBranch: string;
}

export function selectStackedBases(
  boundaries: PrGroupBoundary[],
  batchBaseBranch: string,
  branchForGroup: (boundary: PrGroupBoundary, index: number) => string,
): StackedBase[];
```

Carrying the whole `boundary` (not just its id) lets `engine-spawn-at-boundaries`
keep the group's `triggerChange`/`kind`/member `changes` alongside the resolved
base without a second lookup. The function maps over the array's own order rather
than trusting `boundary.index`, so it is correct for any ordered input and stays
consistent with the "over ordered boundaries" contract.

**Testing (`testing`).** Pure policy proven at the unit layer (the pyramid's base;
no filesystem, no process spawn), cloning the `boundary-detection.test.ts` shape —
`import { describe, it, expect } from 'vitest'`, `.js`-suffixed source import,
small local factory helpers to build in-memory `PrGroupBoundary[]`, one behavior
per `it`, `toEqual`/`toBe` on plain values. The test header names
`features/stacked-pr-base/stacked-base-selection.feature`. It asserts: the first
group bases on the batch base branch and heads on its own branch; each later group
bases on the previous group's branch; the produced list preserves boundary order,
carries each originating boundary, and forms the expected `main -> pr/a -> pr/b`
base chain; a single group bases on the batch base branch; an empty boundary list
→ `[]`; the group branch naming is honored from the supplied resolver (a second
resolver `feature/<id>` yields `feature/...` bases). This is the change's
proof-of-work at its layer (the phase-level blackbox e2e
`test/cli-e2e/batch-pr-grouping-modes.test.ts` lands later with
`grouping-modes-e2e-and-docs`). The full suite and the coverage gate stay green at
or above the enforced `COVERAGE_THRESHOLD`.

**Documentation (`documentation`, mandatory).** The stacked-base-selection policy
is a new engine building block, documented where the engine runtime is described
(the same Reference home `boundary-detection` used). `docs/engine/agent-runtime.md`
gains a short "Stacked PR base selection" subsection stating accurately what this
change adds: a pure function maps the ordered PR group boundaries plus the batch
base branch and a supplied group-branch resolver to each group's stacked base —
group N on group N-1's branch, the first group on the batch base branch — carrying
each originating boundary, and noting the spawn/instruction wiring that consumes it
lands in later Phase 3 changes (documenting *what is*, not aspirational behavior).
No user-facing CLI/flag/config surface changes here — the `prGrouping` vocabulary
was already documented by `grouping-mode-schema` — so, per the standard's "do not
over-document visually" guidance, no `README.md` change and no new Mermaid diagram
are added (the stacked-flow diagram lands with `grouping-modes-e2e-and-docs`).

## Tasks

- [x] 1.1 Add `src/core/batch/engine/stacked-base.ts`: export the plain-data type
  `StackedBase` and the pure function
  `selectStackedBases(boundaries, batchBaseBranch, branchForGroup)`, importing the
  `PrGroupBoundary` type from `./boundary.js`. Map over the ordered boundaries so
  group 0 bases on `batchBaseBranch` and group N bases on the previous group's
  `branchForGroup(...)`, each `StackedBase` carrying its originating boundary and
  `headBranch`. Keep it filesystem- and spawn-free with no git/forge literal (a
  documented single-home policy in the `boundary.ts` mold).
- [x] 1.2 Re-export `selectStackedBases` and the `StackedBase` type from
  `src/core/batch/engine/index.ts`, matching how `detectPrGroupBoundaries` and the
  other pure engine policy helpers are surfaced.
- [x] 2.1 (`testing`) Add `test/batch-engine/stacked-base-selection.test.ts`
  (header naming `features/stacked-pr-base/stacked-base-selection.feature`) in the
  `boundary-detection.test.ts` style: local factory helpers for `PrGroupBoundary[]`,
  `it`s covering first-group-on-base, later-group-on-previous, order preserved with
  boundary carried and the `main -> pr/a -> pr/b` base chain, single group on base,
  empty list → `[]`, and a supplied `feature/<id>` resolver honored. Run the suite
  and confirm it plus the coverage gate stay green at/above the enforced
  `COVERAGE_THRESHOLD`.
- [x] 3.1 (`documentation`, mandatory — `documentation` standard / "Reference
  documentation") Add a "Stacked PR base selection" subsection to
  `docs/engine/agent-runtime.md` accurately describing `selectStackedBases`'s
  mapping (group N on group N-1's branch, first group on the batch base branch,
  each base carrying its boundary, branch naming supplied by the caller) and noting
  that the spawn/instruction consumers land in later Phase 3 changes; match the
  doc's existing tone and terminology. No `README.md` or diagram change (no new
  user-facing surface; vocabulary already documented by `grouping-mode-schema`).
