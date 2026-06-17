Feature: Require success criteria and proof-of-work per phase
  As an engineer who wants errors caught early
  I want every phase to carry an executable proof-of-work before it is scaffolded
  So that each phase boundary is verified rather than assumed

  Background:
    Given the propose-batch workflow skill is defining phases for a batch

  Scenario: Refuse to scaffold a phase that lacks success criteria
    Given a proposed phase that has a goal but no success criteria
    When the skill is asked to scaffold the manifest
    Then it refuses to scaffold the phase
    And it grills the user for the phase's success criteria before continuing

  Scenario: Refuse to scaffold a phase that lacks a proof-of-work
    Given a proposed phase that has a goal and success criteria but no proof-of-work
    When the skill is asked to scaffold the manifest
    Then it refuses to scaffold the phase
    And it requires the user to declare a proof-of-work kind of "integration", "blackbox", or "llm-judge"

  Scenario: Phase one carries a concrete, runnable proof-of-work
    Given phase one whose software is being built first
    When the skill records phase one's proof-of-work
    Then it requires a concrete runnable command
    And it requires a concrete pass condition
    And it does not allow phase one's proof to remain merely described

  Scenario: Later phases may carry a described proof refined at phase entry
    Given a later phase whose software does not exist yet
    When the skill records that phase's proof-of-work
    Then it accepts a described proof-of-work with its kind and intent
    And it records that the exact runnable command is refined at phase entry
    And it does not demand an exact runnable command for software that does not yet exist
