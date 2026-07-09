Feature: Override provenance is stamped on journal entries and run records
  As a ratchet operator auditing a batch or eval run
  I want every journal entry and run record produced under an agent-cmd override marked "via: env-override"
  So that synthetic runs are distinguishable from real agent work after the fact

  Scenario: engine transition-outcome journal entry is stamped
    Given RATCHET_BATCH_AGENT_CMD is set to a stand-in command
    When the engine spawns a step and records its transition-outcome journal entry
    Then the appended journal entry carries "via": "env-override"

  Scenario: agent-reported journal entries are stamped
    Given a `ratchet batch report` invocation whose process environment carries an active RATCHET_BATCH_AGENT_CMD
    When it appends a progress, blocker, needs-input, or completion entry
    Then the appended journal entry carries "via": "env-override"

  Scenario: eval run record is stamped
    Given RATCHET_EVAL_AGENT_CMD is set to a stand-in command
    When `ratchet eval run` persists the run under .ratchet/evals/runs/
    Then the persisted run record carries "via": "env-override"

  Scenario: work produced without an override stays unstamped
    Given neither RATCHET_BATCH_AGENT_CMD nor RATCHET_EVAL_AGENT_CMD is set
    When journal entries and eval run records are produced
    Then none of them carry a "via" field
