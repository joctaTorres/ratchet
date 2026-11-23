Feature: Look before asking and clarify why-first
  As a developer with a rough idea
  I want the brainstorm workflow to ground itself in the project, echo what it
  found, and ask only the questions whose answers change what gets built
  So that the design is built on real context and my time is never spent on
  questions the agent could answer itself

  Background:
    Given the ratchet-brainstorm skill (command /rct:brainstorm) is invoked

  Scenario: Look before asking, with a first-message echo
    Given the user describes a rough idea
    When the brainstorm workflow begins
    Then it first looks at the project context by checking files, docs, and recent commits
    And it does this before asking any question or proposing any approach
    And its first message to the user echoes what it found and what it understands of the idea

  Scenario: Why-first open questions before any options
    Given the project context has been explored and echoed
    When the workflow refines the idea with the user
    Then it opens with open questions about why — purpose, constraints, and success criteria
    And it asks open questions before presenting any set of options

  Scenario: Named options with a pick once the why is understood
    Given the workflow understands the purpose and constraints
    When a decision point has enumerable options
    Then it presents the options as named choices
    And it names its recommended pick among them with the reasoning

  Scenario: Ask only when the answer changes what gets built
    Given the workflow could ask the user a question
    When the answer would not change what gets built
    Then it does not ask the question
    And it proceeds on a stated default instead

  Scenario: Defaults are said aloud as a correctable proposal
    Given the workflow proceeds on a default rather than asking
    When it states the default
    Then it says the default aloud so the user can hear it
    And it presents the proposal as correctable — the user may override the default

  Scenario: Structured-question tooling is optional with a plain-prose fallback
    Given the coding agent may or may not have a structured-question tool such as AskUserQuestion
    When the workflow asks the user a question
    Then it uses the structured-question tool if the agent has one
    But it asks in plain prose when the agent has no such tool
    And the workflow proceeds identically either way

  Scenario: Existing codebase work explores current patterns first
    Given the idea modifies an existing codebase
    When the workflow forms the design
    Then it explores current structure and patterns first
    And it folds in only targeted improvements that serve the goal
    But it does not propose unrelated refactoring
