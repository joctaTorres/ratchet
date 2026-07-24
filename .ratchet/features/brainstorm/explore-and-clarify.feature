Feature: Explore project context and clarify the idea
  As a developer with a rough idea
  I want the brainstorm workflow to ground itself in the project and ask focused questions
  So that the design is built on real context, not assumptions

  Background:
    Given the ratchet-brainstorm skill (command /rct:brainstorm) is invoked

  Scenario: Explore project context before anything else
    Given the user describes a rough idea
    When the brainstorm workflow begins
    Then it first explores the project context by checking files, docs, and recent commits
    And it does this before asking any clarifying questions or proposing approaches

  Scenario: Ask clarifying questions one at a time
    Given the project context has been explored
    When the workflow refines the idea with the user
    Then it asks clarifying questions one at a time
    And it asks at most one question per message
    And it focuses on purpose, constraints, and success criteria
    But it does not overwhelm the user with multiple questions at once

  Scenario: Prefer multiple-choice but allow open-ended questions
    Given the workflow needs to clarify a decision
    When it phrases a clarifying question
    Then it prefers a multiple-choice form when the options are enumerable
    And it falls back to an open-ended question when multiple choice does not fit

  Scenario: Structured-question tooling is optional with a plain-prose fallback
    Given the coding agent may or may not have a structured-question tool such as AskUserQuestion
    When the workflow asks a clarifying question
    Then it uses the structured-question tool if the agent has one
    But it asks in plain prose when the agent has no such tool
    And the workflow proceeds identically either way

  Scenario: Existing codebase work explores current patterns first
    Given the idea modifies an existing codebase
    When the workflow forms the design
    Then it explores current structure and patterns first
    And it folds in only targeted improvements that serve the goal
    But it does not propose unrelated refactoring
