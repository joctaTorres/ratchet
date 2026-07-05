Feature: Per-stage agent resolution and spawn
  As a ratchet user coordinating a batch
  I want each lifecycle stage to spawn the coding agent its `agent` setting maps
    to, while a scalar name and an unset `agent` keep routing every stage to one
    agent
  So that I can, for example, have claude propose while opencode applies and
    verifies, with no change to existing scalar-or-unset configurations

  Background:
    Given the batch `agent` setting is a scalar agent name or a partial
      `{propose, apply, verify}` stage-map, validated by the shared schema
    And the engine forces exactly one transition (propose, apply, or verify) per
      step and resolves the coding agent for that transition's stage before any
      spawn
    And the default agent is used whenever no scope maps the running stage

  Scenario Outline: A scalar agent routes every stage to that one agent
    Given the resolved batch `agent` is the scalar "opencode"
    When the engine builds the spawn request for the <stage> transition
    Then the adapter resolved to spawn is "opencode"
    And the invocation the agent is told to run is rendered with the "opencode"
      command adapter

    Examples:
      | stage   |
      | propose |
      | apply   |
      | verify  |

  Scenario: An unset agent routes every stage to the default agent
    Given the resolved batch `agent` is unset
    When the engine builds the spawn request for the apply transition
    Then the adapter resolved to spawn is the default agent

  Scenario Outline: A full stage-map spawns the agent mapped to each stage
    Given the resolved batch `agent` is the map:
      | stage   | agent    |
      | propose | claude   |
      | apply   | opencode |
      | verify  | opencode |
    When the engine builds the spawn request for the <stage> transition
    Then the adapter resolved to spawn is "<agent>"
    And the invocation the agent is told to run is rendered with the "<agent>"
      command adapter

    Examples:
      | stage   | agent    |
      | propose | claude   |
      | apply   | opencode |
      | verify  | opencode |

  Scenario Outline: A partial stage-map falls back to the default agent for an unmapped stage
    Given the resolved batch `agent` is the map:
      | stage | agent    |
      | apply | opencode |
    When the engine builds the spawn request for the <stage> transition
    Then the adapter resolved to spawn is "<agent>"

    Examples:
      | stage   | agent      |
      | apply   | opencode   |
      | propose | the default agent |
      | verify  | the default agent |

  Scenario: Two stage-maps at different scopes merge nearest-wins per stage
    Given the project-config batch `agent` is the map:
      | stage   | agent  |
      | propose | claude |
      | apply   | claude |
    And the manifest batch `agent` is the map:
      | stage | agent    |
      | apply | opencode |
    When the batch settings are resolved
    Then the resolved `agent` routes propose to "claude"
    And the resolved `agent` routes apply to "opencode"
    And the resolved `agent` routes verify to the default agent

  Scenario: A partial stage-map merges over a scalar base from a lower scope
    Given the project-config batch `agent` is the scalar "claude"
    And the manifest batch `agent` is the map:
      | stage | agent    |
      | apply | opencode |
    When the batch settings are resolved
    Then the resolved `agent` routes apply to "opencode"
    And the resolved `agent` routes propose to "claude"
    And the resolved `agent` routes verify to "claude"

  Scenario: A nearer scalar overrides a farther stage-map for every stage
    Given the project-config batch `agent` is the map:
      | stage   | agent  |
      | propose | claude |
    And the manifest batch `agent` is the scalar "opencode"
    When the batch settings are resolved
    Then the resolved `agent` routes propose to "opencode"
    And the resolved `agent` routes apply to "opencode"
    And the resolved `agent` routes verify to "opencode"

  Scenario Outline: An unknown agent mapped to a stage is rejected before any spawn
    Given the resolved batch `agent` maps the <stage> stage to the unknown agent "nope"
    When the engine builds the spawn request for the <stage> transition
    Then resolution fails naming the unknown agent and the available adapters
    And no agent process is spawned

    Examples:
      | stage   |
      | propose |
      | apply   |
      | verify  |

  Scenario: An invalid stage key is rejected when settings are resolved, before any spawn
    Given a batch `agent` map that names a stage key other than propose, apply, or verify
    When the batch settings are loaded
    Then validation fails naming the invalid stage key
    And no agent process is spawned

  Scenario: The decomposition step (not a lifecycle stage) uses the scalar or default agent
    Given the resolved batch `agent` is the map:
      | stage | agent    |
      | apply | opencode |
    When the engine builds the spawn request for a phase-decomposition step
    Then the adapter resolved to spawn is the default agent
    And the stage-map's per-stage entries do not affect the decomposition agent
