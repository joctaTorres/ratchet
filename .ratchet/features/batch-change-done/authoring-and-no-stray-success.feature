Feature: Author the required per-change `done` and leave no stray per-change `success`
  As a batch author and maintainer
  I want the template, guidance, manifests, and docs to use a required `done`
  So that the rename is complete and no per-change `success` lingers anywhere

  Scenario: The manifest template documents the required per-change `done`
    Given the batch manifest template shipped with the schema
    When an author opens it to write change intents
    Then the template's changes example shows a required `done` field on each change intent
    And the template no longer shows a per-change `success` field

  Scenario: Propose-batch guidance requires a per-change `done`
    Given the shared propose-batch workflow content
    When it describes how to write phase-one change intents
    Then it states that each change intent must carry a `done` criterion
    And it no longer describes an optional per-change `success` criterion

  Scenario: Existing manifests carry a `done` on every change intent
    Given the batch manifests checked into the repo and the eval fixtures
    When their change intents are inspected
    Then every change intent declares a `done` criterion
    And no change intent declares a `success` field

  Scenario: No per-change `success` remains in the codebase
    Given the source, tests, templates, and docs
    When references to a per-change `success` field are searched for
    Then none remain
    And only the unrelated phase-level `success` criterion is still present
