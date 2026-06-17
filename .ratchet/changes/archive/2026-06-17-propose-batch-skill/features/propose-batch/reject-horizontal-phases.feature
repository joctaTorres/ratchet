Feature: Reject horizontal, infra-only phases in favor of vertical slices
  As an engineer who wants early customer feedback
  I want the skill to refuse phases that ship nothing runnable
  So that every phase delivers working software instead of waterfall layers

  Background:
    Given the propose-batch workflow skill is driving phase definition

  Scenario: Reject an infra-only phase that produces nothing a user can run
    Given the user proposes a phase like "set up the database" that ships no runnable behavior
    When the skill evaluates the proposed phase
    Then it rejects the phase as a horizontal, infra-only slice
    And it explains that the phase produces nothing a user can run
    And it guides the user to reshape it into a vertical slice that ships functional software

  Scenario: Reject a "build all the models" phase and propose a thin end-to-end slice instead
    Given the user proposes a phase that only builds shared models or scaffolding
    When the skill evaluates the proposed phase
    Then it rejects the phase
    And it counter-proposes a thin end-to-end slice that exercises only the models needed to ship one runnable behavior

  Scenario: Accept a phase that ships a runnable vertical slice
    Given the user proposes a phase that ships a feature a user can exercise end to end
    When the skill evaluates the proposed phase
    Then it accepts the phase as a valid vertical slice
