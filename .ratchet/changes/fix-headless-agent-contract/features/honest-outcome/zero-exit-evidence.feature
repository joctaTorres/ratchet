Feature: Honest zero-exit outcome with transcript and on-disk evidence
  As a user running `ratchet batch apply`
  I want a step that exits 0 without reporting to surface what the agent did
  So that I am not told the agent "did nothing" when work or a transcript exists

  Background:
    Given an agent session for a single transition
    And the agent exited with code 0
    And the agent wrote no completion entry and no blocker entry to the journal

  Scenario: Zero-exit-without-report attaches the captured transcript
    Given the agent produced captured stdout and/or stderr output
    When the session is mapped to an engine outcome
    Then the outcome state is "blocked"
    And the outcome detail contains the captured transcript text
    And the detail is truncated using the same truncation as the non-zero-exit path

  Scenario: Empty transcript still produces a defined (possibly empty) detail
    Given the agent produced no stdout and no stderr
    When the session is mapped to an engine outcome
    Then the outcome state is "blocked"
    And the outcome does not claim a transcript that does not exist

  Scenario: A propose run that created a change directory is recognized as progress
    Given the transition is "propose"
    And on-disk state shows the change directory and a plan.md now exist
    When the session is mapped to an engine outcome
    Then the outcome state is "blocked"
    And the outcome message reflects the observed on-disk progress
    And the outcome message does not state that the agent "did nothing"
    And the step is not auto-advanced without a completion report

  Scenario: An apply run that advanced task checkboxes is recognized as progress
    Given the transition is "apply"
    And on-disk state shows more task checkboxes are now checked than before the session
    When the session is mapped to an engine outcome
    Then the outcome state is "blocked"
    And the outcome message references the task progress rather than a bare stall
    And the step is not auto-advanced without a completion report

  Scenario: A truly silent run with no evidence still parks for attention
    Given the transition is "propose"
    And on-disk state shows no change directory was created
    And the agent produced no captured output
    When the session is mapped to an engine outcome
    Then the outcome state is "blocked"
    And the outcome explains the agent exited without reporting completion or a blocker
