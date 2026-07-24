Feature: CI runs a secret scan and goes red on a leaked secret
  As a maintainer of the ratchet package
  I want CI to run a secret scan as its own red/green step
  So that a planted or leaked secret turns the run red before the release path is ever consulted

  Background:
    Given the repository defines a workflow at ".github/workflows/ci.yml"
    And the workflow is parsed into its triggers, jobs, and ordered steps

  Scenario: CI runs a secret scan and produces a machine-readable report
    Given the workflow at ".github/workflows/ci.yml" is parsed into its ordered steps
    When I inspect the CI job's steps
    Then a step runs the secret scan
    And the scan writes a machine-readable JSON report the evaluator can read

  Scenario: A secret-scan-gate step enforces the result and goes red on a finding
    Given the workflow at ".github/workflows/ci.yml" is parsed into its ordered steps
    When I inspect the CI job's steps
    Then a secret-scan-gate step invokes the secret-scan evaluator against the scan report
    And the secret-scan-gate step appears after the test step
    And a finding makes that step exit non-zero and the run red

  Scenario: Secret-scan enforcement does not yet touch the release path
    Given the workflow at ".github/workflows/ci.yml" is parsed into its ordered steps
    When I inspect the CI job's steps
    Then the secret-scan-gate step does not add a security signal to the release-gate step in this change
    And the release path still wires only the lint, test, coverage, and e2e signals
