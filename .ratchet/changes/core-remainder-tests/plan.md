# core-remainder-tests

## Why

Phase `cli-and-large-files-to-95` lifts total line coverage to the 95% target.
With the CLI entrypoint, `validate`, and the UI/telemetry surfaces covered by
sibling changes, a "core remainder" of partly-covered files still holds back the
total: `core/archive.ts` (62%), `ci/version-guard.ts` (67%),
`utils/move-directory.ts` (25%), `batch/engine/proof-of-work.ts` (78%),
`parsers/markdown-parser.ts` (79%), `core/list.ts` (85%), `utils/file-system.ts`
(87%), and the small remainders of `init.ts`/`update.ts`/`features-apply.ts`
(~90%+). Covering this remainder closes the last gap so the downstream
`ratchet-floor-to-95` change can lock the enforced floor at 95.

## What Changes

This is a **tests-only** change — no production code is modified. It adds or
extends unit/integration tests covering the uncovered branches of the core
remainder files, per the `testing` standard. It implements these feature files:

- `features/core-remainder-tests/move-directory.feature` — rename fast-path,
  EPERM/EXDEV copy-then-remove fallback, rethrow, recursive copy.
- `features/core-remainder-tests/proof-of-work.feature` — `evaluatePassCondition`
  branches (default substring, contains-unmet, invalid regex) and `runProofOfWork`
  error/judge/gating paths.
- `features/core-remainder-tests/version-guard.feature` — env-override vs
  registry, fail-safe SKIP on registry error, `writeShouldPublishOutput`, E404
  and bare-string normalization.
- `features/core-remainder-tests/markdown-parser.feature` — code-fence masking
  (backtick/tilde, fence-length, unclosed), nested sections, CRLF normalization.
- `features/core-remainder-tests/file-system.feature` — `removeMarkerBlock` edge
  cases and `canWriteFile` on a non-writable path.
- `features/core-remainder-tests/list.feature` — specs mode, empty store, JSON
  output, name sort, empty changes set.
- `features/core-remainder-tests/archive.feature` — validation gating,
  confirmations, skip-features, standards-link materialization, already-exists.
- `features/core-remainder-tests/init-update-remainders.feature` — tool
  validation errors and legacy-cleanup decision branches.
- `features/core-remainder-tests/features-apply.feature` — sidecar read/write
  remainder (malformed yaml, drop-when-empty, filtering, sort/unique).

Per the `testing` standard, a tests-only change ships no user-facing surface, so
no `/docs` or README update is part of this change (the documentation standard is
scoped to behavior changes, not test additions).

## Design

**Right layer per the test pyramid.** Pure logic gets fast **unit** tests with no
filesystem or process spawn: `proof-of-work.ts` (inject fake `BashRunner` /
`LlmJudge`), `version-guard.ts` (inject the `PublishedVersionsFetcher` seam so no
test hits npm/network; drive `writeShouldPublishOutput` against a scratch
`GITHUB_OUTPUT`), `markdown-parser.ts` (in-memory strings), and the
string helpers in `file-system.ts` (`removeMarkerBlock`). Command/core
orchestration gets **integration** tests over a tmpdir fixture repo:
`archive.ts`, `list.ts`, the `init.ts`/`update.ts` remainders, and the
`features-apply.ts` sidecar paths.

**Fixture isolation.** Every filesystem-touching test builds its own
`.ratchet/` tree under `fs.mkdtemp(os.tmpdir())`, writes only the minimal tree it
exercises, and removes it in `afterEach`. No test depends on the real repo, on
another test, or on execution order. Interactive prompts (`@inquirer/prompts`
confirm/select, `searchableMultiSelect`) are driven through injected/stubbed
answers rather than a live TTY.

**Mirror the `.feature` in the header.** Each new test file names the
corresponding `.feature` in its header, matching the convention already used
across `test/core/`. New tests sit beside the existing ones
(`test/core/`, `test/ci/`, `test/utils/`, `test/batch-engine/`,
`test/core/parsers/`) and add new files only where none exists yet
(`move-directory`, and `markdown-parser` if absent).

**Targeted at measured gaps.** Tests aim at the specific uncovered lines
identified from the istanbul report (e.g. `move-directory.ts` is ~25% covered, so
both functions and the fallback branch get covered; `archive.ts` validation/
confirmation branches; `version-guard.ts` fail-safe path). The bar for "done" is
measured `total.lines.pct >= 95` with the full vitest suite green — no production
behavior changes, so existing green tests must stay green.

## Tasks

- [x] 1.1 Add `test/utils/move-directory.test.ts` covering the rename fast-path,
      the EPERM and EXDEV copy-then-remove fallback (inject a failing rename
      seam), the rethrow on other error codes, and nested recursive copy.
- [x] 1.2 Extend the proof-of-work test for `evaluatePassCondition` (default
      substring pass/fail-on-nonzero, `contains:`-unmet, invalid `regex:`) and
      `runProofOfWork` (no-judge fail-closed, thrown judge, judge pass/fail,
      thrown bash, and `warn`-policy gate-pass on failure).
- [x] 1.3 Extend the version-guard test for the env-override path, the
      registry-error fail-safe SKIP (exit 0), a clean fetch, `writeShouldPublishOutput`
      with/without `GITHUB_OUTPUT`, and E404 / bare-string normalization in the
      default fetcher.
- [x] 1.4 Add/extend a markdown-parser test covering fenced-hash masking,
      tilde fences, fence-length closing rules, unclosed fences, nested header
      trees, and CRLF normalization.
- [x] 1.5 Extend the file-system test for `removeMarkerBlock` (own-line removal,
      missing/inverted markers, inline mention ignored, CRLF preservation, empty
      result) and `canWriteFile` on a non-writable path.
- [x] 2.1 Extend the list test for specs mode (grouped-by-capability and empty
      store), changes-mode JSON output, name sort, and the empty changes set.
- [x] 2.2 Extend the archive test for the no-changes-dir and missing-change
      errors, blocking feature-validation, `--yes` with incomplete tasks,
      `--skip-features`, standards-link materialization, the already-exists
      guard, and the skip-validation confirmation decline.
- [x] 2.3 Extend the init/update tests for unknown-tool and no-skills-dir
      validation errors, the interactive legacy-cleanup decline (init cancels;
      update warns/continues), and the empty tool-selection skip.
- [x] 2.4 Extend the features-apply test for the sidecar remainder: malformed
      yaml read as empty, drop-when-empty on write, non-string filtering, and
      sorted/unique link tags.
- [ ] 3.1 Run `pnpm build && pnpm vitest run --coverage`; confirm the full suite
      is green and `total.lines.pct >= 95`, and fill any tail gap needed to clear
      95 (per the feature files and the `testing` standard).
