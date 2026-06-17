Feature: Locus defaults to local and runs via the ReX sidecar
  As a developer
  I want the execution locus to default to local and drive the ReX sidecar
  So that batch steps run through SWE-ReX without any extra configuration

  Scenario: Unset locus resolves to local
    Given a project with no execution locus configured
    When the batch settings are resolved
    Then the effective execution locus is "local"
    And the source of the value is "default"

  Scenario: A project-level locus setting is honored
    Given a project config that sets the execution locus to "local"
    When the batch settings are resolved
    Then the effective execution locus is "local"
    And the source of the value is "project"

  Scenario: The local locus selects the ReX sidecar runtime
    Given the resolved execution locus is "local"
    When the engine selects an AgentRuntime for a step
    Then it selects the RexSidecarRuntime
    And the runtime is launched with REX_LOCUS set to "local"
    And the runtime is launched with REX_WORKDIR set to the project root

  Scenario: The sidecar lifecycle is driven start to clean shutdown
    Given a fake sidecar child that emits a ready event
    When the runtime runs a step
    Then the runtime waits for the ready event before sending a run op
    And the runtime sends exactly one run op carrying the agent command
    And after the exit event the runtime sends a shutdown op
    And the runtime awaits the closed event and tears down the child
