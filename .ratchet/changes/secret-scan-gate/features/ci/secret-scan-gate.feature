Feature: Secret-scan gate — a green/red signal from a leaked-secret scan
  As a maintainer of the ratchet package
  I want a pure, unit-tested evaluator that turns a secret-scan report into a green/red signal
  So that a leaked secret can later block the release — provably, not by hope

  # This is the secret-scan half of the "security layer" phase. It mirrors the
  # release-decision spine and the sibling dependency-audit slice: a PURE
  # evaluator (inputs in, signal out) plus a thin runner that adapts the CI
  # environment to it. The evaluator reads a parsed secret-scan report (the list
  # of findings a secret scanner's `--report-format json` produces) and answers a
  # single question: does the working tree contain any leaked secret?
  #
  # It deliberately produces a secret-scan gate SIGNAL (green | red) in the exact
  # shape the release-decision module already consumes — but it does NOT wire that
  # signal into the module's wired-gate set. That wiring is the separate `after`
  # change `wire-security-into-release-gate`. This slice exists to prove the "no
  # leaked secret" decision in isolation so the wiring has a trustworthy signal to
  # feed in.
  #
  # Fail-closed: anything other than an explicit, parseable scan with zero
  # findings is red. The evaluator is a pure function of its inputs — no I/O, no
  # network, no clock — so every branch is exhaustively unit-testable.

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
