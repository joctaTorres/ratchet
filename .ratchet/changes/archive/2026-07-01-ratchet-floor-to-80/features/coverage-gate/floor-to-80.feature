Feature: Coverage-gate floor raised to 80
  As a maintainer ratcheting test coverage upward
  I want the enforced default coverage floor lifted from 78 to 80
  So that the now-covered command groups lock in their gain and the floor can only climb toward 95%, never silently regress

  # The coverage gate (src/core/ci/coverage-gate.js) is already a ratchet:
  # total.lines.pct is judged against an enforced minimum that defaults to
  # DEFAULT_COVERAGE_THRESHOLD and is overridable via the COVERAGE_THRESHOLD
  # environment variable. The phase's three command-group test changes
  # (batch, workflow, eval) lifted measured total line coverage to ~80%. This
  # change raises the enforced default floor from 78 to the phase target (80)
  # and proves the raised floor's green-at/above, red-below behavior at the
  # unit level. The measured coverage that satisfies the raised floor is
  # already delivered by the upstream command-group changes.

  Scenario: The default enforced floor is raised to 80
    Given the coverage gate with no COVERAGE_THRESHOLD override set
    When the enforced threshold is resolved from the environment
    Then the resolved threshold is 80
    And the threshold is strictly greater than the previous 78 floor

  Scenario: The gate is green when coverage is at the raised floor
    Given a coverage summary reporting a total line coverage of 80%
    And no COVERAGE_THRESHOLD override is set
    When the coverage gate runs
    Then the gate signal is green
    And the gate exits 0

  Scenario: The gate is green when coverage is above the raised floor
    Given a coverage summary reporting a total line coverage of 80.09%
    And no COVERAGE_THRESHOLD override is set
    When the coverage gate runs
    Then the gate signal is green
    And the gate exits 0

  Scenario: The gate is red when coverage is below the raised floor
    Given a coverage summary reporting a total line coverage of 79.5%
    And no COVERAGE_THRESHOLD override is set
    When the coverage gate runs
    Then the gate signal is red
    And the gate exits 1
    And a reason names the measured coverage and the required threshold of 80

  Scenario Outline: COVERAGE_THRESHOLD still overrides the raised default floor
    Given a coverage summary reporting a total line coverage of <coverage>%
    And the COVERAGE_THRESHOLD environment variable is set to "<override>"
    When the coverage gate runs
    Then the gate signal is <signal>

    Examples:
      | coverage | override | signal |
      | 80       | 95       | red    |
      | 96       | 95       | green  |
      | 79       | 78       | green  |

  Scenario: A non-numeric COVERAGE_THRESHOLD falls back to the raised default
    Given the COVERAGE_THRESHOLD environment variable is set to "not-a-number"
    When the enforced threshold is resolved from the environment
    Then the resolved threshold is the raised default of 80

  Scenario: The gate stays fail-closed when the coverage summary is unreadable
    Given the coverage summary file is missing or malformed
    And no COVERAGE_THRESHOLD override is set
    When the coverage gate runs
    Then the gate signal is red
    And a reason states the summary could not be read
