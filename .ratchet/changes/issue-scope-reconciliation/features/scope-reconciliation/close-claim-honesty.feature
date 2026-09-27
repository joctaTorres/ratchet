Feature: Honest close-claims in batch manifests and change authoring
  As a maintainer reading a manifest or a plan
  I want a "Closes #N" claim to be earned rather than assumed
  So that GitHub never auto-closes an issue whose material requirements are still unimplemented

  Scenario: Propose-batch forbids hard-coding a close-claim for unscoped work
    Given the propose-batch workflow body
    When an author reads its manifest-authoring rules
    Then it forbids writing "Closes #N" or "Fixes #N" into a phase goal, a phase success criterion, or a change-level done for work that has not yet been scoped and verified
    And it states that a close-claim is an output of verification and never an input of planning

  Scenario: Phase contracts reference issues without claiming closure
    Given the propose-batch workflow body
    When an author writes a phase contract that addresses an issue
    Then the body requires the phrasing "targets #N" or "addresses #N"
    And it states that the "Closes #N" linkage is earned at pull-request-authoring time only after the issue's material requirements are confirmed implemented

  Scenario: Partial coverage is stated as partial
    Given the propose-batch workflow body
    When a change-level done criterion covers only part of an issue
    Then the body requires that done criterion to say "partially addresses #N"
    And it forbids that done criterion from saying "Fixes #N" or "Closes #N"

  Scenario: The close-claim rule is shared by all three change-authoring workflows
    Given the propose, propose-batch, and decompose-phase workflow bodies
    When each body is inspected for the close-claim rule
    Then each contains the shared rule that a close-claim is permitted only when the issue's material requirements are actually implemented
    And each contains the shared rule that partial work must use "partially addresses #N"
