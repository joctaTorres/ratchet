Feature: Propose approaches and present the design incrementally
  As a developer refining an idea
  I want a few approaches with trade-offs and a sectioned design I approve as we go
  So that the design is validated incrementally and stays focused

  Background:
    Given the ratchet-brainstorm skill (command /rct:brainstorm) is invoked
    And the idea has been clarified

  Scenario: Propose two to three approaches with a leading recommendation
    Given the workflow understands the purpose and constraints
    When it explores how to build the idea
    Then it proposes two to three different approaches with their trade-offs
    And it leads with its recommended approach and explains the reasoning

  Scenario: Always explore alternatives before settling
    Given the workflow has an obvious first idea
    When it presents how to proceed
    Then it still presents alternatives rather than a single option
    And it applies YAGNI by removing unnecessary features from each approach

  Scenario: Present the design section by section with approval gates
    Given an approach has been chosen
    When the workflow presents the design
    Then it presents the design section by section
    And each section is scaled to its complexity
    And it asks for approval after each section before moving on

  Scenario: Revise when a section is not approved
    Given a design section has been presented
    When the user does not approve that section
    Then the workflow goes back and revises it
    And it stays flexible to clarify when something does not make sense

  Scenario: Design for isolation and clarity
    Given the workflow is shaping the design
    When it defines the units of the system
    Then it favors small, well-bounded units with clear interfaces
    And each unit can be understood and tested independently
