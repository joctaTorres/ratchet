Feature: CI measures coverage and enforces the threshold
  As a maintainer of the ratchet package
  I want CI to run the test suite with coverage and enforce a minimum threshold as its own red/green step
  So that a coverage regression turns the run red before the release path is ever consulted

  # The pure evaluator (coverage-gate.feature) needs real numbers to act on. This
  # feature pins the CI wiring that produces them: a coverage run that writes a
  # machine-readable summary, plus a coverage-gate step that feeds that summary to
  # the evaluator and exits non-zero when coverage is below the threshold.
  #
  # Structure is asserted against the parsed workflow model the prior phase's
  # parser helper exposes (steps matched by their `run`/`uses` substrings, robust
  # to cosmetic renames). The coverage step sits AFTER the test step and does NOT
  # touch the release path — wiring the coverage signal into the release-decision
  # module is the separate `wire-coverage-e2e-into-release-gate` change.

  Background:
    Given the repository defines a workflow at ".github/workflows/ci.yml"
    And the workflow is parsed into its triggers, jobs, and ordered steps

  Scenario: The CI job runs coverage and produces a machine-readable summary
    Given the workflow at ".github/workflows/ci.yml" is parsed into its ordered steps
    When I inspect the CI job's steps
    Then a step runs the test suite with coverage collection enabled
    And the coverage configuration emits a json-summary report the evaluator can read

  Scenario: A coverage-gate step enforces the threshold and goes red below it
    Given the workflow at ".github/workflows/ci.yml" is parsed into its ordered steps
    When I inspect the CI job's steps
    Then a coverage-gate step invokes the coverage evaluator against the emitted summary
    And the coverage-gate step appears after the test step
    And a coverage total below the threshold makes that step exit non-zero and the run red

  Scenario: Coverage enforcement does not yet touch the release path
    Given the workflow at ".github/workflows/ci.yml" is parsed into its ordered steps
    When I inspect the CI job's steps
    Then the coverage-gate step does not add a GATE_COVERAGE signal to the release-gate step in this change
    And the release path still wires only the lint and test signals
