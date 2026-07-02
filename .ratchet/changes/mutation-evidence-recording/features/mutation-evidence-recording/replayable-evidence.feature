Feature: Mutation invariant evidence is persisted as replayable run evidence
  As ratchet's per-invariant evaluator
  I want every mutant the mutation harness runs — its seeded fault (diff) and its
  kill/survive oracle output — persisted as durable run evidence referenced from
  the invariant's own outcome
  So that a survived mutant's exact fault and test output is reproducible from
  the run record alone, and evaluating the same run a second time never
  re-invokes the coding agent to find out what it already found

  Background:
    Given an active mutation invariant with a test command, a budget, and a threshold
    And an eval run and the project it was produced in

  Scenario: Every mutant the harness runs has its diff and oracle output persisted, killed or survived alike
    Given the mutation harness seeds and classifies two mutants, one killed and one survived
    When the invariant is evaluated against the run
    Then the outcome's artifacts list has one entry per mutant the harness ran
    And each entry references a persisted, project-relative path to that mutant's diff
    And each entry references a persisted, project-relative path to that mutant's oracle (test command) output
    And reading those paths off disk reproduces the exact diff and oracle output the harness produced

  Scenario: A survived mutant's outcome evidence points at its exact fault and passing oracle output
    Given the mutation harness seeds a mutant that survives
    When the invariant is evaluated against the run
    Then the invariant outcome is fail
    And the failed outcome's artifacts include the survived mutant's diff and oracle output paths

  Scenario: Evaluating the same run a second time reads the persisted outcome instead of re-invoking the agent
    Given a mutation invariant already evaluated once for a run, with its outcome and evidence persisted
    When the invariant is evaluated again for that same run
    Then the harness is not invoked again and no agent is spawned
    And the returned outcome, including its artifacts, is identical to the first evaluation's outcome

  Scenario: A fresh run evaluates the same invariant independently, never reusing another run's cached evidence
    Given a mutation invariant already evaluated for one run
    When the same invariant is evaluated for a different run
    Then the harness runs again and the agent is spawned again
    And the new run's persisted evidence lives under its own run id, separate from the first run's evidence

  Scenario: No mutant ever ran means no evidence is persisted and nothing is cached
    Given the mutation harness reports the working tree is unusable before seeding anything
    When the invariant is evaluated against the run
    Then the invariant outcome is unevaluable
    And the outcome carries no artifacts
    And a later evaluation of the same run is free to try the harness again
