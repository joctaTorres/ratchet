Feature: OpenCode is a spawnable batch-engine agent
  As a ratchet batch operator
  I want OpenCode to be a first-class spawnable coding agent in the batch engine
  So that headless propose, apply, verify, and batch workflows can run driven by opencode

  Background:
    Given AI_TOOLS in src/core/config.ts is the registry of init tools
    And each AIToolOption may carry an optional agentBinary field naming a spawnable coding-agent binary

  Scenario: OpenCode declares an agentBinary in the init tool registry
    Given the init tool "opencode" in AI_TOOLS
    When the registry is inspected
    Then it declares agentBinary "opencode"
    So the engine and doctor treat it as a spawnable coding agent

  Scenario: AGENT_BINARIES includes opencode
    Given the opencode init tool declares agentBinary "opencode"
    When AGENT_BINARIES is computed from the agentBinary-marked init tools
    Then AGENT_BINARIES has the key "opencode" mapping to binary "opencode"
    And the drift-guard invariant still holds: AGENT_BINARIES keys === agentBinary-marked AI_TOOLS ids === BUILTIN_ADAPTERS keys

  Scenario: The opencode spawn adapter is registered
    Given the built-in adapter registry BUILTIN_ADAPTERS
    When resolveAdapter is called with "opencode"
    Then it returns the opencode adapter (never UnknownAgentError)
    And the adapter is a CommandAgentAdapter bound to the opencode binary via agentBinaryFor

  Scenario: The opencode adapter builds a headless run request
    Given a resolved step context with agent "opencode"
    When the adapter builds the spawn request
    Then the command is the opencode binary
    And the argv begins with "run" "--format" "json"
    And the instructions are passed on stdin
    And the step context is delegated to the canonical /rct-<transition> skill (no parallel inline prompt)

  Scenario: OpenCode is a valid --agent override on every headless verb
    Given the headless verbs propose, apply, and verify each accept a --agent flag
    When the operator passes "--agent opencode"
    Then the resolved settings select the opencode adapter
    And the engine spawns opencode for that transition

  Scenario: batch apply drives a step with opencode
    Given a batch whose resolved settings name agent "opencode"
    When the engine runs the next DAG step
    Then it spawns opencode with the transition's instructions on stdin
    And maps the journaled outcome to a structured StepResult
