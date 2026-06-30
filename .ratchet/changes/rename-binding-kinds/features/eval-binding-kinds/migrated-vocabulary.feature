Feature: Migrated eval vocabulary is dogfooded everywhere
  As a ratchet maintainer
  I want ratchet's own eval specs, fixtures, docs, and shipped skill template on the new kinds
  So that the rename is applied end-to-end and no stale vocabulary remains anywhere ratchet ships

  Scenario: Ratchet's own eval specs are migrated to the new kinds
    Given the eval-spec files under .ratchet/evals/specs/
    When I inspect every binding kind they declare
    Then each binding kind is either "deterministic" or "llm-judge"
    And no binding declares the legacy kind "check" or "agent"

  Scenario: Ratchet's own migrated specs enumerate green under the new system
    Given ratchet's own feature store in scope
    When I run "ratchet eval set --json"
    Then every bound case reports a binding of "deterministic" or "llm-judge"
    And no bound case reports a binding of "check" or "agent"

  Scenario: The shipped eval skill template uses the new vocabulary for every supported agent
    Given the supported coding agents in the tool registry
    When the eval skill is generated for each agent via ratchet init
    Then each agent's generated eval skill describes bindings as "deterministic" or "llm-judge"
    And no generated eval skill mentions the legacy kinds "check" or "agent"
