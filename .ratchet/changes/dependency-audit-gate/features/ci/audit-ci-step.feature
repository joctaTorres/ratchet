Feature: CI runs a dependency audit and goes red on a vulnerability
  As a maintainer of the ratchet package
  I want CI to run a dependency vulnerability audit as its own red/green step
  So that a known-vulnerable dependency turns the run red before the release path is ever consulted

  # The pure evaluator (dependency-audit-gate.feature) needs a real audit report
  # to act on. This feature pins the CI wiring that produces it: a step that runs
  # the package manager's vulnerability audit and writes its machine-readable
  # JSON report, plus an audit-gate step that feeds that report to the evaluator
  # and exits non-zero when a vulnerability at or above the threshold is found.
  #
  # Structure is asserted against the parsed workflow model the prior phases'
  # parser helper exposes (steps matched by their `run`/`uses` substrings, robust
  # to cosmetic renames). The audit step sits AFTER the test step and does NOT
  # touch the release path — wiring the security signal into the release-decision
  # module is the separate `wire-security-into-release-gate` change.

  Background:
    Given the repository defines a workflow at ".github/workflows/ci.yml"
    And the workflow is parsed into its triggers, jobs, and ordered steps

  Scenario: CI runs a dependency vulnerability audit and produces a machine-readable report
    Given the workflow at ".github/workflows/ci.yml" is parsed into its ordered steps
    When I inspect the CI job's steps
    Then a step runs the dependency vulnerability audit
    And the audit writes a machine-readable JSON report the evaluator can read

  Scenario: An audit-gate step enforces the threshold and goes red on a vulnerability
    Given the workflow at ".github/workflows/ci.yml" is parsed into its ordered steps
    When I inspect the CI job's steps
    Then an audit-gate step invokes the dependency-audit evaluator against the audit report
    And the audit-gate step appears after the test step
    And a vulnerability at or above the threshold makes that step exit non-zero and the run red

  Scenario: Dependency-audit enforcement does not yet touch the release path
    Given the workflow at ".github/workflows/ci.yml" is parsed into its ordered steps
    When I inspect the CI job's steps
    Then the audit-gate step does not add a security signal to the release-gate step in this change
    And the release path still wires only the lint, test, coverage, and e2e signals
