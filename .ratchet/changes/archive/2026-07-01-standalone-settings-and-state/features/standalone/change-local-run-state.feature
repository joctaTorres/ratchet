Feature: runChangeStep reads and writes run state change-locally with no batch
  As the change-scoped engine core that headless propose/apply/verify will spawn
  I want the journal and resume (parked) state to live under
  .ratchet/changes/<change>/.run/ when no batch manifest is present
  So that a single change can advance one forced transition and resume from its
  own durable state without any batch run directory in sight

  Background:
    Given a change with a definition of done and a resolved phase context
    And an injected agent runtime so no real agent is spawned

  Scenario: With no batch, the journal is written under the change-local .run/
    Given a ChangeStepContext with no batch and transition "propose"
    When runChangeStep is called with that context
    Then the engine spawns exactly one agent for the forced "propose" transition
    And it appends the transition-outcome journal entry to
      ".ratchet/changes/<change>/.run/journal.jsonl"
    And it writes nothing under ".ratchet/batches/"
    And it returns a structured StepResult naming the same change and transition

  Scenario: With no batch, resume reads prior entries from the change-local .run/
    Given prior journal entries recorded under ".ratchet/changes/<change>/.run/journal.jsonl"
    And a ChangeStepContext with no batch whose journal is empty
    When runChangeStep is called
    Then the engine reconstructs the prior entries from the change-local journal
    And the session entries it returns isolate only the new entries this step wrote

  Scenario: A change-local park is honoured before any agent is spawned
    Given a ChangeStepContext with no batch parked "blocked" with no recorded answer
    When runChangeStep is called
    Then the returned StepResult state is "blocked"
    And no agent is spawned while the change-local park is unresolved

  Scenario: A recorded change-local answer lets the parked step resume
    Given a ChangeStepContext with no batch parked "blocked" carrying a recorded answer
    When runChangeStep is called
    Then exactly one agent is spawned for the forced transition
    And the recorded answer is folded into the agent instructions

  Scenario: Batch apply keeps writing run state under the batch directory
    Given a batch manifest with a ready change in its first phase
    When batch apply runs one step by delegating to runChangeStep
    Then the journal entry is appended under ".ratchet/batches/<batch>/run/journal.jsonl"
    And nothing is written under ".ratchet/changes/<change>/.run/"
    And the existing batch-apply behaviour is unchanged
