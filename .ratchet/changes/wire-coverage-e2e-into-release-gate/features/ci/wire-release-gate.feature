Feature: Wire coverage + e2e into the release-decision gate
  As a maintainer of the ratchet package
  I want the coverage and e2e signals plugged into the release-decision spine
  So that a coverage drop or a broken end-to-end run provably flips the release gate to DENY — still dry-run, nothing published

  # This is the wiring slice of the "coverage + e2e gates" phase. The two prior
  # `after` changes already PRODUCE the signals in the exact `GateSignal` shape
  # the release-decision module keys its gates by: `coverage-threshold-gate`
  # (src/core/ci/coverage-gate.ts) and `e2e-cli-smoke` (src/core/ci/e2e-gate.ts).
  # Neither wired its signal into the decision — by design. This change is that
  # wiring and nothing more.
  #
  # The release-decision module is intentionally data-driven: its wired-gate set
  # is the keys of the `gates` record, not hardcoded branching. So wiring is a
  # data change — adding `coverage` and `e2e` to the release-gate runner's
  # WIRED_GATES and feeding `GATE_COVERAGE` / `GATE_E2E` into the workflow's
  # release-gate step — with NO change to `decideRelease`'s core logic.
  #
  # Fail-closed is preserved: a missing or non-green coverage/e2e signal denies,
  # exactly as lint/test already do. The publish path stays `npm publish
  # --dry-run` — this phase proves the gate, it does not ship a real release.

  Background:
    Given the release-decision module decides ALLOW only when the branch is "main" and every wired gate is green
    And the coverage gate produces a green/red signal in the release-decision GateSignal shape
    And the e2e gate produces a green/red signal in the release-decision GateSignal shape

  Scenario: The release gate now wires coverage and e2e alongside lint and test
    Given the release-gate runner's set of wired gates
    When the wired-gate set is inspected
    Then it includes "lint" and "test"
    And it also includes "coverage" and "e2e"

  Scenario: ALLOW on main only when lint, test, coverage, and e2e are all green
    Given the build is on the "main" branch
    And the lint signal is "green"
    And the test signal is "green"
    And the coverage signal is "green"
    And the e2e signal is "green"
    When the release gate runs
    Then the outcome is ALLOW
    And the publish path runs as a dry-run

  Scenario: A coverage drop flips the gate to DENY
    Given the build is on the "main" branch
    And the lint signal is "green"
    And the test signal is "green"
    And the coverage signal is "red"
    And the e2e signal is "green"
    When the release gate runs
    Then the outcome is DENY
    And the reasons include that the "coverage" gate is not green
    And the dry-run publish path does not run

  Scenario: A failing e2e run flips the gate to DENY
    Given the build is on the "main" branch
    And the lint signal is "green"
    And the test signal is "green"
    And the coverage signal is "green"
    And the e2e signal is "red"
    When the release gate runs
    Then the outcome is DENY
    And the reasons include that the "e2e" gate is not green
    And the dry-run publish path does not run

  Scenario: Fail-closed when a coverage or e2e signal is missing
    Given the build is on the "main" branch
    And the lint signal is "green"
    And the test signal is "green"
    And no coverage signal is provided
    And no e2e signal is provided
    When the release gate runs
    Then the outcome is DENY
    And the reasons include that the "coverage" gate is not green
    And the reasons include that the "e2e" gate is not green

  Scenario: The workflow feeds the coverage and e2e step outcomes into the release-gate step
    Given the CI workflow's release-gate step environment
    When the release-gate step environment is inspected
    Then it sets GATE_COVERAGE from the coverage step outcome
    And it sets GATE_E2E from the e2e step outcome
    And both are fail-closed to "red" when their step did not succeed
    And the publish step remains "npm publish --dry-run"
