Feature: Coverage-gate floor raised to 95
  As a maintainer ratcheting test coverage upward
  I want the enforced default coverage floor lifted from 87 to 95
  So that the now-covered CLI entry, validate, ui/telemetry and core-remainder surfaces lock in their gain and the floor sits at the testing standard's permanent 95% minimum, never to silently regress

  # The coverage gate (src/core/ci/coverage-gate.js) is already a ratchet:
  # total.lines.pct is judged against an enforced minimum that defaults to
  # DEFAULT_COVERAGE_THRESHOLD and is overridable via the COVERAGE_THRESHOLD
  # environment variable. This phase's four upstream test changes
  # (cli-index-tests, validate-deep-tests, ui-telemetry-tests,
  # core-remainder-tests) lifted measured total line coverage to 95.39%. This
  # change raises the enforced default floor from 87 to the testing standard's
  # permanent minimum (95) and proves the raised floor's green-at/above,
  # red-below behavior at the unit level. The measured coverage that satisfies
  # the raised floor is delivered by the upstream changes this change is
  # sequenced after.

  Scenario: The default enforced floor is raised to 95
    Given the coverage gate with no COVERAGE_THRESHOLD override set
    When the enforced threshold is resolved from the environment
    Then the resolved threshold is 95
    And the threshold is strictly greater than the previous 87 floor

  Scenario: The gate is green when coverage is at the raised floor
    Given a coverage summary reporting a total line coverage of 95%
    And no COVERAGE_THRESHOLD override is set
    When the coverage gate runs
    Then the gate signal is green
    And the gate exits 0

  Scenario: The gate is green when coverage is above the raised floor
    Given a coverage summary reporting a total line coverage of 95.39%
    And no COVERAGE_THRESHOLD override is set
    When the coverage gate runs
    Then the gate signal is green
    And the gate exits 0

  Scenario: The gate is red when coverage is below the raised floor
    Given a coverage summary reporting a total line coverage of 94.5%
    And no COVERAGE_THRESHOLD override is set
    When the coverage gate runs
    Then the gate signal is red
    And the gate exits 1
    And a reason names the measured coverage and the required threshold of 95

  Scenario Outline: COVERAGE_THRESHOLD still overrides the raised default floor
    Given a coverage summary reporting a total line coverage of <coverage>%
    And the COVERAGE_THRESHOLD environment variable is set to "<override>"
    When the coverage gate runs
    Then the gate signal is <signal>

    Examples:
      | coverage | override | signal |
      | 95       | 98       | red    |
      | 99       | 98       | green  |
      | 91       | 90       | green  |

  Scenario: A non-numeric COVERAGE_THRESHOLD falls back to the raised default
    Given the COVERAGE_THRESHOLD environment variable is set to "not-a-number"
    When the enforced threshold is resolved from the environment
    Then the resolved threshold is the raised default of 95

  Scenario: The gate stays fail-closed when the coverage summary is unreadable
    Given the coverage summary file is missing or malformed
    And no COVERAGE_THRESHOLD override is set
    When the coverage gate runs
    Then the gate signal is red
    And a reason states the summary could not be read
