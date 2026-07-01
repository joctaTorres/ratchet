Feature: CI quality-gate workflow
  As a maintainer of the ratchet package
  I want a GitHub Actions workflow that installs deps, lints, and tests on every push and pull request
  So that a broken lint or test turns the run red and blocks the release path before anything ships

  Background:
    Given the repository defines a workflow at ".github/workflows/ci.yml"
    And the workflow is parsed into its triggers, jobs, and ordered steps

  Scenario: The workflow triggers on push and on pull_request
    Given the workflow at ".github/workflows/ci.yml" is parsed into its triggers, jobs, and ordered steps
    When I inspect the workflow triggers
    Then the workflow runs on "push"
    And the workflow runs on "pull_request"

  Scenario: The job runs install, then lint, then test in that order
    Given the workflow at ".github/workflows/ci.yml" is parsed into its triggers, jobs, and ordered steps
    When I inspect the CI job's steps
    Then the job checks out the repository before running any package steps
    And it installs dependencies
    And it runs the linter after installing dependencies
    And it runs the test suite after running the linter
    And the install, lint, and test steps appear in that relative order

  Scenario: A failing lint turns the run red and blocks the release path
    Given the lint step is reached
    When the linter exits non-zero
    Then the workflow run is marked red
    And no step on the release path runs after the failed lint step

  Scenario: A failing test turns the run red and blocks the release path
    Given the lint step passes
    And the test step is reached
    When the test suite exits non-zero
    Then the workflow run is marked red
    And no step on the release path runs after the failed test step

  Scenario: The release path is positioned after the green install -> lint -> test spine
    Given the workflow at ".github/workflows/ci.yml" is parsed into its triggers, jobs, and ordered steps
    When I inspect the ordering of the CI job
    Then any release-path step is wired to run only after install, lint, and test have all succeeded
    And the release path is never reached while lint or test is red
