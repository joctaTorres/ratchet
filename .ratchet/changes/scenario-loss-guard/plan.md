# scenario-loss-guard

## Why

`ratchet archive` applies a change's feature files into the permanent store by
whole-file replacement, so a change whose file omits a scenario the store
already holds — a stale checkout, a hand edit, or a second change overwriting
the first's file — silently deletes accepted behavior from the living
specification. This is the core change of the batch phase
`scenario-safe-archive`: archiving must refuse that loss by default.

## What Changes

- `src/core/features-apply.ts`: before any store write, compare `Scenario` /
  `Scenario Outline` names (via the existing `GherkinParser`) between the store
  copy and the change copy of every file the change would overwrite; on any
  loss, throw an error listing each store file and each lost scenario name with
  a hint naming `--accept-removed-scenarios` and the `features/.deleted`
  tombstone. Add an `acceptRemovedScenarios?: boolean` option that bypasses the
  guard. Under `dryRun` the guard does **not** throw and does not write;
  instead the lost scenarios are returned per file in a new `lostScenarios`
  field on `FeaturesApplyOutput` (`{ file, names }[]`).
- `src/core/archive.ts`: thread `acceptRemovedScenarios` from command options
  into `applyFeatures`; a guard refusal aborts the archive (store untouched,
  change not moved) even under `-y`.
- `src/cli/index.ts`: new `--accept-removed-scenarios` flag on `ratchet archive`.
- Tests: new `test/core/features-apply-scenario-guard.test.ts` (unit: lost /
  kept / renamed / tombstoned / flag / under `-y`), ArchiveCommand tmpdir
  integration tests in `test/core/archive.test.ts`, and new
  `test/cli-e2e/scenario-safe-archive.test.ts` (refuse → accept flow).
- Docs: `docs/commands/archive.md` (option row, guard behavior, exit behavior)
  and `README.md` archive flag mention.
- Implements `features/feature-store/scenario-loss-guard.feature` and the new
  scenarios in `features/archive-change/archive.feature` (authored as a
  superset of the current store file so this change passes its own guard).

Sibling behaviors in the phase are separate batch changes by approved
decomposition, not part of this one: archive-skill retry flow
(`archive-skill-accept-flow`), propose store-seeding text
(`propose-store-seeded-features`), and batch-archive halt
(`archive-batch-guard-halt`).

## Design

- **Reuse the one Gherkin parser.** `GherkinParser.parseFeature()` already
  yields `scenarios[].name` (trimmed) for `Scenario` and `Scenario Outline`
  alike. A small pure helper in `features-apply.ts` diffs name sets per file:
  `lost = storeNames − changeNames`. No new parsing dependency.
- **Refuse before writing.** The guard runs in `applyFeatures` after
  `findFeatureUpdates` + `readTombstones` and before the first copy/delete, so
  a refusal leaves the store byte-for-byte untouched (atomic-by-ordering).
- **Check only true overwrites.** A file is guarded only when it exists in the
  store, differs byte-for-byte, and is not listed in the change's
  `features/.deleted` tombstone — the tombstone is the intentional
  whole-file-removal route. Adds and byte-identical files skip the check.
- **Throw to refuse.** In a non-dryRun call the guard throws one `Error` whose
  message groups every lost scenario under its store-relative file and points
  at `--accept-removed-scenarios` / `.deleted`; the existing CLI catch prints
  it and exits 1, so refusal is non-zero by construction and independent of
  `-y` or interactive confirms (no prompt path can approve a loss — only the
  explicit flag or a tombstone).
- **Dry-run reports instead of throwing.** With `options.dryRun` the guard
  never throws and nothing is written (already true of dry-run copies); the
  same per-file losses are returned on `FeaturesApplyOutput.lostScenarios` as
  `{ file, names }[]` so callers can preview a loss. A non-dryRun call over the
  same inputs throws.
- **Concurrent changes fall out of the same check.** Because the diff runs
  against the live store at archive time, a second change whose file lacks the
  first change's just-archived scenarios trips the guard with no extra
  machinery.
- **Coverage per the testing standard.** The name-diff helper and guard
  branches are proven at the unit layer over tmpdir fixture repos; the
  ArchiveCommand wiring (including `-y` non-bypass) at the integration layer;
  only the user-visible refuse → accept flow goes E2E through the built CLI.

## Tasks

- [x] 1.1 Add a scenario-name-diff helper in `src/core/features-apply.ts` that parses both versions of a file with `GherkinParser` and returns the store scenario names missing from the change version
- [x] 1.2 Wire the guard into `applyFeatures`: check every overwritten, non-tombstoned file before any store write. A non-dryRun call throws one error listing each file and lost scenario name (message names `--accept-removed-scenarios` and the `features/.deleted` tombstone); a `dryRun` call does NOT throw and does not write — it returns the lost scenarios per file in a new `lostScenarios: { file, names }[]` field on `FeaturesApplyOutput`. Add the `acceptRemovedScenarios` option that skips the check
- [x] 1.3 Thread `acceptRemovedScenarios` through `ArchiveCommand.execute` options and add the `--accept-removed-scenarios` flag to `ratchet archive` in `src/cli/index.ts`, updating both the inline `options` type in the `.action(...)` signature and the flag's help text
- [x] 2.1 Create `test/core/features-apply-scenario-guard.test.ts` (mirrors `features/feature-store/scenario-loss-guard.feature`): lost scenario refused with names listed and store untouched, kept/superset applied, rename reported as loss, Scenario Outline names compared, losses across multiple files all listed, tombstoned file skipped, `acceptRemovedScenarios` applies, ArchiveCommand under `{ yes: true }` still refuses, and dryRun reports losses on `lostScenarios` without throwing and leaves the store byte-for-byte untouched. Name-parsing robustness: `Scenario Outline` and `Scenario Template` names compared, commented-out `Scenario:` lines ignored, tag lines above scenarios not treated as part of the name, and the per-file lost list is duplicate-free even when the store file repeats a name
- [x] 2.2 Extend `test/core/archive.test.ts` (mirrors `features/archive-change/archive.feature`): ArchiveCommand over a tmpdir refuses by default (store untouched, change not moved), accepts with the flag, archives a fresh capability and a superset file normally, and refuses the concurrent-change case — change B overwrites the store file change A just archived, without A's scenarios (mirrors "A second change overwriting the same store file without the first's scenarios is refused")
- [x] 2.3 Create `test/cli-e2e/scenario-safe-archive.test.ts`: the built CLI exits non-zero naming the lost scenario on a dropping archive, then succeeds on re-run with `--accept-removed-scenarios` (run `pnpm run build` first per test/AGENTS.md)
- [x] 3.1 Documentation (per the `documentation` standard): update `docs/commands/archive.md` — option-table row for `--accept-removed-scenarios`, a scenario-loss-guard behavior subsection under the feature-store-update step, and an exit-behavior bullet — and update `README.md` where it lists archive options/behavior
- [x] 3.2 Run the full suite AND the coverage run — `pnpm test` and `pnpm test:coverage` (95% line floor per the testing standard) — and confirm the phase proof-of-work command passes: the two greps plus `pnpm vitest run test/core/features-apply-scenario-guard.test.ts test/cli-e2e/scenario-safe-archive.test.ts`
