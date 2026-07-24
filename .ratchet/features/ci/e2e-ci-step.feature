Feature: CI runs the e2e CLI smoke and goes red when it fails
  As a maintainer of the ratchet package
  I want CI to build the CLI and run the e2e smoke against it as its own red/green step
  So that an end-to-end CLI regression turns the run red before the release path is ever consulted

  Background:
    Given the repository defines a workflow at ".github/workflows/ci.yml"
    And the workflow is parsed into its triggers, jobs, and ordered steps

  Scenario: CI builds the CLI and runs the e2e smoke against the built binary
    Given the workflow at ".github/workflows/ci.yml" is parsed into its ordered steps
    When I inspect the CI job's steps
    Then a step builds the package so `dist/` and `bin/ratchet.js` are runnable
    And a step runs the e2e CLI smoke against the built binary

  Scenario: An e2e-gate step enforces the smoke result and goes red on failure
    Given the workflow at ".github/workflows/ci.yml" is parsed into its ordered steps
    When I inspect the CI job's steps
    Then an e2e-gate step invokes the e2e evaluator against the smoke's machine-readable result
    And the e2e-gate step appears after the test step
    And a failed smoke check makes that step exit non-zero and the run red

  Scenario: E2e enforcement does not yet touch the release path
    Given the workflow at ".github/workflows/ci.yml" is parsed into its ordered steps
    When I inspect the CI job's steps
    Then the e2e-gate step does not add a GATE_E2E signal to the release-gate step in this change
    And the release path still wires only the lint and test signals
