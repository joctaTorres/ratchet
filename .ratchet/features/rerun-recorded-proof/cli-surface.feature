Feature: ratchet batch rerun-proof CLI verb
  As an operator running a batch
  I want a supported command to invalidate a phase's recorded proof-of-work
  So that a stale failing verdict no longer permanently blocks the next phase
  and I never have to hand-edit the append-only run journal

  Background:
    Given a batch "demo" whose manifest declares phases "p1" then "p2"
    And "p1" is done with a boundary proof-of-work configured under "hard-gate"

  Scenario: Invalidate a recorded failing proof so the boundary re-runs
    Given the run journal has a recorded proof-of-work for "p1" with gatePassed false
    When I run "ratchet batch rerun-proof demo --phase p1"
    Then a superseding invalidation entry for "p1" is appended to the run journal
    And the original recorded proof entry is left untouched in the append-only journal
    And the command reports that "p1"'s recorded proof was invalidated
    And the next "ratchet batch apply demo" re-runs "p1"'s configured boundary proof-of-work

  Scenario: Invalidate a recorded passing proof to force a fresh run
    Given the run journal has a recorded proof-of-work for "p1" with gatePassed true
    When I run "ratchet batch rerun-proof demo --phase p1"
    Then a superseding invalidation entry for "p1" is appended to the run journal
    And the next "ratchet batch apply demo" re-runs "p1"'s configured boundary proof-of-work
    instead of advancing straight into "p2"

  Scenario: Re-running the invalidated boundary records a fresh verdict that drives the gate
    Given the recorded proof for "p1" was invalidated via "ratchet batch rerun-proof demo --phase p1"
    And the operator has fixed the misconfigured pass condition
    When "ratchet batch apply demo" re-runs the boundary proof-of-work for "p1"
    Then a new proof-of-work record for "p1" is appended with the fresh verdict
    And the phase gate for "p2" derives from that newest record
    And a now-passing verdict opens the gate so "p2" becomes runnable

  Scenario: Required --phase flag is enforced
    Given the batch "demo" exists
    When I run "ratchet batch rerun-proof demo" with no --phase flag
    Then the command exits with an actionable error naming the missing --phase flag
    And no entry is appended to the run journal

  Scenario: Unknown phase is rejected
    Given the batch "demo" has no phase named "ghost"
    When I run "ratchet batch rerun-proof demo --phase ghost"
    Then the command exits with an error stating that "ghost" is not a phase of the batch
    And no entry is appended to the run journal

  Scenario: Nothing to invalidate when no proof is recorded
    Given the run journal has no recorded proof-of-work for "p1"
    When I run "ratchet batch rerun-proof demo --phase p1"
    Then the command reports there is no recorded proof for "p1" to invalidate
    And the run journal is left unchanged

  Scenario: JSON output for scripting
    Given the run journal has a recorded proof-of-work for "p1" with gatePassed false
    When I run "ratchet batch rerun-proof demo --phase p1 --json"
    Then the command prints a JSON object naming the batch, the phase, and whether a proof was invalidated

  Scenario: Batch name is resolved when omitted
    Given exactly one batch "demo" exists
    And it has a recorded proof-of-work for "p1"
    When I run "ratchet batch rerun-proof --phase p1" with no batch name
    Then the active batch "demo" is resolved automatically
    And "p1"'s recorded proof is invalidated
