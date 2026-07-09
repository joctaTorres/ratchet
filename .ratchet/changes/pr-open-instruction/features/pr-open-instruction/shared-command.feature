Feature: Shared, forge-agnostic PR-open command
  As ratchet coordinating a whole-batch PR at batch completion
  I want one shared PR-open command, authored once in the shared command/workflow
  layer with its own command id, that renders for every registered agent and is
  guaranteed into the spawn locus by the render-or-fail skill-locus path
  So that a later change can spawn a PR agent that commits the accumulated work
  and opens exactly one forge-agnostic PR, without any lifecycle instructions
  being re-authored in the engine or any forge/agent being special-cased

  Background:
    Given the change lifecycle instructions are authored once in the shared
      command/workflow layer and rendered per agent through the adapter registry
    And the shared PR-open command has its own canonical command id, distinct
      from the `pr` routable agent stage that will spawn it

  # --- the command exists in the ONE shared layer -----------------------------

  Scenario: The shared PR-open command is registered in the shared command layer
    Given the shared command definitions resolved from the command/workflow layer
    When the definitions for the PR-open command id are looked up
    Then exactly one shared command definition is returned for that id
    And its instruction body is the same shared body the paired skill renders
    And no engine-local or hand-authored copy of the PR instructions exists

  Scenario: The canonical PR-open command id lives in one place
    Given the skill-locus layer that guarantees a command into the spawn locus
    When the canonical PR-open command id is resolved
    Then it is a single-source constant, kept beside the other canonical
      command ids so the spawn path and the agent invocation cannot drift

  # --- renders for EVERY registered agent (multi-agent-support) ----------------

  Scenario: The PR-open command renders for every registered agent
    Given the command-generation adapter registry of every supported agent
    When the shared PR-open command is rendered through each registered adapter
    Then every agent produces a command file at that agent's own command path
    And no agent is special-cased and no agent-specific copy is hand-authored

  # --- guaranteed in the spawn locus by the render-or-fail path ----------------

  Scenario: The render-or-fail path renders the PR-open command when absent
    Given a controllable spawn locus for a spawn agent whose `pr` stage resolves
      to that agent
    And the PR-open command file is absent under that locus
    When the render-or-fail skill-locus path guarantees the PR-open command id
      for the `pr` stage
    Then the PR-open command is rendered from the shared definition to that
      agent's command path under the locus

  Scenario: The render-or-fail path verifies an already-present command untouched
    Given a controllable spawn locus where the PR-open command file already exists
    When the render-or-fail skill-locus path guarantees the PR-open command id
    Then the existing command file is left untouched and is not re-rendered

  Scenario: The render-or-fail path refuses an uncontrollable spawn locus
    Given a spawn locus the engine cannot render files into
    When the render-or-fail skill-locus path guarantees the PR-open command id
    Then it fails with an actionable error that names the PR-open command and the
      locus and never instructs the agent to invoke a command it cannot run

  # --- the instruction body says what the PR agent must do --------------------

  Scenario: The PR-open body instructs matching the repo's commit style
    Given the shared PR-open command body
    When its instructions are read
    Then it directs the agent to read `git log` for the repo's commit-message
      style and to default to semantic / Conventional Commits when unclear

  Scenario: The PR-open body instructs committing, pushing, and opening one PR
    Given the shared PR-open command body
    When its instructions are read
    Then it directs the agent to commit the accumulated uncommitted work of the
      prior stage agents in that style
    And to push the work branch to its remote
    And to open exactly one pull request from the work branch to its base branch

  Scenario: The PR-open body is forge-agnostic
    Given the shared PR-open command body
    When its instructions are read
    Then it directs the agent to use whichever forge CLI the environment provides
    And it hard-codes no single forge CLI and no ratchet-specific toolchain
      command as the required tool

  Scenario: The PR-open body is agent-neutral
    Given the shared PR-open command body
    When its instructions are read
    Then it refers to the coding agent generically and assumes no capability
      unique to a single agent
