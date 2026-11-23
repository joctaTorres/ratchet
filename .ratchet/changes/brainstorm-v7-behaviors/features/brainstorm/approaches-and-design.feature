Feature: Propose approaches and play back the design for approval
  As a developer refining an idea
  I want approaches in their own message, a compact playback that labels what
  the agent filled in, and a sectioned design I approve as we go
  So that the design is validated incrementally and I always know which parts
  were my decisions and which were the agent's defaults

  Background:
    Given the ratchet-brainstorm skill (command /rct:brainstorm) is invoked
    And the idea has been clarified

  Scenario: Approaches are presented in their own message
    Given the workflow understands the purpose and constraints
    When it presents how to build the idea
    Then the approaches are presented in their own message
    And that message contains no clarifying questions or other content

  Scenario: One sensible way is allowed
    Given there is genuinely one sensible approach to the idea
    When the workflow presents how to proceed
    Then it may present that single approach with its reasoning
    But it does not invent extra approaches just to reach a count

  Scenario: Real alternatives are presented with a recommendation when they exist
    Given more than one genuinely sensible approach exists
    When the workflow presents how to proceed
    Then it presents the real alternatives with their trade-offs
    And it leads with its recommended approach and explains the reasoning
    And it applies YAGNI by removing unnecessary features from each approach

  Scenario: A compact playback labels agent-filled proposals
    Given an approach has been chosen
    When the workflow plays the design back to the user
    Then the playback is a compact 200-300-word summary
    And each part the agent filled in as a default is labelled as agent-filled
    So that the user knows which parts to check rather than re-derive

  Scenario: Present the design section by section with approval gates
    Given the playback has been delivered
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
