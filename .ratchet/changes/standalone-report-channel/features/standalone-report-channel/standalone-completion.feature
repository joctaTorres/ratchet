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
