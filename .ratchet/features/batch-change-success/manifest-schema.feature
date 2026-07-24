Feature: Per-change success criterion in the batch manifest
  As a batch author
  I want each change intent to carry its own short success criterion
  So that every change in a phase states what "done" means for it, not just the phase

  Scenario: A change intent with a success criterion is parsed and retained
    Given a batch manifest whose phase has a change intent with name "release-decision-module" and a "success" of "module returns DENY unless all gate signals are green"
    When the manifest is parsed
    Then parsing succeeds
    And the change intent "release-decision-module" exposes its success criterion "module returns DENY unless all gate signals are green"

  Scenario: A change intent without a success criterion stays valid
    Given a batch manifest whose change intent has only a name and optional "after" edges
    When the manifest is parsed
    Then parsing succeeds
    And that change intent has no success criterion

  Scenario: An empty success criterion is rejected
    Given a batch manifest whose change intent declares a "success" of ""
    When the manifest is parsed
    Then parsing fails with a located error naming the offending change intent's success field
