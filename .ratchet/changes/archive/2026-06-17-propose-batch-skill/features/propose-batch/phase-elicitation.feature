Feature: Guided phase elicitation for a batch
  As an engineer planning a multi-change effort
  I want a guided skill that elicits the batch objective and slices it into phases
  So that I commit to phase contracts up front without freezing every change in advance

  Background:
    Given the propose-batch workflow skill is installed for the coding agent
    And the user invokes it to propose a batch

  Scenario: Explore the objective before slicing into phases
    Given the user's request does not clearly describe the batch objective
    When the skill begins
    Then it asks the user to clarify the objective using a structured-question prompt where the agent supports one, or plain prose otherwise
    And it does not scaffold a manifest until the objective is understood

  Scenario: Slice the objective into an ordered set of vertical-slice phases
    Given the batch objective is understood
    When the skill proposes phases
    Then it produces an ordered list of phases
    And each phase is described as functional, runnable software a user can exercise end to end
    And the phase ordering reflects that a later phase builds on the prior phase's shipped slice

  Scenario: Plan shallow-but-wide rather than demanding complete upfront knowledge
    Given the user cannot fully specify every change in every phase yet
    When the skill plans the batch
    Then it captures all phases as goal plus proof-of-work contracts
    And it only decomposes the earliest phase into concrete change intents
    And it does not demand a complete upfront change list for later phases
