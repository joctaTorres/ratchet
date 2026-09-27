Feature: The reconciliation procedure is demonstrated on a worked example
  As a maintainer who has seen a scope reduction escape review once already
  I want a runnable check that replays the failure on the hardened workflows
  So that the reconciliation rules are demonstrated to work rather than merely asserted

  Background:
    Given an eval fixture holding the originating issue's text, the phase-one manifest excerpt that hard-codes the close-claim, and the phase-one change plan carrying the out-of-scope bullet
    And an eval spec that binds this scenario to that fixture

  Scenario: Replaying the worked example flags all three escapes
    Given the hardened propose and propose-batch reconciliation procedure
    When the procedure is applied to the fixture's issue text and the fixture's manifest and plan
    Then it flags the issue's gating requirement as present in the issue and absent from the authored scope
    And it flags the permission-posture bypass named in the issue's narrative as absent from the authored scope
    And it flags the manifest's hard-coded close-claim as premature because the issue's material requirements are not all implemented
    And it reports each of the three as a decision point requiring the user rather than a self-approved omission

  Scenario: The hedged wording in the issue does not lower the bar
    Given the fixture's issue text phrases its gating requirement as something to "consider"
    When the reconciliation procedure enumerates that issue's material requirements
    Then the hedged requirement is still enumerated as material because the exposure is security-relevant
    And the procedure does not treat the hedge as permission to drop the requirement

  Scenario: The check is runnable and its verdict is recorded
    Given the eval spec bound to this scenario
    When the eval is run for this case
    Then the run produces a recorded verdict for the case
    And the verdict is available as evidence that the worked example was actually replayed
