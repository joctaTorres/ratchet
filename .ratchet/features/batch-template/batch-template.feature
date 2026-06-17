Feature: Batch template and agent guidance
  As an agent or developer authoring a batch
  I want a canonical batch template with schema-driven guidance
  So that batches are generated consistently yet remain hand-editable plain YAML

  Scenario: Print the canonical batch template
    Given the ratchet schema includes a batch template
    When I run "ratchet template batch"
    Then the canonical batch manifest template is printed
    And it documents the changes list and the optional after edges

  Scenario: Scaffolded batches start from the template
    Given a planning home with a .ratchet directory
    When I run "ratchet batch new perf-sweep"
    Then the created batch.yaml matches the structure of the canonical template

  Scenario: A hand-edited manifest is a first-class manifest
    Given a batch.yaml written by hand without using any ratchet command
    And it contains a valid changes list with after edges
    When I run "ratchet batch status" for that batch
    Then the manifest is accepted exactly as if it had been scaffolded

  Scenario: Validating a batch manifest
    Given a batch.yaml with a malformed changes entry
    When I run "ratchet validate" for that batch
    Then validation reports the malformed entry with its location
    And valid entries in the same manifest are not reported as errors
