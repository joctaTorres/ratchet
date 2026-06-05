Feature: Listing changes and the feature store
  As a developer surveying work
  I want to list active changes and the feature store
  So that I can see progress and the accumulated behavior at a glance

  Scenario: Listing changes shows progress and recency
    Given a project with several active changes
    When I run "ratchet list"
    Then each change is listed with its task status and relative last-modified time
    And the archive directory is not listed as a change

  Scenario: Changes can be sorted by name
    Given a project with several active changes
    When I run "ratchet list --sort name"
    Then the changes are ordered alphabetically by name
    And the default ordering would otherwise be most-recent first

  Scenario: Listing the feature store groups by capability
    Given a populated feature store
    When I run "ratchet list --specs"
    Then each capability is listed with its number of feature files
    And capabilities are ordered alphabetically

  Scenario: JSON output is emitted for changes
    Given a project with active changes
    When I run "ratchet list --json"
    Then a JSON document lists each change with its task counts and a derived status
    And the status is one of no-tasks, in-progress or complete
