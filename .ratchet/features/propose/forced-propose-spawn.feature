Feature: `ratchet propose` drives a forced propose transition through runChangeStep
  As the propose verb sitting on top of the change-scoped engine core
  I want to resolve standalone settings, force the propose transition, append
  any -m guidance, and run exactly one agent via runChangeStep
  So that propose shares the same single-step code path as batch apply while
  writing run state change-locally with no batch in sight

  Background:
    Given a project with no batch manifest selected
    And an injected agent runtime so no real agent is spawned

  Scenario: Propose forces the propose transition and runs one agent
    When I run `ratchet propose "Add a doctor command"`
    Then runChangeStep is called with a ChangeStepContext whose transition is "propose"
    And the context carries no batch, so the run-state locus is change-local
    And exactly one agent is spawned for the forced propose transition

  Scenario: Settings are resolved standalone (flag → project config → default)
    Given .ratchet/config.yaml sets batch locus "docker" and image "node:20"
    When I run `ratchet propose "Add a doctor command" --locus local`
    Then the resolved settings come from resolveChangeStepSettings, not a manifest
    And the explicit locus flag "local" wins over the project config "docker"
    And the engine selects the runtime from the resolved locus and image

  Scenario: -m guidance is appended to the agent instructions
    When I run `ratchet propose "Add a doctor command" -m "keep it to a single file"`
    Then the built instructions include the appended guidance "keep it to a single file"
    And the guidance appears as additional direction for the propose transition
    And exactly one agent is spawned

  Scenario: Run state is written under the change-local .run directory
    When I run `ratchet propose "Add a doctor command"`
    Then the journal outcome entry is written under
      ".ratchet/changes/<derived-name>/.run/journal.jsonl"
    And nothing is written under ".ratchet/batches/"

  Scenario: A clean agent exit reports the proposed change; a failure stays resumable
    Given an injected runtime whose agent records a completion and exits zero
    When I run `ratchet propose "Add a doctor command"`
    Then the command reports the change advanced through propose
    But given instead an agent that exits non-zero without completing
    Then the command surfaces a blocked result that remains resumable
