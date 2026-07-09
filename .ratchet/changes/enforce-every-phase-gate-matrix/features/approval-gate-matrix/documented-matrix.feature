Feature: Gate documentation states exactly which transitions pause
  As a ratchet user configuring a batch gate
  I want the reference docs to name the exact transitions each gate value parks
  So that the gate's documented protection matches what the engine enforces

  Scenario: the engine overview gate table names the every-phase transitions
    Given the reference doc "docs/engine/overview.md"
    When the reader looks up the gate matrix table
    Then the "every-phase" row states it parks each completed propose, apply, and verify transition
    And the row states that decomposition and PR-open steps never park for approval

  Scenario: the batch command doc and config docs match the engine matrix
    Given the reference docs "docs/commands/batch.md" and "docs/configuration/config-yaml.md"
    When the reader looks up the "gate" configuration key
    Then each doc describes "every-phase" as pausing after every completed change transition
    And neither doc describes "every-phase" as identical to "after-propose"
