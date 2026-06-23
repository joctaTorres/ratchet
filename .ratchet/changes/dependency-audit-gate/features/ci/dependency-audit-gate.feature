Feature: Dependency-audit gate — a green/red signal from a vulnerability audit
  As a maintainer of the ratchet package
  I want a pure, unit-tested evaluator that turns a dependency vulnerability audit into a green/red signal against a configured severity threshold
  So that a known-vulnerable dependency can later block the release — provably, not by hope

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
