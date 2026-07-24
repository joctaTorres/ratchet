Feature: PR-open opens against the supplied base branch
  As ratchet preparing to open stacked pull requests per phase or per change
  I want the PR-open command's instructions payload to carry the resolved base
  branch as data, and the shared command body to open its single PR against that
  supplied base rather than any implicit or git-derived one
  So that a later change can inject an arbitrary stacked-branch base (the previous
  group's branch) without editing the shared command and without the skill reading
  config, keeping each PR's diff scoped to its own unit

  Background:
    Given the shared, forge-agnostic PR-open command authored once in the shared
      command/workflow layer with its own canonical command id
    And the engine builds the PR agent's instructions from a resolved step context
      that carries the work branch and base branch as data

  # --- the supplied base is the sole authority (instruction-fed-config) --------

  Scenario: The instructions payload carries an arbitrary supplied base verbatim
    Given a PR step context whose base branch is a stacked sibling branch that is
      NOT the repository's default branch
    When the engine builds the PR agent's instructions from that context
    Then the built instructions name that exact supplied base branch as the PR target
    And the built instructions name the supplied work branch as the PR source
    And the engine neither reads git nor derives the base from the repository's
      default branch or the work branch's upstream

  Scenario: The same command opens against a repo-default base and a sibling base identically
    Given one PR step context whose base branch is the repository's default branch
    And another PR step context whose base branch is a stacked sibling branch
    When the engine builds the PR agent's instructions from each context
    Then each built instructions payload names its own supplied base branch as the
      PR target
    And the shared command body is byte-for-byte the same across both, carrying no
      whole-batch-only or default-branch-only assumption

  # --- the shared body opens against the supplied base only --------------------

  Scenario: The shared body directs opening one PR against the supplied base
    Given the shared PR-open command body
    When its instructions are read
    Then it directs the agent to open exactly one pull request from the work branch
      to the base branch the surrounding instructions supply
    And it directs the agent not to invent, infer, or re-derive the base branch

  Scenario: The shared body reads no ratchet config to resolve the base
    Given the shared PR-open command body
    When its instructions are read
    Then it contains no instruction to read any ratchet config file to resolve the
      base branch
    And it contains no "if config says X then target Y" branching over the base

  # --- multi-agent + render-or-fail preserved ----------------------------------

  Scenario: The supplied base flows through for every registered agent
    Given the command-generation adapter registry of every supported agent
    When the engine builds PR instructions for a PR step context routed to each agent
    Then each agent's instructions name the same supplied base branch as the PR target
    And only the shared command's invocation token differs per agent's own syntax
    And no agent is special-cased in resolving the base

  Scenario: The PR-open command is still guaranteed into the spawn locus
    Given a controllable spawn locus for a spawn agent whose `pr` stage resolves to
      that agent
    And the PR-open command file is absent under that locus
    When the render-or-fail skill-locus path guarantees the PR-open command id
    Then the PR-open command is rendered from the shared definition to that agent's
      command path under the locus
    And the guarantee is unchanged by carrying the supplied base as instruction data

  Scenario: An unrenderable spawn locus still fails before any agent is spawned
    Given a spawn locus the engine cannot render the PR-open command into
    When the render-or-fail skill-locus path guarantees the PR-open command id
    Then it fails with an actionable error naming the PR-open command and the locus
    And no agent is instructed to open a PR against the supplied base it cannot run
