Feature: batch config states the real isolation per locus
  As an operator running batches
  I want `ratchet batch config` to describe what the resolved locus actually isolates
  So that I never mistake an advisory posture for a real sandbox

  Scenario: local locus is rendered as advisory with no isolation
    Given a project whose resolved batch locus is "local"
    When I run `ratchet batch config`
    Then the output renders an isolation line for the local locus
    And it states the local locus is advisory with no filesystem or network isolation
    And it states the agent environment is scoped to the env allowlist

  Scenario: docker locus is rendered as container isolation with its contract
    Given a project whose resolved batch locus is "docker"
    When I run `ratchet batch config`
    Then the output renders an isolation line for the docker locus
    And it states the docker locus provides container isolation with the configured uid, memory, pids, and network policy
    And it states the repository mount stays writable by design

  Scenario: remote locus is rendered as a server boundary
    Given a project whose resolved batch locus is "remote"
    When I run `ratchet batch config`
    Then the output renders an isolation line for the remote locus
    And it states isolation is the remote server's boundary, not one ratchet enforces

  Scenario: JSON output carries the isolation description machine-readably
    Given a project whose resolved batch locus is "local"
    When I run `ratchet batch config --json`
    Then the JSON payload includes an isolation field describing the local locus as advisory
