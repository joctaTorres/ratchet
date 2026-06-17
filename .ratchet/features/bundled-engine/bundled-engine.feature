Feature: Engine bundled into the CLI
  As a user of ratchet
  I want the batch execution engine to be part of the main package
  So that batch apply just works without any separate install or activation

  Scenario: batch apply runs the engine out of the box
    Given a freshly installed ratchet with no extra packages
    And a batch with a ready step
    When I run "ratchet batch apply <batch>"
    Then the engine executes the step directly
    And there is no "engine is not installed" message and no activation prompt

  Scenario: Engine-absent is no longer a state
    Given the bundled engine
    When the CLI prepares to run a step
    Then it does not perform an optional dynamic import or report an absent engine
    And the install/activate hints are gone from the codebase and from any output

  Scenario: The separate engine package is removed
    Given the repository layout
    When I inspect the workspace packages
    Then there is no separate "@ratchet/batch-engine" package
    And the engine source lives within the main ratchet package

  Scenario: Existing engine behavior is preserved after folding in
    Given the bundled engine
    When a batch step runs
    Then single-step execution, propose/apply/verify transitions, proof-of-work,
      halt/resume, the run journal, and the per-batch lock all behave as before
