Feature: Validating Gherkin feature files
  As an author and as the archive gate
  I want feature files validated for Gherkin structure
  So that only well-formed, behavior-bearing features enter the store

  Scenario: A malformed feature file produces a structured error
    Given a ".feature" file whose scenario is missing its Then step
    When I run "ratchet validate <item>"
    Then a structured error is reported pointing at the offending scenario
    And the validation exits with a non-zero status

  Scenario: An empty capability directory is an error
    Given a capability directory under the store with no ".feature" files
    When that capability is validated
    Then an error reports that no ".feature" files were found
    And it advises adding at least one features/<capability>/<name>.feature

  Scenario: A duplicate scenario name is warned in strict mode
    Given a feature file with two scenarios sharing the same name
    When I run validation with the strict flag
    Then a warning reports the duplicate scenario name
    And strict mode treats the warning as a failure

  Scenario: Bulk validation of the feature store emits per-item results
    Given a populated feature store with several capabilities
    When I run "ratchet validate --specs"
    Then every store capability is validated
    And a totals line reports how many passed and failed

  Scenario: JSON output is machine-readable
    Given the feature store is validated with the JSON flag
    When validation completes
    Then the output is a JSON document with per-item issues and a summary of totals
    And each issue carries a level, path and message
