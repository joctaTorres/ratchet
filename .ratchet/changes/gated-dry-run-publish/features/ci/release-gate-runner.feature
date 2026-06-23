Feature: Release-gate runner — the workflow's bridge to the release-decision module
  As the CI workflow
  I want a small, shippable entrypoint that gathers the branch and the wired gate signals and asks the release-decision module for a verdict
  So that the main-only gate step in `ci.yml` blocks the dry-run publish on a DENY and lets it proceed only on a green main build — provably, not by hand-rolled YAML conditions

  Background:
    Given a release-gate runner that reads the branch and the "lint" and "test" gate signals from its environment
    And the runner consults the release-decision module to decide ALLOW or DENY

  Scenario: Allows the publish path on a green main build
    Given the branch is "main"
    And the "lint" signal is green
    And the "test" signal is green
    When the release-gate runner runs
    Then it reports ALLOW
    And it exits zero so the dry-run publish step proceeds

  Scenario: Denies the publish path on a non-main branch
    Given the branch is "feature/widget"
    And the "lint" signal is green
    And the "test" signal is green
    When the release-gate runner runs
    Then it reports DENY
    And it exits non-zero so the dry-run publish step is blocked
    And it prints that the branch is not "main"

  Scenario: Denies the publish path when a wired gate is red
    Given the branch is "main"
    And the "lint" signal is green
    And the "test" signal is red
    When the release-gate runner runs
    Then it reports DENY
    And it exits non-zero so the dry-run publish step is blocked
    And it prints that the "test" gate is not green

  Scenario: Is fail-closed when a wired gate signal is missing
    Given the branch is "main"
    And the "lint" signal is green
    And the "test" signal is absent from the environment
    When the release-gate runner runs
    Then it reports DENY
    And it exits non-zero so the dry-run publish step is blocked
