Feature: Engine resolves each transition through the parsed agent spec
  As a batch user routing lifecycle stages with `agent[:model]` specs
  I want the engine to parse the resolved spec once per transition
  So that the adapter is resolved by the agent part and a named model reaches
  the spawn, while unknown agents still fail before any process starts

  Scenario: Spec-form value resolves the adapter by its agent part and threads the model
    Given resolved settings whose agent maps the "apply" stage to "opencode:zai/glm-5.2"
    When the engine builds the spawn request for an "apply" transition
    Then the resolved adapter is the "opencode" adapter
    And the request context handed to the adapter carries model "zai/glm-5.2"

  Scenario: Bare agent name threads no model
    Given resolved settings whose agent is the scalar "claude"
    When the engine builds the spawn request for a "propose" transition
    Then the request context handed to the adapter carries no model
    And the spawn argv is byte-for-byte identical to the argv before this change

  Scenario: Unset agent still falls back to the default adapter with no model
    Given resolved settings with no agent value
    When the engine builds the spawn request for a transition
    Then the default adapter is resolved
    And the request context handed to the adapter carries no model

  Scenario: Unknown agent part still throws before any spawn
    Given resolved settings whose agent is the scalar "rex:some-model"
    And "rex" is not a registered adapter
    When the engine builds the spawn request for a transition
    Then an UnknownAgentError names "rex" and lists the available adapters
    And no process is spawned

  Scenario: Instruction invocation tokens resolve through the agent part of a spec
    Given resolved settings whose agent maps the "apply" stage to a spec-form value
    When the engine builds the instructions for an "apply" transition
    Then the /rct invocation token is rendered with the mapped agent's own syntax
    And not with the default agent's syntax

  Scenario: Spawn-locus guarantee resolves the command adapter by the agent part
    Given resolved settings whose agent maps a stage to "claude:fable"
    When the engine ensures the stage's command exists in the spawn locus
    Then the guarantee resolves the "claude" command adapter
    And does not skip the stage as a synthetic agent with no command surface
