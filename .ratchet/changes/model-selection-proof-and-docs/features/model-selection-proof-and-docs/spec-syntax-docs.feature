Feature: Agent model spec documentation
  As a ratchet user choosing a model per lifecycle stage
  I want the agent[:model] syntax documented in the README and the docs/ Reference
  So that I can configure it without reading the source

  Scenario: README documents the agent[:model] spec syntax
    Given the repository README describes the `agent` setting
    When a reader looks up how to route stages to agents
    Then the README states that every string value of the setting is an "agent[:model]" spec
    And it states the spec splits on the first ":" so provider/model ids pass through intact
    And it states a bare agent name emits no model flag and the agent uses its harness-configured default model
    And it states the model part is free-form pass-through while a malformed spec (empty agent or model part) is rejected at config load

  Scenario: The docs Reference documents the spec accurately for the shipped behavior
    Given the Reference doc "docs/configuration/config-yaml.md" has an "Agent [:model] spec" section
    When the per-stage-model-selection phase ships
    Then the section matches the code: first-colon split, bare-name harness default, config-load rejection naming the offending value, pass-through model validation, and each adapter's own model flag
    And the `agent` row of the batch settings table describes the spec form for both the scalar and the stage-map shape
