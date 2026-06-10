Feature: Engine interface contract
  As the maintainer of the open CLI and the licensed engine
  I want a stable typed boundary between them
  So that the engine can be developed and shipped separately from the CLI

  Scenario: The CLI discovers an engine through a defined interface
    Given the CLI exposes a documented engine interface
    When an engine implementation is installed
    Then the CLI loads it through that interface without importing engine internals

  Scenario: The CLI provides the engine a resolved step context
    Given a ready step on a batch DAG
    When the CLI hands the step to the engine
    Then the engine receives the change name, transition, phase goal, success criteria, proof-of-work, resolved settings, and prior run journal

  Scenario: The engine returns a structured step result
    Given the engine has run one transition
    Then it returns a result naming the new state, any blocker or approval request, and a pointer to journal entries
    And the CLI persists that result without knowing how the engine produced it

  Scenario: Absence of an engine is a first-class state
    Given no engine implementation is installed
    When the CLI needs to run a step
    Then it reports the engine is absent through the interface rather than crashing

  Scenario: The contract is versioned
    Given an engine built against a contract version
    When the CLI contract version is incompatible
    Then the CLI refuses to run and reports the version mismatch
