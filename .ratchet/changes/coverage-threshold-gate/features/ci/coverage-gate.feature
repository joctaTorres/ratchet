Feature: Coverage-threshold gate — a green/red signal from measured coverage
  As a maintainer of the ratchet package
  I want a pure, unit-tested evaluator that turns a coverage report into a green/red signal against an enforced minimum threshold
  So that a drop in test coverage can later block the release — provably, not by hope

  # This is the coverage half of the "coverage + e2e gates" phase. It mirrors the
  # release-decision spine's shape: a PURE evaluator (inputs in, signal out) plus
  # a thin runner that adapts the CI environment to it. The evaluator reads a
  # coverage summary (the total percentage produced by the coverage tool) and a
  # configured threshold and answers a single question: is coverage >= threshold?
  #
  # It deliberately produces a `coverage` gate SIGNAL (green | red) in the exact
  # shape the release-decision module already consumes — but it does NOT wire that
  # signal into the module's wired-gate set. That wiring is the separate `after`
  # change `wire-coverage-e2e-into-release-gate`. This slice exists to prove the
  # "coverage >= threshold" decision in isolation so the wiring has a trustworthy
  # signal to feed in.
  #
  # Fail-closed: anything other than an explicit, parseable coverage at or above
  # the threshold is red. The evaluator is a pure function of its inputs — no I/O,
  # no clock — so every branch is exhaustively unit-testable.

  Background:
    Given the coverage gate exposes a pure evaluate function
    And the function takes a parsed coverage total and a minimum threshold
    And it returns a signal of "green" or "red" plus human-readable reasons

  Scenario: Green when total coverage meets the threshold
    Given the minimum coverage threshold is 80 percent
    And the measured total coverage is 80 percent
    When I evaluate the coverage gate
    Then the coverage signal is "green"
    And there are no failure reasons

  Scenario: Green when total coverage exceeds the threshold
    Given the minimum coverage threshold is 80 percent
    And the measured total coverage is 92 percent
    When I evaluate the coverage gate
    Then the coverage signal is "green"
    And there are no failure reasons

  Scenario: Red when total coverage is below the threshold
    Given the minimum coverage threshold is 80 percent
    And the measured total coverage is 71 percent
    When I evaluate the coverage gate
    Then the coverage signal is "red"
    And the reasons include that coverage 71 is below the threshold 80

  Scenario: Is fail-closed when the coverage summary is missing or unparseable
    Given the minimum coverage threshold is 80 percent
    And no parseable coverage total is available
    When I evaluate the coverage gate
    Then the coverage signal is "red"
    And the reasons include that the coverage summary could not be read

  Scenario: The threshold is configurable, not hardcoded at the call site
    Given the minimum coverage threshold is configured to 60 percent
    And the measured total coverage is 65 percent
    When I evaluate the coverage gate
    Then the coverage signal is "green"

  Scenario: The signal shape matches the release-decision gate signals
    Given the minimum coverage threshold is 80 percent
    And the measured total coverage is 90 percent
    When I evaluate the coverage gate
    Then the signal value is one the release-decision module accepts as a gate signal
    But the coverage signal is NOT yet added to the release-decision module's wired gates in this change
