Feature: Override provenance is stamped on journal entries and run records
  As an auditor of a batch or eval run
  I want every record produced under an override marked as such
  So that synthetic runs are distinguishable from real agent work after the fact

  Scenario: The engine stamps its transition-outcome journal entry
    Given "RATCHET_BATCH_AGENT_CMD" is set and the opt-in is given
    When the engine records the outcome of an overridden transition
    Then that journal entry carries "via": "env-override"

  Scenario: Entries the stand-in reports are stamped too
    Given the engine spawned an override stand-in
    When the stand-in runs "ratchet batch report --complete" from its inherited environment
    Then the appended journal entry carries "via": "env-override"

  Scenario: Real agent work is never stamped
    Given no override is active for the spawn
    When the engine and the agent append journal entries
    Then none of them carries a "via" field

  Scenario: A leftover override variable alone does not stamp a manual report
    Given "RATCHET_BATCH_AGENT_CMD" is set in the operator's shell
    But the report was not issued from an engine-spawned override stand-in
    When the operator runs "ratchet batch report"
    Then the appended journal entry carries no "via" field

  Scenario: Eval run records are stamped
    Given "RATCHET_EVAL_AGENT_CMD" is set and "ratchet eval run --allow-agent-override" is used
    When the run record is persisted
    Then the run record carries "via": "env-override"
    And "--json" output carries "agentOverride": true
