Feature: Per-step env reaches the agent spawned by the rex runtimes
  As a batch engine operator
  I want the env the engine places on AgentSpawnRequest.env to be applied to the
  agent command launched by both rex runtimes
  So that per-step environment variables (and future env-based hardening) are
  actually in effect inside the spawned agent, honoring the documented contract

  Scenario: Sidecar runtime applies request env to the launched agent command
    Given the engine builds an AgentSpawnRequest with env entry "RATCHET_STEP_VAR=from-engine"
    When the rex sidecar runtime constructs the run-op command for the agent
    Then the run-op command exports "RATCHET_STEP_VAR" with value "from-engine" before invoking the agent
    And executing that command in a shell makes "RATCHET_STEP_VAR=from-engine" observable to the agent process

  Scenario: Remote runtime applies request env to the launched agent command
    Given the engine builds an AgentSpawnRequest with env entry "RATCHET_STEP_VAR=from-engine"
    When the rex remote runtime constructs the launch command it executes on the server
    Then the launch command exports "RATCHET_STEP_VAR" with value "from-engine" before invoking the agent
    And executing that command in a shell makes "RATCHET_STEP_VAR=from-engine" observable to the agent process

  Scenario: Request env overlays the runtime session's base environment
    Given a runtime session whose base environment already defines "SHARED_VAR=from-session"
    And an AgentSpawnRequest whose env defines "SHARED_VAR=from-request"
    When the runtime launches the agent command
    Then the agent observes "SHARED_VAR=from-request"
    And base-environment variables absent from the request env remain visible to the agent
