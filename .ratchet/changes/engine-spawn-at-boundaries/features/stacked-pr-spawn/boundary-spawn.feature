Feature: Engine spawns one PR agent per detected grouping boundary
  As the ratchet batch engine orchestrating stacked PR grouping
  I want to spawn exactly one PR agent for each detected group boundary with its resolved stacked base
  So that per-phase and per-change modes each yield one scoped, stacked PR without re-authoring the PR lifecycle

  Background:
    Given a batch whose phases and changes are complete up to a group boundary
    And the shared forge-agnostic pr-open command is registered for every coding agent
    And boundary detection and stacked-base selection have resolved the fired group's identity and stacked base

  Scenario: A per-phase boundary spawns one PR agent stacked on the previous phase
    Given prGrouping is "per-phase"
    And the batch has two phases whose changes are all complete
    When the engine runs the PR step for the second phase's group boundary
    Then exactly one PR agent is spawned for that group
    And the spawn delegates to the shared pr-open command rather than a re-authored inline prompt
    And the base branch injected into the instructions payload is the first phase group's branch
    And the work branch injected into the payload is the second phase group's own branch

  Scenario: A per-change boundary spawns one PR agent stacked on the previous change
    Given prGrouping is "per-change"
    And the batch has three completed changes in order
    When the engine runs the PR step for the third change's group boundary
    Then exactly one PR agent is spawned for that group
    And the injected base branch is the second change group's branch
    And the injected work branch is the third change group's own branch

  Scenario Outline: The first group bases on the batch base branch, later groups stack on the prior group
    Given prGrouping is "<mode>"
    When the engine runs the PR step for group index <index>
    Then the base branch injected into the payload is "<base>"

    Examples:
      | mode       | index | base                    |
      | per-phase  | 0     | the batch's base branch |
      | per-phase  | 1     | group 0's branch        |
      | per-change | 0     | the batch's base branch |
      | per-change | 2     | group 1's branch        |

  Scenario: The PR agent is resolved through the pr-stage adapter
    Given prGrouping is "per-change"
    And the agent stage-map routes the "pr" stage to a specific coding agent
    When the engine runs the PR step for a fired group boundary
    Then the spawned agent is the one mapped to the "pr" stage
    And the spawn request renders for every registered agent, special-casing none

  Scenario: No PR agent is spawned when grouping is off
    Given prGrouping is "off"
    When the engine is asked to run a PR step for any completed unit
    Then no PR agent is spawned
    And the step reports nothing-ready

  Scenario: The stacked base is carried as payload data, not read from config by the skill
    Given prGrouping is "per-phase"
    When the engine builds the PR agent's instructions for a fired group boundary
    Then the resolved base branch appears in the instructions payload as data
    And the shared pr-open command body reads no ratchet config to obtain that base
