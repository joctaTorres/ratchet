Feature: Enriched instructions for authoring and applying
  As an agent following the ratchet workflow
  I want enriched, context-aware instructions for each artifact and for apply
  So that I produce the right artifact and implement against the right files

  Scenario: Artifact instructions return template, instruction and resolved path
    Given a change "add-login" exists
    When I run "ratchet instructions plan --change add-login --json"
    Then the JSON includes the template, the instruction text and the dependencies
    And it includes a "resolvedOutputPath" for where the plan should be written

  Scenario: Requesting instructions without an artifact lists valid artifacts
    Given a change "add-login" exists
    When I run "ratchet instructions" without naming an artifact
    Then an error reports the missing argument
    And it lists the valid artifact ids for the schema

  Scenario: Apply instructions list context files and task progress
    Given an apply-ready change "add-login"
    When I run "ratchet instructions apply --change add-login --json"
    Then the output includes "contextFiles" mapping each artifact to concrete file paths
    And it includes the parsed task list and overall progress

  Scenario: Config context and rules appear as agent constraints
    Given ".ratchet/config.yaml" defines project context and per-artifact rules
    When I fetch instructions for an artifact
    Then the context and rules are surfaced as constraints for the agent
    And they are not copied verbatim into the generated output file
