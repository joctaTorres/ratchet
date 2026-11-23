Feature: Honest apply scope
  As a ratchet user relying on /rct:apply to implement exactly what was
  proposed
  I want the apply workflow to never silently narrow scope and to only claim
  tasks it has evidence for
  So that a change cannot ship less than its plan and features specify while
  reporting itself complete

  Scenario: One shared body authors the apply skill and the apply command
    Given the apply-change workflow templates
    When the skill template and the command template are produced
    Then both consume the same shared body constant
    And neither carries its own divergent copy of the apply instructions

  Scenario: Scope narrowing is a stop-name-ask event, never silent
    Given the shared workflow template for apply-change
    When its body is rendered
    Then it directs the agent to stop when the specified behavior cannot be
      implemented as written, name the scope it would have to narrow, and ask
      the user before proceeding
    And it forbids silently implementing a narrower behavior than the scenario
      or task specifies
    And it treats this stop-name-ask rule as consistent with scope
      reconciliation — an unwritten intention is an omission, and omissions
      are the user's decision, never the agent's

  Scenario: A task is ticked [x] only with evidence the specified behavior is fully implemented
    Given the shared workflow template for apply-change
    When its body is rendered
    Then it directs the agent to mark a task complete in plan.md only when it
      has concrete evidence the specified behavior is fully implemented
    And it forbids ticking [x] on partial, inferred, or intended work
    And a task whose behavior is only partially implemented stays unticked and
      is reported instead

  Scenario: Apply suggests /rct:verify when all tasks are done
    Given the shared workflow template for apply-change
    When its body is rendered
    Then it directs the agent to suggest running /rct:verify once every task
      is complete, so completion claims are checked before any archive
    And it no longer presents archive as the immediate next step on completion

  Scenario: The runtime apply payload defers to the workflow's evidence and verify rules
    Given the ratchet schema's apply instruction and the apply instructions
      command
    When the apply instruction payload is produced for a ready change
    Then it ticks a task only once its specified behavior is fully
      implemented with evidence, deferring to the apply workflow rather than
      restating the rules
    And when every task is complete the payload suggests running /rct:verify
      instead of presenting archive as the next step
