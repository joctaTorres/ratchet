Feature: Secret-scan gate — a green/red signal from a leaked-secret scan
  As a maintainer of the ratchet package
  I want a pure, unit-tested evaluator that turns a secret-scan report into a green/red signal
  So that a leaked secret can later block the release — provably, not by hope

  Background:
    Given the secret-scan gate exposes a pure evaluate function
    And the function takes a parsed secret-scan report of findings
    And it returns a signal of "green" or "red" plus human-readable reasons

  Scenario: Green when the scan reports no findings
    Given a secret scan ran and completed
    And the scan reports zero findings
    When I evaluate the secret-scan gate
    Then the secret-scan signal is "green"
    And there are no failure reasons

  Scenario: Red when the scan reports a leaked secret
    Given a secret scan ran and completed
    And the scan reports 1 finding for a leaked credential
    When I evaluate the secret-scan gate
    Then the secret-scan signal is "red"
    And the reasons name the leaked secret finding

  Scenario: Red names each finding when several secrets are present
    Given a secret scan ran and completed
    And the scan reports 3 findings across different files
    When I evaluate the secret-scan gate
    Then the secret-scan signal is "red"
    And the reasons account for 3 findings

  Scenario: Is fail-closed when the scan report is missing or unparseable
    Given no parseable secret-scan report is available
    When I evaluate the secret-scan gate
    Then the secret-scan signal is "red"
    And the reasons include that the secret-scan report could not be read

  Scenario: Allowlisted findings do not turn a clean tree red
    Given a secret scan ran and completed
    And the only finding is an allowlisted known-safe placeholder
    When I evaluate the secret-scan gate
    Then the secret-scan signal is "green"

  Scenario: The signal shape matches the release-decision gate signals
    Given a secret scan ran and completed
    And the scan reports zero findings
    When I evaluate the secret-scan gate
    Then the signal value is one the release-decision module accepts as a gate signal
    But the secret-scan signal is NOT yet added to the release-decision module's wired gates in this change
