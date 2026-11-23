Feature: Batch archive halts at a tripped scenario guard
  As an author archiving a batch whose member changes overwrite store feature files
  I want the cascade to halt at the first member whose scenario guard trips, naming that member and its lost scenarios
  So that a mid-batch scenario loss is surfaced with its offending member and the batch stays in place, re-runnable, instead of failing mid-cascade without context

  Background:
    Given a project with a permanent feature store at ".ratchet/features/"
    And a batch whose manifest declares member changes across its phases

  Scenario: The cascade halts at the first member whose scenario guard trips, naming the member and its lost scenarios
    Given the store file "user-auth/login.feature" contains a scenario "Locked account"
    And member change "drop-locked" has a version of "user-auth/login.feature" that drops "Locked account"
    And member change "later-change" is declared after "drop-locked"
    When I run "ratchet batch archive" for the batch
    Then the command fails non-zero
    And the refusal names the member change "drop-locked"
    And the refusal lists the store file "user-auth/login.feature" and the lost scenario "Locked account"
    And "later-change" never runs through the change-archive flow

  Scenario: A tripped guard leaves the batch directory in place with earlier members already archived
    Given member change "kept-change" is declared before member change "drop-locked"
    And "drop-locked" would drop a store scenario
    When I run "ratchet batch archive" for the batch
    Then the command fails non-zero
    And "kept-change" is moved to ".ratchet/changes/archive/"
    And the active batch directory still exists
    And no archived batch directory is created for it

  Scenario: Re-running after a halt skips archived members and halts again at the same member
    Given a previous run archived "kept-change" and then halted at "drop-locked"
    When I run "ratchet batch archive" for the batch again
    Then "kept-change" is skipped as already archived
    And the command fails non-zero naming "drop-locked" and its lost scenario again
    And the active batch directory still exists

  Scenario: Re-running after the offending member is resolved completes the archive
    Given a previous run halted at member change "drop-locked"
    And "drop-locked" has since been archived individually with its scenario removal accepted
    When I run "ratchet batch archive" for the batch again
    Then "drop-locked" is skipped as already archived
    And every remaining member change runs through the change-archive flow
    And the batch directory is moved to ".ratchet/batches/archive/"

  Scenario: The archive-batch workflow body tells the agent to report the trip and stop
    Given the shared archive-batch workflow body
    When the body describes invoking "ratchet batch archive"
    Then it states that a scenario-loss refusal halts the cascade at the offending member change
    And it directs the agent to report the trip to the user and stop
    And the report names the member change and each lost scenario and its store file exactly as the refusal lists them
    And it states the batch directory stays in place and the cascade is re-runnable, skipping already-archived members
    And it routes intentional scenario removal through the offending member's own archive flow, never on the agent's own initiative

  Scenario: Every registered agent's rendered archive-batch output carries the halt guidance
    Given the supported-tools registry
    When the archive-batch skill template and command template are rendered for each registered agent
    Then every rendered body carries the report-the-trip-and-stop guidance
    And the checked agent set is non-empty and covers every registered agent

  Scenario: The halt-guidance assertions reject a pre-change archive-batch body
    Given a sample archive-batch body with no scenario-loss halt guidance
    When the halt-guidance rendered-output assertions run against it
    Then the assertions fail
