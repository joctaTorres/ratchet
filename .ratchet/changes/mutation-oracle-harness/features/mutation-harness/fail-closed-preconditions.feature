Feature: Fail-closed mutation harness preconditions
  As the eval harness
  I want to refuse to seed mutants unless the project's git working tree is
  known-clean, and to always leave it exactly as it found it
  So that a `kind: mutation` invariant never mutates or misattributes a user's
  uncommitted work, and never leaks a seeded fault into the project

  Scenario: A dirty git working tree aborts before any mutant is seeded
    Given a project whose git working tree already has uncommitted changes
    When the harness attempts to run the mutation invariant
    Then the harness reports the working tree as unusable
    And no fault is seeded
    And the test command is never run

  Scenario: A project that is not a git repository also aborts
    Given a project directory that is not a git repository
    When the harness attempts to run the mutation invariant
    Then the harness reports the working tree as unusable
    And no fault is seeded

  Scenario: The git working tree matches its starting state after a full run
    Given a mutation invariant with a budget of at least 2
    When the harness finishes seeding and classifying every mutant
    Then the project's git working tree matches the state it was in before the
      harness ran, with no seeded fault left behind

  Scenario: The working tree is restored even when a mutant survives
    Given a mutation invariant whose first seeded fault survives the test command
    When the harness seeds a second mutant
    Then the surviving mutant's fault was reverted before the second mutant was
      seeded, exactly as a killed mutant's fault would be
