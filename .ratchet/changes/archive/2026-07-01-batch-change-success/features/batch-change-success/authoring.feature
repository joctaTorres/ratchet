Feature: Author per-change success criteria
  As a batch author using propose-batch
  I want the authoring guidance and the manifest template to document per-change success
  So that newly scaffolded manifests can give each change a short, clear success criterion

  Scenario: The manifest template documents the optional per-change success field
    Given the batch manifest template shipped with the schema
    When an author opens it to write phase-one change intents
    Then the template's changes example shows an optional "success" field on a change intent
    And the field is annotated as a short, clear criterion

  Scenario: Propose-batch guidance offers a short per-change success criterion
    Given the shared propose-batch workflow content
    When it describes how to write phase-one change intents
    Then it states that each change intent may carry a short, clear "success" criterion
    And the guidance keeps the field optional so existing manifests stay valid

  Scenario: The authoring surface is rendered for every supported agent
    Given the supported-tools registry
    When the propose-batch workflow is generated
    Then the per-change success guidance appears in the workflow rendered for each registered agent
