Feature: Release-decision module — the "only when green" spine
  As a maintainer of the ratchet package
  I want a pure, unit-tested module that decides whether a release is allowed
  So that the publish path is reachable only when the branch is main AND every wired quality gate is green — provably, not by hope

  # The module is the spine of the whole release pipeline. It takes the current
  # branch plus the set of wired gate signals (this phase wires lint + test;
  # later phases plug in coverage, e2e, and security against the SAME shape) and
  # returns a single ALLOW / DENY decision with the reasons for a denial.
  #
  # It is fail-closed: anything other than an explicit green on every wired gate,
  # on branch main, is a DENY. The decision is a pure function of its inputs — no
  # I/O, no git, no clock — so it is exhaustively unit-testable.

  Background:
    Given the release-decision module exposes a pure decide function
    And the wired gate signals for this phase are "lint" and "test"

  Scenario: Denies on a non-main branch even when every gate is green
    Given the current branch is "feature/widget"
    And the "lint" gate is green
    And the "test" gate is green
    When I ask the module whether a release is allowed
    Then the decision is DENY
    And the reasons include that the branch is not "main"

  Scenario: Denies on main when the lint gate is red
    Given the current branch is "main"
    And the "lint" gate is red
    And the "test" gate is green
    When I ask the module whether a release is allowed
    Then the decision is DENY
    And the reasons include that the "lint" gate is not green

  Scenario: Denies on main when the test gate is red
    Given the current branch is "main"
    And the "lint" gate is green
    And the "test" gate is red
    When I ask the module whether a release is allowed
    Then the decision is DENY
    And the reasons include that the "test" gate is not green

  Scenario: Denies on main when both lint and test are red and reports both
    Given the current branch is "main"
    And the "lint" gate is red
    And the "test" gate is red
    When I ask the module whether a release is allowed
    Then the decision is DENY
    And the reasons include that the "lint" gate is not green
    And the reasons include that the "test" gate is not green

  Scenario: Allows only on a green main build
    Given the current branch is "main"
    And the "lint" gate is green
    And the "test" gate is green
    When I ask the module whether a release is allowed
    Then the decision is ALLOW
    And there are no denial reasons

  Scenario: Is fail-closed when a wired gate signal is missing or unknown
    Given the current branch is "main"
    And the "lint" gate is green
    And the "test" gate signal is missing
    When I ask the module whether a release is allowed
    Then the decision is DENY
    And the reasons include that the "test" gate is not green

  Scenario: Is extensible — an additional wired gate must also be green to allow
    Given the current branch is "main"
    And an additional gate "coverage" is wired into the decision
    And the "lint" gate is green
    And the "test" gate is green
    And the "coverage" gate is red
    When I ask the module whether a release is allowed
    Then the decision is DENY
    And the reasons include that the "coverage" gate is not green
