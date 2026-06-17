Feature: Resumable run state and journal
  As the batch execution engine
  I want durable run state and an append-only journal
  So that a batch can be stopped and resumed across many single-step invocations

  Scenario: Each transition appends to the journal
    Given a batch run in progress
    When the engine completes a transition
    Then it appends a journal entry recording the change, transition, outcome, and timestamp
    And prior journal entries are never rewritten

  Scenario: Resume picks up from the last recorded state
    Given a run with several completed transitions and a parked step
    When the engine is invoked again
    Then it reconstructs the run state from the journal and changes on disk
    And it continues from the next runnable or parked step

  Scenario: Concurrent steps for the same batch are prevented
    Given a step already running for a batch
    When another step is requested for the same batch
    Then the engine refuses to start a second concurrent step for that batch

  Scenario: The journal feeds the CLI rich view
    Given a run with progress, blocker, and approval entries
    When the CLI renders the batch view
    Then it reads the journal to show recent activity and parked questions

  Scenario: A corrupt or partial entry does not abort the run
    Given a journal whose last entry was written partially before a crash
    When the engine reconstructs run state
    Then it ignores the incomplete trailing entry
    And resumes from the last complete state
