Feature: Expose per-change `done` in derived batch status
  As the apply-batch orchestrator relaying state to the user
  I want each change's `done` criterion in the derived status
  So that I can surface what each change must achieve without reading the manifest by hand

  Scenario: Status carries a change's `done` criterion
    Given a batch whose change intent declares a `done` criterion
    When the batch status is derived from disk
    And the status is rendered as JSON via `ratchet batch status --json`
    Then the change entry includes its `done` criterion

  Scenario: The status JSON exposes no per-change `success` key
    Given a batch whose change intent declares a `done` criterion
    When the batch status is rendered as JSON
    Then the change entry has a `done` key
    And the change entry has no per-change `success` key
