Feature: Config-to-argv model selection proof
  As a ratchet user configuring per-stage agent models
  I want an integration suite proving the whole config-to-argv path
  So that a spec I write in config demonstrably lands on the spawned agent's argv

  # Phase proof-of-work for per-stage-model-selection:
  #   pnpm test test/batch-engine/agent-model-selection.test.ts  (exit 0)
  # The suite drives the REAL builtin adapters through the engine over a tmpdir
  # fixture with an injected fake Spawner — asserting on the captured spawn argv,
  # never on parser internals already proven at the unit level.

  Scenario: Per-stage specs emit each agent's model flag with the exact model string
    Given a batch whose resolved settings map stages to specs "propose: claude:fable", "apply: opencode:zai/glm-5.2", and "verify: opencode:qwen/qwen-3.7"
    When the engine advances each of the propose, apply, and verify transitions
    Then the propose spawn runs the claude adapter with "--model" "fable" on its argv
    And the apply spawn runs the opencode adapter with "--model" "zai/glm-5.2" on its argv
    And the verify spawn runs the opencode adapter with "--model" "qwen/qwen-3.7" on its argv

  Scenario: A scalar spec covers every lifecycle stage
    Given a batch whose resolved settings set the scalar agent spec "claude:fable"
    When the engine advances each of the propose, apply, and verify transitions
    Then every captured spawn argv carries "--model" "fable"

  Scenario: A dash-m agent's spec emits its -m flag end to end
    Given a batch whose resolved settings set the scalar agent spec "codex:gpt-5.2-codex"
    When the engine advances the apply transition
    Then the spawn runs the codex adapter with "-m" "gpt-5.2-codex" on its argv

  Scenario: A bare agent name emits no model flag and leaves argv byte-for-byte unchanged
    Given a batch whose resolved settings set the bare agent name "claude"
    When the engine advances the apply transition
    Then the captured spawn argv contains no "--model" flag
    And the argv is byte-for-byte identical to the argv captured with no agent setting configured

  Scenario: Nearest-wins per-stage merge moves agent and model atomically across scopes
    Given a project config whose batch agent is the scalar spec "claude:fable"
    And a batch manifest whose settings map "apply" to "opencode:zai/glm-5.2"
    When the engine advances the propose and apply transitions with the resolved settings
    Then the propose spawn runs the claude adapter with "--model" "fable"
    And the apply spawn runs the opencode adapter with "--model" "zai/glm-5.2" and carries no trace of "fable"

  Scenario: An empty model part fails config load naming the offending value
    Given a project config ".ratchet/config.yaml" whose batch agent value is "claude:"
    When the project config is loaded
    Then loading fails before any spawn with a message naming "claude:"

  Scenario: An empty agent part fails manifest load naming the offending value
    Given a batch manifest whose settings map "verify" to ":fable"
    When the manifest is loaded
    Then loading fails before any spawn with a message naming ":fable"
