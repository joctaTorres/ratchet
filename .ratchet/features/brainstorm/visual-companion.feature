Feature: Offer a visual companion just-in-time, capability-gated
  As a developer working through a design
  I want visuals offered only when a question is genuinely clearer shown than told
  So that I am not burdened upfront and text-only agents still work

  Background:
    Given the ratchet-brainstorm skill (command /rct:brainstorm) is invoked
    And ratchet bundles no browser companion server

  Scenario: Never offer the visual companion upfront
    Given the brainstorm workflow has just begun
    When it starts exploring context and asking questions
    Then it does not offer any visual companion upfront

  Scenario: Offer the visual aid the first time a question is genuinely visual
    Given the workflow reaches a question that would be clearer shown than told
    And the agent or environment can show visuals such as mockups, diagrams, or comparisons
    When that visual question first arises
    Then the workflow offers the optional visual aid just-in-time
    And the offer is sent as its own message containing only the offer
    And it waits for the user's response before continuing

  Scenario: Continue text-only when visuals are unavailable
    Given the agent or environment cannot show visuals
    When a question that could be visual arises
    Then the workflow continues text-only using plain prose
    And it does not depend on any superpowers companion server or file

  Scenario: Decide per question whether visual or text is better
    Given the user has accepted the optional visual aid
    When the workflow prepares each subsequent question
    Then it decides per question whether a visual or text form is clearer
    And it uses a visual for genuinely visual questions such as a wireframe, layout, or diagram choice
    But it uses text for conceptual, tradeoff, or scope questions
