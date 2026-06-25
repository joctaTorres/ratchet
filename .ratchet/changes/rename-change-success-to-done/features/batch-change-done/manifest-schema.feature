Feature: Required per-change `done` criterion in the batch manifest
  As a batch author
  I want each change intent to carry a required `done` criterion
  So that every change states what "done" means for it — and the field is named `done`, not `success`

  Scenario: A change intent with a `done` criterion parses and exposes it
    Given a batch manifest whose change intent declares a `done` of "module returns DENY unless all gate signals are green"
    When the manifest is parsed
    Then parsing succeeds
    And the change intent exposes its `done` criterion "module returns DENY unless all gate signals are green"

  Scenario: A change intent without a `done` criterion is rejected
    Given a batch manifest whose change intent has only a name and optional `after` edges
    When the manifest is parsed
    Then parsing fails with a located error naming the offending change intent's `done` field

  Scenario: An empty `done` criterion is rejected
    Given a batch manifest whose change intent declares a `done` of ""
    When the manifest is parsed
    Then parsing fails with a located error naming the offending change intent's `done` field

  Scenario: The old per-change `success` key is no longer recognized
    Given a batch manifest whose change intent declares a `success` field but no `done`
    When the manifest is parsed
    Then parsing fails because the required `done` criterion is missing
    And the change intent exposes no `success` field

  Scenario: The phase-level `success` criterion is unchanged
    Given a batch manifest whose phase declares a `success` criterion
    When the manifest is parsed
    Then parsing succeeds
    And the phase still exposes its `success` criterion
