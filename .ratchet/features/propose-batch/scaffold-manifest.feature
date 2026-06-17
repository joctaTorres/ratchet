Feature: Scaffold a batch manifest with a shallow DAG
  As an engineer proposing a batch
  I want the skill to write a batch manifest, not change directories
  So that the output is editable intent and changes are decomposed lazily

  Background:
    Given the propose-batch workflow skill has elicited valid phases with proofs-of-work

  Scenario: Scaffold the manifest via the existing batch machinery
    Given a batch name has been chosen
    When the skill scaffolds the batch
    Then it runs "ratchet new batch <name>" to create the manifest
    And it writes the phases and DAG into ".ratchet/batches/<name>/batch.yaml"
    And it does not introduce any new ratchet schema for batches
    And it does not generate any change directories under ".ratchet/changes/"

  Scenario: Write a shallow DAG with only the earliest phase decomposed
    Given an ordered set of phases
    When the skill writes the manifest
    Then phase one carries concrete change intents with their "after" edges forming a DAG
    And later phases are written as goal plus proof-of-work only
    And later phases are not decomposed into change intents up front

  Scenario: The output is a manifest of intent, not change directories
    Given the skill has written the phases and DAG
    When the skill finishes scaffolding
    Then the only artifact written for the batch is the manifest file
    And the manifest is editable intent the user can revise before applying
    And no per-change planning artifacts are produced at proposal time

  Scenario: Record non-default gate and strategy settings on the manifest
    Given the user wants a gate or strategy that differs from the project defaults
    When the skill writes the manifest
    Then it sets the chosen "gate" and "strategy" under the manifest "settings"
    And it omits the settings block when the project defaults are acceptable
