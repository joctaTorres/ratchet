Feature: Gated dry-run publish wired into the CI workflow
  As a maintainer of the ratchet package
  I want the CI workflow to consult the release-decision module behind a main-only gate before exercising the publish path
  So that the full publish pipeline is run end to end as a safe dry-run — reachable only on a green main build, never as a real release

  Background:
    Given the repository defines a workflow at ".github/workflows/ci.yml"
    And the workflow is parsed into its triggers, jobs, and ordered steps

  Scenario: The install -> lint -> test spine is preserved ahead of the release path
    Given the workflow at ".github/workflows/ci.yml" is parsed into its triggers, jobs, and ordered steps
    When I inspect the CI job's steps
    Then it installs dependencies
    And it runs the linter after installing dependencies
    And it runs the test suite after running the linter
    And every release-path step appears after the test step

  Scenario: A main-only release-gate step is wired after the green spine
    Given the workflow at ".github/workflows/ci.yml" is parsed into its triggers, jobs, and ordered steps
    When I inspect the CI job's steps
    Then there is a release-gate step after the install -> lint -> test spine
    And the release-gate step is conditioned to run only on the "main" branch
    And the release-gate step consults the release-decision module

  Scenario: The publish step runs as a dry-run after the release gate
    Given the workflow at ".github/workflows/ci.yml" is parsed into its triggers, jobs, and ordered steps
    When I inspect the CI job's steps
    Then there is a step that runs "npm publish --dry-run"
    And the dry-run publish step appears after the release-gate step
    And the dry-run publish step is conditioned to run only on the "main" branch

  Scenario: The workflow never performs a real publish
    Given the workflow at ".github/workflows/ci.yml" is parsed into its triggers, jobs, and ordered steps
    When I inspect every step's command in the CI job
    Then no step runs a bare "npm publish" without the "--dry-run" flag
    And no npm auth token is required for the publish path

  Scenario: The release path is unreachable while lint or test is red
    Given the workflow at ".github/workflows/ci.yml" is parsed into its triggers, jobs, and ordered steps
    When I inspect the ordering of the CI job
    Then both the release-gate step and the dry-run publish step sit after the lint and test steps
    And neither the release-gate nor the dry-run publish step appears before the lint or test step
