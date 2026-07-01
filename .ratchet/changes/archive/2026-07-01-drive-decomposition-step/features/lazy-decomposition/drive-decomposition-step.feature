Feature: `ratchet batch apply` drives a ready empty phase's decomposition automatically
  As the batch engine orchestrating a lazily-decomposed multi-phase batch
  I want `ratchet batch apply`, when the next runnable step is a reachable,
  ungated phase with empty `changes`, to spawn ONE agent that delegates to the
  canonical decomposition skill (per phase 1) and authors that phase's concrete
  change intents into `batch.yaml` from the prior phase's shipped results
  So that lazy decomposition happens NATIVELY inside the apply loop — no manual
  stop/propose/resume detour — and the loop then continues into the new changes
  (#30).

  # PRIOR STATE: `empty-phase-is-not-done` taught status/selection to RECOGNIZE a
  # reachable empty phase as an outstanding decomposition step (`SelectedStep`
  # carries `decompose: true`; `computeBatchStatus.next` carries `{ phase,
  # decompose: true }`). But nothing ACTS on it: `pickNextStep` in
  # src/commands/batch/apply.ts loops only over `phaseStatus.changes`, so an empty
  # phase yields no target and `batch apply` reports "nothing ready"; and the
  # engine is change-scoped (`runChangeStep` requires a `change`), so it has no
  # path to spawn an agent for a phase. This change closes that gap: the apply
  # command surfaces the decomposition step and the engine drives it by spawning a
  # delegating agent, honoring `delegated-lifecycle` (the engine ORCHESTRATES the
  # decomposition spawn; the canonical skill AUTHORS the change intents).

  Background:
    Given a batch manifest with multiple ordered phases
    And the first phase is fully done (its changes are tasks-checked and verify-journaled)
    And a later phase is ungated (its prior phases are all done) with an empty `changes` list

  Scenario: apply surfaces the reachable empty phase as a decomposition step
    Given `ratchet batch apply` is invoked on this batch
    When it picks the next runnable step
    Then the selected step is the reachable empty phase's decomposition step
    And it is not reported as "nothing ready"

  Scenario: apply spawns a delegating agent for the empty phase, not a change-scoped one
    Given `ratchet batch apply` has selected the reachable empty phase's decomposition step
    When it runs the decomposition step
    Then exactly ONE agent is spawned for the empty phase
    And its instructions invoke the canonical decomposition skill rather than re-describing the steps inline
    And the instructions inject the empty phase's goal/success/proof-of-work and the prior phase's shipped results so the delegation is context-preserving

  Scenario: the decomposition agent authors concrete change intents into `batch.yaml`
    Given the spawned decomposition agent writes the phase's concrete change intents
    When the decomposition step completes
    Then the previously-empty phase's `changes` list in `batch.yaml` now holds one or more concrete change intents
    And each authored change intent carries a non-empty `done`

  Scenario: the canonical decomposition skill is guaranteed present before the agent is told to invoke it
    Given the spawn locus does not yet contain the canonical decomposition command
    When `ratchet batch apply` runs the decomposition step
    Then the engine renders/guarantees that command in the spawn locus before spawning
    And a locus it cannot render into fails with a clear, actionable bootstrap message instead of instructing the agent to invoke a skill it cannot run
