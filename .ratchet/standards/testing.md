---
tag: testing
---

# Testing strategy

> Concern: testing

## Intent

Ratchet is held to one explicit, ratchetable testing strategy so every change
knows what to test, where, and to what bar. Tests follow a pyramid weighted
toward fast unit coverage of pure logic, line coverage is held to a 95% minimum
floor, and tests are isolated and reproducible through a shared fixture and
end-to-end pattern. This standard exists so coverage and test discipline can only
ratchet upward, never silently regress.

## Guidelines

- **Follow the test pyramid.** Weight the suite toward many fast **unit** tests
  over pure logic, fewer **integration** tests over command/core wiring, and a
  thin **E2E** layer over the CLI surface. Most behavior must be provable at the
  unit level; reserve the slower, broader layers for the wiring and the
  user-visible surface they alone can exercise. Never push a check up the pyramid
  (to integration or E2E) when it can be proven at the unit level.
- **Test the right thing at the right layer.**
  - **Unit** — pure evaluators, policies, and utilities (deterministic functions
    over in-memory inputs) get unit tests with no filesystem or process spawn.
  - **Integration** — command verbs and core orchestration (`src/commands/`,
    `src/core/`) get integration tests that wire the real pieces together over a
    tmpdir fixture repo.
  - **E2E** — user-visible CLI flows get end-to-end tests under `test/cli-e2e/`
    that drive the built CLI and assert on observable output and exit codes.
- **Hold a 95% minimum line-coverage floor.** The standard's coverage bar is
  **95% line coverage**, measured by the project's coverage run over the whole
  codebase. The enforced `COVERAGE_THRESHOLD` gate is ratcheted up toward this
  floor phase by phase — the enforced threshold is raised as coverage is added
  and is never lowered. 95% is the target the gate climbs to; it is the bar a
  fully-covered codebase meets, not an aspiration.
- **Isolate every test that touches the filesystem with the fixture pattern.** A
  test that needs a repo builds an isolated one under
  `fs.mkdtemp(os.tmpdir())`, writes only the minimal `.ratchet/` tree it
  exercises, and removes it in `afterEach`. Tests must not depend on the real
  repository, on each other, or on execution order, and must leave no artifacts
  behind.
- **Mirror the `.feature` in the test header.** A test that implements a
  Scenario names the corresponding `.feature` in its file header so the behavior
  contract a test proves is traceable, matching the conventions already used
  across `test/core/`.
- **Drive the built CLI in E2E tests.** End-to-end tests run the compiled CLI
  end-to-end and assert on its observable output and exit codes — never on
  internal state. They live under `test/cli-e2e/` and exist to prove the
  user-facing surface, not to re-test logic already covered by unit tests.
- **A change is not done until its tests are.** New or changed behavior ships
  with tests at the correct pyramid layer in the same change, and the full suite
  and the coverage gate must be green. A change that lowers coverage below the
  enforced threshold, or omits tests for behavior it adds, does not satisfy this
  standard.

## Applies to

Every change that adds or modifies behavior in this repository — pure
evaluators/policies/utilities, command verbs (`src/commands/`), core
orchestration (`src/core/`), and user-visible CLI flows. Each such change must
add or update tests at the correct pyramid layer, keep tests isolated via the
fixture pattern, and keep the full suite and the coverage gate green at or above
the enforced `COVERAGE_THRESHOLD`.

## Implemented by

<!-- ratchet:implemented-by — generated from .ratchet/features/<capability>/.ratchet.yaml; do not edit by hand -->

- batch-command-tests/apply.feature
- batch-command-tests/config.feature
- batch-command-tests/new-batch.feature
- batch-command-tests/report.feature
- batch-command-tests/status.feature
- batch-command-tests/view.feature
- commands-core-verbs/apply.feature
- commands-core-verbs/coverage-floor.feature
- commands-core-verbs/propose.feature
- commands-core-verbs/validate.feature
- commands-core-verbs/verify.feature
- core-remainder-tests/archive.feature
- core-remainder-tests/features-apply.feature
- core-remainder-tests/file-system.feature
- core-remainder-tests/init-update-remainders.feature
- core-remainder-tests/list.feature
- core-remainder-tests/markdown-parser.feature
- core-remainder-tests/move-directory.feature
- core-remainder-tests/proof-of-work.feature
- core-remainder-tests/version-guard.feature
- core-util-tests/change-status-policy.feature
- core-util-tests/config-schema.feature
- core-util-tests/migration.feature
- coverage-gate/documented-floor-80.feature
- coverage-gate/documented-knob.feature
- coverage-gate/floor-to-80.feature
- coverage-gate/ratchetable-threshold.feature
- eval-command-tests/baseline.feature
- eval-command-tests/record.feature
- eval-command-tests/report.feature
- eval-command-tests/run.feature
- eval-command-tests/set.feature
- eval-command-tests/shared.feature
