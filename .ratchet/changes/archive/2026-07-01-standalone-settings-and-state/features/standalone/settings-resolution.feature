Feature: Standalone change-step settings resolve flag → project config → default
  As a headless verb that advances a single change with no batch manifest
  I want adapter, locus, and image resolved by cascading an explicit flag over
  the project config over the built-in default
  So that runChangeStep can be driven without a manifest while still honouring
  .ratchet/config.yaml and the same defaults batch settings use

  Background:
    Given a project with no batch manifest selected

  Scenario: With no flags and no project config, defaults are used
    Given .ratchet/config.yaml defines no batch settings
    When standalone change-step settings are resolved with no overrides
    Then locus is the built-in default "local"
    And agent is the built-in default adapter
    And image is unset

  Scenario: Project config overrides the built-in default
    Given .ratchet/config.yaml sets batch locus "docker" and image "node:20"
    When standalone change-step settings are resolved with no overrides
    Then locus is "docker"
    And image is "node:20"

  Scenario: An explicit flag wins over project config and default
    Given .ratchet/config.yaml sets batch locus "docker"
    When standalone change-step settings are resolved with the locus flag "local"
      and the agent flag "codex"
    Then locus is the flag value "local"
    And agent is the flag value "codex"

  Scenario: An invalid flag value is rejected before any agent is spawned
    When standalone change-step settings are resolved with an invalid locus flag
    Then resolution fails with an actionable error naming the allowed locus values
    And no agent is spawned

  Scenario: Resolved settings feed runChangeStep with no batch
    Given .ratchet/config.yaml sets batch locus "docker" and image "node:20"
    And an injected agent runtime so no real agent is spawned
    When runChangeStep runs a forced transition with no batch using the resolved settings
    Then the engine selects the runtime from the resolved locus and image
    And exactly one agent is spawned for the forced transition
