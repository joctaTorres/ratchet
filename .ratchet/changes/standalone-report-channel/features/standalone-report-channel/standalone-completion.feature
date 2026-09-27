Feature: A reported standalone step advances
  As an operator running `ratchet apply <change>` with no batch
  I want an agent that follows the prompt's report instruction to be recorded as done
  So that a finished standalone step maps to advanced rather than blocked

  Scenario: A standalone apply whose agent reports via the prompted command ends advanced
    Given a project with a change "add-hello" whose plan has one unchecked task
    And a stub agent that runs the "--complete" report command named in its instructions
    When I run "ratchet apply add-hello --json"
    Then the step result state is "advanced"
    And the change-local journal holds the agent's completion entry

  Scenario: A standalone apply whose agent does not report still parks as unreported
    Given a project with a change "add-hello" whose plan has one unchecked task
    And a stub agent that exits 0 without reporting
    When I run "ratchet apply add-hello --json"
    Then the step result state is "blocked"

  Scenario: A standalone propose whose agent reports before scaffolding ends advanced
    Given a project with no change "add-hello"
    And a stub agent that runs "ratchet report add-hello --status" first, then "ratchet new change add-hello", then the prompted "--complete" report
    When I run "ratchet propose \"say hello\" --name add-hello"
    Then the stub's "ratchet new change add-hello" succeeds
    And the step result state is "advanced"

  Scenario: An early-blocked standalone propose stays retryable
    Given a project with no change "new-idea"
    And a stub agent that runs "ratchet report new-idea --blocker \"which database?\"" and exits without scaffolding
    When I run "ratchet propose \"anything\" --name new-idea --json"
    Then the step result state is "blocked" with blocker "which database?"
    And ".ratchet/changes/new-idea/" holds only ".run/" and no ".ratchet.yaml"
    When I run "ratchet propose \"anything\" --name new-idea" again with an agent that scaffolds and reports completion
    Then propose does not refuse "new-idea" as an existing change
    And the change "new-idea" is created with a ".ratchet.yaml"
