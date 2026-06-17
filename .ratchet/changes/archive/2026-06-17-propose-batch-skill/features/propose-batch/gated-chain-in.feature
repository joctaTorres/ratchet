Feature: Gated prompt to propose phase-one changes now
  As an engineer who has just defined a batch
  I want the skill to ask whether to spec phase one's changes now
  So that I can chain into propose-change immediately or defer it to apply time

  Background:
    Given the propose-batch workflow skill has written the batch manifest

  Scenario: Ask whether to propose phase-one changes now
    Given the phases are defined and the manifest is complete
    When the manifest is written
    Then the skill asks the user whether to run the propose-change flow on phase one's first change or changes now
    And it presents this as an explicit gate, not an automatic action

  Scenario: Chain into propose-change when the user accepts
    Given the user accepts the prompt to propose phase-one changes now
    When the skill continues
    Then it chains into the propose-change flow for phase one's first change or changes
    And those changes are spec'd and ready before the skill ends

  Scenario: Stop and defer when the user declines
    Given the user declines the prompt to propose phase-one changes now
    When the skill continues
    Then it stops without creating any change directories
    And it explains that changes are created lazily during "ratchet batch apply"
