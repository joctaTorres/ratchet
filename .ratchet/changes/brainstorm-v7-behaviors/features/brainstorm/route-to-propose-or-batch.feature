Feature: Route to propose or propose-batch
  As a developer whose request is ready to become a change
  I want the workflow to recognize when no dialogue is needed, let me skip
  ahead, step up a size when the effort is big, and hand the design context
  over intact
  So that a complete request goes straight to propose, a big effort goes to
  propose-batch, and nothing decided in the dialogue is lost on the way

  Background:
    Given the ratchet-brainstorm skill (command /rct:brainstorm) is invoked

  Scenario: Triage routes a complete request straight to propose
    Given the user's request already names the behavior, who does what, and what should happen
    When the workflow triages the request
    Then it routes the request straight to /rct:propose
    And it does not run the clarifying dialogue on an already-complete request

  Scenario: A skip-ahead opt-out routes to propose at any point
    Given the clarifying dialogue or design presentation is under way
    When the user asks to skip ahead
    Then the workflow stops the dialogue and routes what is known to /rct:propose
    And the user is never locked into finishing every step first

  Scenario: Step up a size to propose-batch when the effort is bigger than one change
    Given the dialogue reveals work too big for a single, cohesive change
    When the workflow decides the route
    Then it steps up a size and routes the effort to /rct:propose-batch
    And it explains why the effort should be split into phases

  Scenario: Recommend propose for a single cohesive change
    Given the approved work is a single, cohesive change
    When the workflow recommends where to go next
    Then it recommends /rct:propose
    And it explains why a single change is the right fit

  Scenario: Routing after design approval is an explicit gate, never automatic
    Given the design has been approved and the workflow has a recommended route
    When it presents the recommendation
    Then it presents an explicit gate asking before chaining in
    And it never chains in automatically
    And on approval it chains into the chosen command

  Scenario: The handoff carries the why, approaches, and non-goals
    Given the workflow routes into /rct:propose or /rct:propose-batch
    When it hands off
    Then the handoff carries the why — the purpose and constraints the dialogue established
    And it carries the approaches that were considered, including the pick
    And it carries the non-goals the user ruled out along the way

  Scenario: Terminal step is design approval, then routing
    Given the design has just been approved
    When the workflow reaches its terminal step
    Then its terminal step is to recommend a route and route there
    And it does no implementation itself

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
