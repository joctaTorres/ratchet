Feature: Deferrals survive phase boundaries during decomposition
  As a maintainer decomposing a later batch phase
  I want deferred scope and unearned close-claims from prior phases to reach this decomposition
  So that "revisit in the next phase" prose cannot evaporate at a phase boundary

  Scenario: Decomposition reads the prior phases' plans, not only their done criteria
    Given the decompose-phase workflow body
    When an author reads its grounding step
    Then it requires reading each prior phase's shipped change plan file in addition to the injected done criteria
    And it explains that the injected done criteria are a paraphrase in which deferrals recorded as plan prose are invisible

  Scenario: Every deferred item is extracted from the prior plans
    Given the decompose-phase workflow body
    When an author sweeps a prior phase's plan
    Then it requires extracting every out-of-scope, deferred, revisit, or equivalent item recorded there

  Scenario: Each extracted deferral gets one of exactly three outcomes
    Given the decompose-phase workflow body
    And an item extracted from a prior phase's plan
    When the author decides what to do with it
    Then the body requires the item to be carried forward as a change intent in the phase being decomposed, or matched to an existing open tracking issue and reported as tracked, or surfaced to the user as an explicit drop decision
    And it states that silently ignoring an extracted item is not an available outcome

  Scenario: A prior phase's close-claim is verified before the issue is treated as shipped
    Given the decompose-phase workflow body
    And a prior phase whose done criterion claims "Fixes #N"
    When the author grounds this phase in that prior result
    Then the body requires comparing the issue's material requirements against what the prior phase's done criterion and plan describe as implemented
    And it requires surfacing an unearned close-claim and carrying the remaining scope forward
    And it forbids inheriting the close-claim as fact

  Scenario: The decomposition rules reach every supported coding agent
    Given the decompose-phase command template
    When it is rendered through every registered tool command adapter
    Then the rendered command file for every adapter contains the prior-plan deferral sweep
    And the rendered command file for every adapter contains the earned-close verification
