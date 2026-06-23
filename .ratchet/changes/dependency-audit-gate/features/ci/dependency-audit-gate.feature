Feature: Dependency-audit gate — a green/red signal from a vulnerability audit
  As a maintainer of the ratchet package
  I want a pure, unit-tested evaluator that turns a dependency vulnerability audit into a green/red signal against a configured severity threshold
  So that a known-vulnerable dependency can later block the release — provably, not by hope

  # This is the dependency-audit half of the "security layer" phase. It mirrors
  # the release-decision spine and the sibling coverage/e2e slices: a PURE
  # evaluator (inputs in, signal out) plus a thin runner that adapts the CI
  # environment to it. The evaluator reads a parsed audit report (the per-severity
  # vulnerability counts a package manager's `audit --json` produces) and a
  # configured minimum severity to fail on, and answers a single question: does
  # the dependency tree contain a vulnerability at or above that severity?
  #
  # It deliberately produces a dependency-audit gate SIGNAL (green | red) in the
  # exact shape the release-decision module already consumes — but it does NOT
  # wire that signal into the module's wired-gate set. That wiring is the separate
  # `after` change `wire-security-into-release-gate`. This slice exists to prove
  # the "no vulnerability at/above the threshold" decision in isolation so the
  # wiring has a trustworthy signal to feed in.
  #
  # Fail-closed: anything other than an explicit, parseable audit with zero
  # vulnerabilities at or above the threshold is red. The evaluator is a pure
  # function of its inputs — no I/O, no network, no clock — so every branch is
  # exhaustively unit-testable.

  Background:
    Given the dependency-audit gate exposes a pure evaluate function
    And the function takes a parsed audit report of per-severity vulnerability counts and a minimum severity to fail on
    And it returns a signal of "green" or "red" plus human-readable reasons

  Scenario: Green when the audit reports no vulnerabilities
    Given the gate is configured to fail on "high" severity and above
    And the audit reports zero vulnerabilities at every severity
    When I evaluate the dependency-audit gate
    Then the dependency-audit signal is "green"
    And there are no failure reasons

  Scenario: Green when only vulnerabilities below the threshold are present
    Given the gate is configured to fail on "high" severity and above
    And the audit reports 3 low and 1 moderate vulnerabilities
    When I evaluate the dependency-audit gate
    Then the dependency-audit signal is "green"
    And there are no failure reasons

  Scenario: Red when a vulnerability at the threshold severity is present
    Given the gate is configured to fail on "high" severity and above
    And the audit reports 2 high vulnerabilities
    When I evaluate the dependency-audit gate
    Then the dependency-audit signal is "red"
    And the reasons name 2 high vulnerabilities at or above the threshold

  Scenario: Red when a vulnerability above the threshold severity is present
    Given the gate is configured to fail on "high" severity and above
    And the audit reports 1 critical vulnerability
    When I evaluate the dependency-audit gate
    Then the dependency-audit signal is "red"
    And the reasons name the critical vulnerability at or above the threshold

  Scenario: Is fail-closed when the audit report is missing or unparseable
    Given the gate is configured to fail on "high" severity and above
    And no parseable audit report is available
    When I evaluate the dependency-audit gate
    Then the dependency-audit signal is "red"
    And the reasons include that the audit report could not be read

  Scenario: The fail-on severity is configurable, not hardcoded at the call site
    Given the gate is configured to fail on "critical" severity and above
    And the audit reports 4 high vulnerabilities
    When I evaluate the dependency-audit gate
    Then the dependency-audit signal is "green"

  Scenario: The signal shape matches the release-decision gate signals
    Given the gate is configured to fail on "high" severity and above
    And the audit reports zero vulnerabilities at every severity
    When I evaluate the dependency-audit gate
    Then the signal value is one the release-decision module accepts as a gate signal
    But the dependency-audit signal is NOT yet added to the release-decision module's wired gates in this change
