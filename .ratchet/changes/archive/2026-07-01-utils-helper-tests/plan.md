# utils-helper-tests

## Why

The `core-utilities-coverage` phase lifts the enforced coverage floor toward
~87% by covering the untested core utilities and helpers. Three utils helpers
are owned by this change: `src/utils/match.ts` (pure nearest-match suggestion +
Levenshtein distance), `src/utils/item-discovery.ts` (filesystem listing of
active changes, feature-store capabilities, and archived changes), and
`src/utils/task-progress.ts` (plan checklist tallying + status formatting).
`match.ts` and the formatting/counting helpers are pure deterministic logic; the
discovery helpers and `getTaskProgressForChange` read the filesystem. With the
`testing` standard codified, this change adds unit tests at the correct pyramid
layer for each helper, isolating the filesystem-touching paths with the fixture
pattern, and keeps the full suite green — contributing the branch coverage that
lets the phase ratchet the enforced floor up.

## What Changes

- Add `test/utils/match.test.ts` — **unit** tests for the pure helpers in
  `src/utils/match.ts`, implementing `features/utils-helper-tests/match.feature`.
  No filesystem, no spawn. Covers `levenshtein` (identical strings → 0, single
  substitution, insertion/deletion, empty operand → other length) and
  `nearestMatches` (ranking by distance, capping at the default and a custom
  maximum, returning all when fewer than the max, empty candidate list → empty).
- Add `test/utils/item-discovery.test.ts` — **fixture-isolated** tests for
  `src/utils/item-discovery.ts`, implementing
  `features/utils-helper-tests/item-discovery.feature`. Builds an isolated
  project tree under `fs.mkdtemp(os.tmpdir())`, writes only the minimal
  `.ratchet/` tree each scenario exercises, and removes it in `afterEach`.
  Covers `getActiveChangeIds` (metadata-bearing dirs only, sorted, excluding the
  metadata-less dir, dotfiles, and `archive`; missing dir → `[]`), `getSpecIds`
  (capability dirs sorted, dotfiles excluded; missing dir → `[]`), and
  `getArchivedChangeIds` (metadata-bearing archived dirs only, sorted; missing
  dir → `[]`).
- Add `test/utils/task-progress.test.ts` — **unit** tests for the pure helpers
  plus a small **fixture-isolated** path for the one filesystem read,
  implementing `features/utils-helper-tests/task-progress.feature`. Covers
  `countTasksFromContent` (total/completed tally, `-`/`*` bullets and `[x]`/`[X]`
  marks, non-task lines ignored), `getTaskProgressForChange` (counts from a
  tmpdir change's `plan.md`; missing `plan.md` → `{0,0}`), and `formatTaskStatus`
  (`No tasks` on zero total, complete label on `completed === total`,
  `completed/total tasks` otherwise).
- No production behavior changes — this change ships tests only. Per the
  `testing` standard this still counts as a change "not done until its tests
  are"; because it adds no user-facing surface, the `documentation` standard does
  not apply and no documentation task is required.

## Design

**Layer (per the `testing` standard — test the right thing at the right layer).**
`match.ts` and the counting/formatting helpers of `task-progress.ts` are pure
functions over in-memory inputs, so they get **unit** tests with no filesystem
and no process spawn — never pushed up the pyramid. `item-discovery.ts` and
`getTaskProgressForChange` read the project tree, so those paths are isolated
with the **fixture pattern**: the directory tree they scan is a tmpdir built
per scenario, while the real scan/read/filter/sort logic runs unmocked.

**Fixture isolation (per the `testing` standard).** Each filesystem scenario
builds its tree under `fs.mkdtemp(os.tmpdir())`, writes only the minimal
`.ratchet/` artifacts it exercises — for `item-discovery`, change dirs each
carrying (or deliberately missing) the `.ratchet.yaml` metadata file the helper
keys on, plus a dotfile and an `archive/` entry to prove the filters; for
`task-progress`, a change dir with or without a `plan.md` — and removes the
tmpdir in `afterEach`. Tests depend on no real repo state, on each other, or on
execution order, and leave nothing behind.

**Seams.** The discovery and progress tests drive the public entry points
(`getActiveChangeIds`, `getSpecIds`, `getArchivedChangeIds`,
`getTaskProgressForChange`) over the fixture rather than mocking `fs`, passing
the tmpdir root explicitly so the real `fs.readdir`/`fs.access`/`fs.readFile`
run against the isolated tree. Assertions are over the returned id lists and
progress tallies.

**Traceability (per the `testing` standard — mirror the `.feature` in the
header).** Each test file names its corresponding `.feature` in the header,
matching the conventions across `test/utils/` and `test/core/`:
- `test/utils/match.test.ts` → `match.feature`
- `test/utils/item-discovery.test.ts` → `item-discovery.feature`
- `test/utils/task-progress.test.ts` → `task-progress.feature`

**Done bar.** The three new test files cover each helper's main behaviors and key
branches, and the full vitest suite stays green. The phase's enforced
coverage-floor lift to ~87 is owned by the phase's floor-ratchet change; this
change's contribution is the three helpers' branch coverage and a green suite.

## Tasks

- [x] 1.1 Write `test/utils/match.test.ts` implementing `match.feature` as
  **unit** tests (no filesystem, no spawn): cover `levenshtein` (identical → 0,
  single substitution, insertion/deletion, empty operand → other length) and
  `nearestMatches` (distance ranking, default-max cap, custom-max cap,
  fewer-than-max returns all, empty candidates → empty), with the `.feature`
  named in the header.
- [x] 1.2 Write `test/utils/item-discovery.test.ts` implementing
  `item-discovery.feature` with **fixture isolation**: build the project tree
  under `fs.mkdtemp(os.tmpdir())` and remove it in `afterEach`. Cover
  `getActiveChangeIds` (metadata-bearing only, sorted, excluding metadata-less
  dir/dotfile/`archive`; missing dir → `[]`), `getSpecIds` (capability dirs
  sorted, dotfile excluded; missing dir → `[]`), and `getArchivedChangeIds`
  (metadata-bearing archived only, sorted; missing dir → `[]`), with the
  `.feature` named in the header.
- [x] 1.3 Write `test/utils/task-progress.test.ts` implementing
  `task-progress.feature`: **unit** tests for `countTasksFromContent`
  (total/completed tally, `-`/`*` bullets and `[x]`/`[X]` marks, non-task lines
  ignored) and `formatTaskStatus` (`No tasks`/complete/`completed/total tasks`),
  plus a **fixture-isolated** path for `getTaskProgressForChange` (counts from a
  tmpdir `plan.md`; missing → `{0,0}`) removed in `afterEach`, with the
  `.feature` named in the header.
- [x] 2.1 Run `pnpm build && pnpm vitest run --coverage` and confirm the full
  suite is green with the three new utils-helper test files included.
