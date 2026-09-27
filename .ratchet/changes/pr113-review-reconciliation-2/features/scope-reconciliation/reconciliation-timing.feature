Feature: Originating-issue reconciliation runs in two phases at the right moments
  As an author following a generated change-authoring workflow
  I want the issue's requirements enumerated before I author and mapped after I author
  So that no workflow has to patch around a reconciliation step that claims to run at one time but describes work that can only happen at another

  Scenario: Propose enumerates issue requirements before any artifact is created
    Given the generated propose workflow body
    When an author reads it from the top
    Then the step that identifies, fetches, and enumerates every originating issue's material requirements appears before the step that creates the change directory
    And that step does not ask the author to map requirements to feature scenarios or plan tasks

  Scenario: Propose maps and surfaces requirements only after the artifacts are authored
    Given the generated propose workflow body
    When an author reaches the point where the artifacts have been written
    Then the body asks the author to map every enumerated requirement to an authored feature scenario or plan task
    And to list every uncovered requirement explicitly
    And to surface each uncovered requirement as an "issue asks X, this proposal does not include X" decision point before the artifacts are called done
    And that mapping-and-surfacing instruction appears after the artifact-creation instructions

  Scenario: Propose-batch maps requirements onto the drafted manifest before it is scaffolded
    Given the generated propose-batch workflow body
    When an author reads the manifest reconciliation step
    Then the requirements are enumerated before the manifest is drafted
    And the mapping target is named as each phase goal, each phase success criterion, and each change-level done
    And every uncovered requirement is surfaced to the user before the batch is scaffolded

  Scenario: The mapping-and-surfacing text is shared, not restated per workflow
    Given the generated propose and propose-batch workflow bodies
    When the mapping-and-surfacing instructions are compared
    Then both bodies contain the same shared mapping-and-surfacing text verbatim
    And neither body carries a hand-written restatement of the rule that authored scope must be mapped and uncovered requirements surfaced
