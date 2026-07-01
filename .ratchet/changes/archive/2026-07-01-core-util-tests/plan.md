# core-util-tests

## Why

The `core-utilities-coverage` phase lifts the enforced coverage floor toward
~87% by covering the untested core utilities. Three of those targets are owned
by this change: `src/core/migration.ts` (one-time profile migration, ~131L,
no direct coverage), `src/core/change-status-policy.ts` (repo-local planning
policy, pure), and the config-schema helpers (pure key-path / nested-value /
coercion / YAML / schema-validation utilities). The first touches the
filesystem and the cached global config; the other two are pure deterministic
logic. With the `testing` standard now codified, this change adds unit tests at
the correct pyramid layer for all three and keeps the full suite green,
contributing the coverage that the separate `ratchet-floor-to-87` change later
ratchets the enforced floor up to.

> Path note: the manifest lists the third target as `core/shared/config-schema.ts`,
> but the file actually lives at `src/core/config-schema.ts`. This change covers
> the real file at that path.

## What Changes

- Add `test/core/config-schema.test.ts` — **unit** tests for the pure helpers in
  `src/core/config-schema.ts`, implementing
  `features/core-util-tests/config-schema.feature`. No filesystem, no spawn.
  Covers: `validateConfig` (success on known + passthrough fields, failure with a
  path-qualified message on a bad enum), `validateConfigKeyPath` (known vs
  unknown root, empty segment, `featureFlags` one-level-only, non-`featureFlags`
  no-nesting), `getNestedValue`/`setNestedValue`/`deleteNestedValue` (hit, miss,
  intermediate creation/overwrite, delete true/false without mutation),
  `coerceValue` (boolean / number / string / blank / `forceString`), and
  `formatValueYaml` (scalars, empty `[]`/`{}`, nested list and object indentation).
- Add `test/core/change-status-policy.test.ts` — **unit** tests for the pure
  policy functions in `src/core/change-status-policy.ts`, implementing
  `features/core-util-tests/change-status-policy.feature`. Covers
  `summarizePlanningHome` (projection + undefined passthrough),
  `summarizeAffectedAreas` (always undefined), `buildActionContext` (repo-local
  shape, artifact ids as planning artifacts, project root as sole edit root,
  constraint and no-affected-area flags), and `buildNextSteps` (ready-artifact
  step, all-complete step, empty list when nothing ready and work remains).
- Add `test/core/migration.test.ts` — fixture-isolated tests for
  `src/core/migration.ts`, implementing `features/core-util-tests/migration.feature`.
  Builds an isolated project tree under `fs.mkdtemp(os.tmpdir())` and an isolated
  global-config dir pointed at by `XDG_CONFIG_HOME`, tears both down and resets
  the global-config cache in `afterEach`. Covers `scanInstalledWorkflows`
  (empty, skills-installed, commands-installed) and `migrateIfNeeded`
  (profile-already-set no-op, no-workflows no-op, custom-profile migration,
  delivery inference for skills/commands/both with an existing `delivery`
  preserved, and the unreadable/malformed-config silent skip).
- No production behavior changes — this change ships tests only. Per the
  `testing` standard this still counts as a change "not done until its tests
  are"; because it adds no user-facing surface, the `documentation` standard does
  not apply and no documentation task is required.

## Design

**Layer (per the `testing` standard — test the right thing at the right layer).**
`config-schema.ts` and `change-status-policy.ts` are pure
evaluators/utilities over in-memory inputs, so they get **unit** tests with no
filesystem and no process spawn — never pushed up the pyramid. `migration.ts`
reads the project tree and the global config and writes the global config, so it
gets tests isolated with the **fixture pattern**: the one thing that must not
leak (the developer's real global config and the real repo) is replaced by
tmpdirs, while the migration's own scan/no-op/migrate logic runs unmocked.

**Fixture isolation for `migration.ts` (per the `testing` standard).** The
global config path is resolved from `XDG_CONFIG_HOME` (see
`test/core/global-config.test.ts`), so each scenario sets `XDG_CONFIG_HOME` to a
fresh `fs.mkdtemp(os.tmpdir())` dir and builds the project under a second
tmpdir, writing only the minimal artifacts a scenario exercises — a workflow's
`SKILL.md` under a tool's `skillsDir/skills/<dir>/` for the skills path, and the
adapter's command file path for the commands path (resolved through
`CommandAdapterRegistry`). The global-config module caches its parsed config, so
`afterEach` restores `process.env` and resets that cache (mirroring how
`global-config.test.ts` manages `XDG_CONFIG_HOME` and the cache) and removes both
tmpdirs. Tests depend on no real repo state, on each other, or on execution
order, and leave nothing behind.

**Seams.** The migration tests drive the public entry points (`scanInstalledWorkflows`,
`migrateIfNeeded`) over the fixture rather than mocking `fs` — the real scan runs
against the real tmpdir tree, and the real `getGlobalConfig`/`saveGlobalConfig`
read and write the tmpdir config, so the assertions are over observable config
file state and the returned workflow lists. `console.log` from the migrate path
is allowed (or silenced) but not asserted on.

**Traceability (per the `testing` standard — mirror the `.feature` in the
header).** Each test file names its corresponding `.feature` in the header,
matching the conventions across `test/core/`:
- `test/core/config-schema.test.ts` → `config-schema.feature`
- `test/core/change-status-policy.test.ts` → `change-status-policy.feature`
- `test/core/migration.test.ts` → `migration.feature`

**Done bar.** The three new test files cover each target's main behaviors and key
branches, and the full vitest suite stays green. The phase's enforced
coverage-floor lift to ~87 is owned by the separate `ratchet-floor-to-87` change;
this change's contribution is the three targets' branch coverage and a green
suite.

## Tasks

- [x] 1.1 Write `test/core/config-schema.test.ts` implementing
  `config-schema.feature` as **unit** tests (no filesystem, no spawn): cover
  `validateConfig` success/failure, `validateConfigKeyPath` (known/unknown root,
  empty segment, `featureFlags` one-level-only, non-`featureFlags` no-nesting),
  `getNestedValue`/`setNestedValue`/`deleteNestedValue` (hit/miss/intermediate
  create+overwrite/delete-true/delete-false-no-mutation), `coerceValue`
  (boolean/number/string/blank/`forceString`), and `formatValueYaml`
  (scalars/empty collections/nested list+object indentation), with the
  `.feature` named in the header.
- [x] 1.2 Write `test/core/change-status-policy.test.ts` implementing
  `change-status-policy.feature` as **unit** tests: cover
  `summarizePlanningHome` (projection + undefined), `summarizeAffectedAreas`
  (undefined), `buildActionContext` (repo-local shape, planning artifacts,
  allowed edit root, flags + constraint), and `buildNextSteps`
  (ready/all-complete/empty), with the `.feature` named in the header.
- [x] 1.3 Write `test/core/migration.test.ts` implementing `migration.feature`
  with **fixture isolation**: a helper builds an isolated project tree under
  `fs.mkdtemp(os.tmpdir())` and an isolated global-config dir via
  `XDG_CONFIG_HOME`, and `afterEach` removes both, restores `process.env`, and
  resets the global-config cache. Cover `scanInstalledWorkflows`
  (empty/skills/commands) and `migrateIfNeeded` (profile-set no-op,
  no-workflows no-op, custom-profile migration, delivery inference
  skills/commands/both with existing `delivery` preserved, malformed-config
  silent skip), with the `.feature` named in the header.
- [x] 2.1 Run `pnpm build && pnpm vitest run --coverage` and confirm the full
  suite is green with the three new core-utility test files included.
