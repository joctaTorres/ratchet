Feature: instructions verbs behavior is proven by tests
  As a maintainer holding ratchet to the testing standard
  I want the remaining untested `instructionsCommand`, `applyInstructionsCommand`,
    and `printApplyInstructionsText` paths under test
  So that the artifact- and apply-instruction surfaces of the workflow group
    are pinned down by integration tests over an isolated tmpdir fixture repo

  Background:
    Given an isolated tmpdir fixture repo built under os.tmpdir()
    And `resolveCurrentPlanningHomeSync` is pointed at the fixture root
    And the fixture is removed in afterEach so no artifacts are left behind

  Scenario: instructionsCommand emits artifact JSON for a ready artifact
    Given a change with the dependencies of an artifact satisfied
    When instructionsCommand runs for that artifact with --json
    Then the emitted JSON carries the artifact instructions

  Scenario: instructionsCommand rejects a missing artifact argument
    Given an existing change
    When instructionsCommand runs without an artifact id
    Then it throws an error listing the valid artifact ids

  Scenario: instructionsCommand rejects an unknown artifact
    Given an existing change
    When instructionsCommand runs for an artifact not in the schema
    Then it throws a not-found error listing the valid artifact ids

  Scenario: instructionsCommand warns when an artifact is blocked
    Given a change whose plan dependency (features) is missing
    When instructionsCommand prints the plan artifact as text
    Then the output carries a warning naming the missing dependency

  Scenario: generateApplyInstructions reports blocked when artifacts are missing
    Given a change with no required artifacts on disk
    When generateApplyInstructions runs
    Then the state is blocked and the missing artifacts are listed

  Scenario: generateApplyInstructions reports all_done when every task is checked
    Given a change whose plan has all tasks checked
    When generateApplyInstructions runs
    Then the state is all_done with full progress

  Scenario: applyInstructionsCommand emits apply JSON for a ready change
    Given a change with its required artifacts and pending tasks
    When applyInstructionsCommand runs with --json
    Then the emitted JSON carries the apply instructions and pending tasks

  Scenario: printApplyInstructionsText renders blocked, progress, and tasks
    Given an apply-instructions snapshot in each of the blocked and ready states
    When the apply text is printed
    Then the blocked banner, context files, progress, and task list render
