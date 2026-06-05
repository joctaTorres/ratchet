Feature: Loading project configuration
  As a project maintainer
  I want ratchet to load .ratchet/config.yaml with safe fallbacks
  So that schema, context and rules drive the workflow without brittle parsing

  Scenario: Config exposes schema, context and rules
    Given a ".ratchet/config.yaml" defining schema, context and per-artifact rules
    When the project config is read
    Then the schema, context and rules are exposed to the workflow
    And the context size is enforced under the maximum limit

  Scenario: A missing config is acceptable
    Given a project with no ".ratchet/config.yaml" or ".ratchet/config.yml"
    When the project config is read
    Then no config is returned without raising an error
    And the workflow falls back to defaults

  Scenario: Invalid fields degrade gracefully
    Given a config file whose rules field is malformed
    When the project config is parsed
    Then the valid fields are still returned
    And the invalid field is dropped rather than failing the whole read
