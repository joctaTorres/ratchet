Feature: Ratchetable coverage-gate threshold
  As a maintainer ratcheting test coverage upward
  I want the enforced coverage floor to be a data-driven, raisable value
  So that the gate's minimum can only climb toward the 95% target, never silently regress

  # The coverage gate (src/core/ci/coverage-gate.js) is already a ratchet:
  # total.lines.pct is judged against an enforced minimum that defaults to
  # DEFAULT_COVERAGE_THRESHOLD and is overridable via the COVERAGE_THRESHOLD
  # environment variable. This change lifts that default floor above the 68
  # baseline to the phase target (72) and proves the raised floor's
  # green-at/above, red-below behavior at the unit level. The measured coverage
  # that satisfies the raised floor is delivered by the downstream
  # commands-core-verb-tests change.

  Scenario: The default enforced floor is raised above the 68 baseline
    Given the coverage gate with no COVERAGE_THRESHOLD override set
    When the enforced threshold is resolved from the environment
    Then the resolved threshold is 72
    And the threshold is strictly greater than the previous 68 baseline

  Scenario: The gate is green when coverage is at the raised floor
    Given a coverage summary reporting a total line coverage of 72%
    And no COVERAGE_THRESHOLD override is set
    When the coverage gate runs
    Then the gate signal is green
    And the gate exits 0

  Scenario: The gate is green when coverage is above the raised floor
    Given a coverage summary reporting a total line coverage of 80%
    And no COVERAGE_THRESHOLD override is set
    When the coverage gate runs
    Then the gate signal is green
    And the gate exits 0

  Scenario: The gate is red when coverage is below the raised floor
    Given a coverage summary reporting a total line coverage of 68.67%
    And no COVERAGE_THRESHOLD override is set
    When the coverage gate runs
    Then the gate signal is red
    And the gate exits 1
    And a reason names the measured coverage and the required threshold of 72

  Scenario Outline: COVERAGE_THRESHOLD overrides the default floor
    Given a coverage summary reporting a total line coverage of <coverage>%
    And the COVERAGE_THRESHOLD environment variable is set to "<override>"
    When the coverage gate runs
    Then the gate signal is <signal>

    Examples:
      | coverage | override | signal |
      | 72       | 95       | red    |
      | 96       | 95       | green  |
      | 68.67    | 68       | green  |

  Scenario: A non-numeric COVERAGE_THRESHOLD falls back to the raised default
    Given the COVERAGE_THRESHOLD environment variable is set to "not-a-number"
    When the enforced threshold is resolved from the environment
    Then the resolved threshold is the raised default of 72

  Scenario: The gate stays fail-closed when the coverage summary is unreadable
    Given the coverage summary file is missing or malformed
    And no COVERAGE_THRESHOLD override is set
    When the coverage gate runs
    Then the gate signal is red
    And a reason states the summary could not be read
