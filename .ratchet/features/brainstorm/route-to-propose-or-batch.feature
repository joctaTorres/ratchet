Feature: Route to propose or propose-batch after design approval
  As a developer with an approved design
  I want the workflow to recommend the right next door and chain in only on my approval
  So that a single change goes to propose and a big effort goes to propose-batch

  Background:
    Given the ratchet-brainstorm skill (command /rct:brainstorm) is invoked
    And the design has been approved by the user

  Scenario: Terminal step is design approval, then routing
    Given the design has just been approved
    When the workflow reaches its terminal step
    Then its terminal step is to recommend a route and route there
    And it does no implementation itself

  Scenario: Recommend propose for a single cohesive change
    Given the approved work is a single, cohesive change
    When the workflow recommends where to go next
    Then it recommends /rct:propose
    And it explains why a single change is the right fit

  Scenario: Recommend propose-batch for a big effort to split
    Given the approved work is big and should be split into multiple changes
    When the workflow recommends where to go next
    Then it recommends /rct:propose-batch
    And it explains why the effort should be split into phases

  Scenario: Routing is an explicit gate, never automatic
    Given the workflow has a recommended route
    When it presents the recommendation
    Then it presents an explicit gate asking before chaining in
    And it never chains in automatically
    And on approval it chains into the chosen command

  Scenario: Does not split a big request into separate sub-project spec cycles
    Given the approved work is large
    When the workflow handles the big request
    Then it routes the big request to /rct:propose-batch for phase slicing
    But it does not decompose the request into separate sub-projects each with its own spec, plan, and implementation cycle

  Scenario: Does not hand off to writing-plans or any implementation skill
    Given the design has been approved
    When the workflow finishes
    Then it invokes no skill other than /rct:propose or /rct:propose-batch
    And it does not hand off to a writing-plans skill or any implementation skill
    And it writes no design doc, runs no spec self-review, and gates no separate written-spec review
