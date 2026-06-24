Feature: Expose per-change success in derived batch status
  As the apply-batch orchestrator relaying state to the user
  I want each change's success criterion in the derived status
  So that I can surface what each change is meant to achieve without reading the manifest by hand

  Scenario: Status carries a change's success criterion when present
    Given a batch whose change intent declares a success criterion
    When the batch status is derived from disk
    And the status is rendered as JSON
    Then the change entry includes its success criterion

  Scenario: Status omits the success criterion when the change has none
    Given a batch whose change intent declares no success criterion
    When the batch status is derived from disk
    And the status is rendered as JSON
    Then the change entry carries no success criterion
