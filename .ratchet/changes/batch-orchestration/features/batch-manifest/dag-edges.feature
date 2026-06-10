Feature: Declare execution order with dependency edges
  As a developer sequencing related changes
  I want each batch entry to optionally declare "after" edges to other entries
  So that serial chains, parallel fan-out, and mixed orderings are all expressible

  Scenario: Serial execution is a chain of after edges
    Given a batch manifest with changes:
      | name           | after          |
      | add-user-model |                |
      | add-login-api  | add-user-model |
      | add-oauth      | add-login-api  |
    When the batch graph is computed
    Then only "add-user-model" is ready
    And "add-login-api" and "add-oauth" are blocked

  Scenario: Parallel execution is the absence of edges
    Given a batch manifest with changes:
      | name           | after |
      | add-audit-log  |       |
      | add-metrics    |       |
      | add-tracing    |       |
    When the batch graph is computed
    Then all three changes are ready

  Scenario: A cycle in after edges is rejected
    Given a batch manifest where "change-a" is after "change-b"
    And "change-b" is after "change-a"
    When the batch graph is computed
    Then the command fails naming the changes involved in the cycle

  Scenario: An after edge referencing a change outside the batch is rejected
    Given a batch manifest where "add-login-api" is after "not-in-this-batch"
    When the batch graph is computed
    Then the command fails identifying "not-in-this-batch" as an unknown batch entry

  Scenario: Edges can be edited mid-flight without losing progress
    Given a batch where "add-user-model" is done and "add-oauth" is blocked after it
    When I add a new change "add-sso" to the manifest with no after edges
    Then the next status invocation shows "add-sso" as ready
    And the status of all previously listed changes is unaffected
