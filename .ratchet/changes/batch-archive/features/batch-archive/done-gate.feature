Feature: Confirmation gate for archiving incomplete batches
  As an author archiving a batch
  I want a clear status report and a confirmation prompt when the batch is not
  fully done
  So that I can intentionally shelve an abandoned batch without archiving a
  finished one by accident

  Background:
    Given a batch "rex-agent-runtime" with 4 change intents

  Scenario: A done batch archives without a warning prompt
    Given all 4 change intents are done
    When I run "ratchet batch archive rex-agent-runtime"
    Then the derived batch status "done" is shown
    And no incomplete-change warning is printed
    And the batch is archived

  Scenario: An incomplete batch warns and requires confirmation
    Given only 2 of the 4 change intents are done
    When I run "ratchet batch archive rex-agent-runtime"
    Then the batch status is reported as "in-progress (2/4 changes done)"
    And a warning naming the 2 incomplete change(s) is printed
    And I am asked to confirm before archiving
    And the batch is not archived until I confirm

  Scenario: Declining the confirmation aborts without changes
    Given only 2 of the 4 change intents are done
    When I run "ratchet batch archive rex-agent-runtime"
    And I decline the confirmation prompt
    Then nothing is moved
    And the active batch directory still exists

  Scenario: The --yes flag forces archiving an incomplete batch non-interactively
    Given only 2 of the 4 change intents are done
    When I run "ratchet batch archive rex-agent-runtime --yes"
    Then the incomplete-change warning is printed
    And no interactive prompt is shown
    And the batch is archived

  Scenario: A blocked or parked change counts as incomplete in the gate
    Given 3 change intents are done and 1 is parked awaiting approval
    When I run "ratchet batch archive rex-agent-runtime"
    Then the parked change is counted among the incomplete changes
    And a confirmation is required before archiving
