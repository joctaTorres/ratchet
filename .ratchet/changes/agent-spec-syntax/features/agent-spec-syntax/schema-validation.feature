Feature: Agent setting validates agent[:model] specs at every string position
  As a batch user
  I want every string value of the agent setting checked as an agent[:model] spec at config load
  So that a malformed spec fails fast naming the offending value instead of surfacing at spawn time

  # Every string position of the `agent` setting — the scalar form and each
  # stage-map value, at BOTH config scopes (project config `batch.agent` and the
  # manifest `settings.agent` override) — validates through one refinement that
  # calls the same parseAgentSpec parser. Validation accepts the widened spec
  # form without changing what the schema STORES: values remain whole spec
  # strings, so the existing nearest-wins per-stage merge moves agent and model
  # atomically across scopes.

  Background:
    Given the shared AgentSettingSchema validates the agent setting at the project-config scope and the manifest scope

  Scenario: A scalar agent:model spec is accepted at both scopes
    Given the agent setting "claude:fable"
    When the setting is validated at each scope
    Then validation succeeds at both scopes
    And the resolved value is the whole spec string "claude:fable"

  Scenario: A stage-map with agent:model spec values is accepted at both scopes
    Given the agent setting map with propose "claude:fable", apply "opencode:zai/glm-5.2", and verify "opencode:qwen/qwen-3.7"
    When the setting is validated at each scope
    Then validation succeeds at both scopes
    And each stage value is preserved as its whole spec string

  Scenario: Existing bare-name configs validate unchanged
    Given the agent setting "opencode"
    And the agent setting map with apply "opencode"
    When each setting is validated at each scope
    Then validation succeeds exactly as before the spec syntax existed

  Scenario Outline: A malformed scalar spec is rejected at config load naming the offending value
    Given the agent setting "<spec>"
    When the setting is validated at each scope
    Then validation fails at both scopes
    And the failure message contains "<spec>"

    Examples:
      | spec    |
      | claude: |
      | :fable  |

  Scenario: A malformed spec inside a stage-map value is rejected naming the offending value
    Given the agent setting map with apply ":fable"
    When the setting is validated at each scope
    Then validation fails at both scopes
    And the failure message contains ":fable"

  Scenario: Per-stage resolution still returns whole spec strings
    Given the agent setting map with apply "opencode:zai/glm-5.2"
    When resolveAgentForStage resolves the "apply" stage
    Then it returns the whole spec string "opencode:zai/glm-5.2"
