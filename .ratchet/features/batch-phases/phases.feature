Feature: Phases with proof-of-work
  As a developer guarding against waterfall failure modes
  I want each phase to ship functional software behind an executable proof-of-work
  So that errors surface early and the user sees working software at every boundary

  Scenario: A phase declares a goal, success criteria, and a proof-of-work
    Given a batch manifest with a phase "foundation"
    When I inspect that phase
    Then the phase declares a human-readable goal
    And the phase declares success criteria
    And the phase declares a proof-of-work with a kind, a runnable command, and a pass condition

  Scenario: Proof-of-work kinds are constrained to executable checks
    Given a phase proof-of-work
    When I inspect its kind
    Then its kind is one of "integration", "blackbox", or "llm-judge"
    And each kind names something an agent can execute directly via bash or an MCP tool

  Scenario: Vertical-slice is the default phase strategy
    Given a batch scaffolded without an explicit strategy
    When I inspect the resolved batch strategy
    Then the strategy is "vertical-slice"
    And a phase may satisfy "functional software" with a thin end-to-end slice rather than a complete feature

  Scenario: The strategy can be changed to feature mode
    Given a batch using the default "vertical-slice" strategy
    When I set the strategy to "feature" via batch config
    Then phases are expected to deliver complete features rather than thin slices

  Scenario: A later phase is blocked until the prior phase proof-of-work passes
    Given phases "foundation" then "hardening"
    And the proof-of-work for "foundation" has not yet passed
    When the batch status is computed
    Then "hardening" is reported as blocked by "foundation"

  Scenario: A failing proof-of-work hard-gates phase completion by default
    Given the phase "foundation" has all its changes done
    And its proof-of-work command exits non-zero
    When the engine evaluates the phase
    Then the phase is not marked done
    And the failure is surfaced as a blocker on the batch

  Scenario: Proof-of-work enforcement can be relaxed to warn
    Given a batch configured with proofOfWork set to "warn"
    And a phase whose proof-of-work fails
    When the engine evaluates the phase
    Then the failure is reported as a warning
    And the phase is allowed to complete
