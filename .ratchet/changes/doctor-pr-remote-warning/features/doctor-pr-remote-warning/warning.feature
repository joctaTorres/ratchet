Feature: Doctor warns when PR grouping is active but no git remote is configured
  As a ratchet user who has enabled PR grouping
  I want `ratchet doctor` to warn me when my repo has no configured git remote
  So that I discover the missing remote before a completed batch tries to push and open a PR

  Background:
    Given a ratchet project whose doctor runs its checks against the project root

  Scenario: Active PR grouping with no configured git remote emits an advisory warning
    Given the project resolves `prGrouping` to `whole-batch`
    And the repo has no configured git remote
    When `ratchet doctor` runs
    Then the report includes a `pr-remote` check
    And that check has status `info` and severity `optional`
    And its detail explains that `prGrouping` is active but the repo has no git remote to push to
    And its remedy tells the user to configure a git remote, naming no forge-specific CLI

  Scenario: The PR-remote warning never fails doctor
    Given the project resolves `prGrouping` to `whole-batch`
    And the repo has no configured git remote
    When `ratchet doctor` runs
    Then the report `ok` flag stays true
    And the process exit code is `0`

  Scenario: Doctor stays silent when PR grouping is off (the default)
    Given the project resolves `prGrouping` to `off`
    And the repo has no configured git remote
    When `ratchet doctor` runs
    Then the report includes no `pr-remote` check at all

  Scenario: Doctor stays silent when a git remote is configured
    Given the project resolves `prGrouping` to `whole-batch`
    And the repo has a configured git remote
    When `ratchet doctor` runs
    Then the report includes no `pr-remote` check at all
