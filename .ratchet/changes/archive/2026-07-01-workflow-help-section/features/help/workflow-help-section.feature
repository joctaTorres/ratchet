Feature: A 'Workflow' help section groups the workflow commands in the top-level help
  As a developer reading `ratchet --help`
  I want propose, apply, and verify gathered under a clearly labelled
  "Workflow:" heading, in workflow order, followed by batch and eval
  So that the headless propose → apply → verify loop reads as one coherent
  group instead of being scattered through a flat, undifferentiated command list

  Background:
    Given the top-level `ratchet` Commander program with all commands registered

  Scenario: `ratchet --help` renders a Workflow heading
    When I render the top-level help via `ratchet --help`
    Then the help output contains a "Workflow:" heading
    And the heading is produced by Commander v14 help groups, not hand-printed text

  Scenario: Running `ratchet` with no arguments renders the same Workflow heading
    When I render the help via `ratchet` with no arguments
    Then the help output contains a "Workflow:" heading
    And the no-args help and `ratchet --help` show the Workflow group identically

  Scenario: The Workflow group lists propose, apply, verify in workflow order
    When I render the top-level help via `ratchet --help`
    Then under the "Workflow:" heading "propose" appears first
    And "apply" appears after "propose"
    And "verify" appears after "apply"

  Scenario: Batch and eval follow the propose/apply/verify trio in the Workflow group
    When I render the top-level help via `ratchet --help`
    Then "batch" appears after "verify" in the Workflow group
    And "eval" appears after "batch" in the Workflow group

  Scenario: Unrelated commands keep their original placement
    When I render the top-level help via `ratchet --help`
    Then commands such as "init", "update", "list", "view", "archive", "validate", "doctor", "status", "instructions", "template", and "new" are NOT pulled under the "Workflow:" heading
    And those unrelated commands appear in their pre-existing default group
