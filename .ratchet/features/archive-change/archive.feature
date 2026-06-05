Feature: Archiving a completed change
  As a developer finalizing a change
  I want archive to sync features into the store and move the change aside
  So that completed work ratchets forward and the active list stays clean

  Background:
    Given a ratchet project with an active change "add-login"

  Scenario: Archiving a complete change syncs features and moves the directory
    Given "add-login" is complete and passes validation
    When I run "ratchet archive add-login -y"
    Then its feature files are synced into the permanent store
    And the change directory is moved to ".ratchet/changes/archive/<date>-add-login"

  Scenario: Skipping the feature store leaves it untouched
    Given a documentation-only change "add-login"
    When I run "ratchet archive add-login -y --skip-features"
    Then the permanent feature store is not modified
    And the change is still moved into the archive

  Scenario: Feature errors block the archive
    Given "add-login" contains a feature file with a validation error
    When I run "ratchet archive add-login" with validation enabled
    Then archiving stops and the feature errors are reported
    And the change is not moved into the archive

  Scenario: Plan warnings do not block the archive
    Given "add-login" has valid features but a plan.md with only warnings
    When I run "ratchet archive add-login -y"
    Then the plan warnings are shown as non-blocking notices
    And the archive proceeds

  Scenario: Incomplete tasks require confirmation
    Given "add-login" has incomplete tasks in its plan
    When I run "ratchet archive add-login" interactively
    Then a warning reports the number of incomplete tasks
    And I am asked to confirm before archiving continues

  Scenario: Archiving twice on the same day fails
    Given "add-login" was already archived today
    When I archive a change "add-login" again the same day
    Then the operation fails because the dated archive already exists
    And the existing archive is preserved
