Feature: CI runs a dependency audit and goes red on a vulnerability
  As a maintainer of the ratchet package
  I want CI to run a dependency vulnerability audit as its own red/green step
  So that a known-vulnerable dependency turns the run red before the release path is ever consulted

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
