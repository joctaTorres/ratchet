Feature: The engine guarantees the rct skill is present in the spawn locus
  As the batch engine about to delegate a change transition to the canonical
  ratchet skill
  I want to guarantee the rct command/skill for that transition is actually
  present in the locus where I spawn the agent
  So that the delegating prompt (added by the next changes in this phase) never
  tells a headless agent to invoke `/rct:<transition>` in a working tree where
  that command does not exist

  Background:
    Given a change-verb spawn driven by the engine's change-scoped core
      (runChangeStep) for a forced transition
    And an injected agent runtime so no real agent is spawned
    And the configured agent resolves a command adapter from the
      command-generation registry (default: claude)

  # The spawn locus for the local locus is the project root the engine spawns in
  # (the agent's cwd). The rct command for a transition lives at the adapter's
  # path for that command id, e.g. claude → ".claude/commands/rct/<transition>.md".
  Scenario: A missing rct command is rendered into the spawn locus before the spawn
    Given a local-locus spawn whose project root has no rct command file for the
      forced transition
    When the engine prepares to spawn the change-verb agent
    Then it renders the canonical rct command for that transition into the spawn
      locus at the configured agent's command path
    And the rendered file content comes from the shared command definition (not a
      hand-authored engine-local copy)
    And only then is the agent spawned, with the rct command available in its cwd

  Scenario: An already-present rct command is verified, not overwritten
    Given a local-locus spawn whose project root already contains the rct command
      file for the forced transition
    When the engine prepares to spawn the change-verb agent
    Then it verifies the command is present and leaves the existing file untouched
    And the agent is spawned without re-rendering the command

  Scenario: The transition selects its own canonical command
    Given a forced transition of "propose", "apply", or "verify"
    When the engine guarantees the skill in the spawn locus
    Then it guarantees exactly the rct command for that transition
      (propose → /rct:propose, apply → /rct:apply, verify → /rct:verify)

  # delegated-lifecycle + multi-agent-support: the guarantee names the canonical
  # workflow/skill, never an agent-specific mechanism, and renders through the
  # adapter registry — never special-casing one agent. The applicable set is the
  # batch-engine SPAWNABLE agents (BUILTIN_ADAPTERS: claude, codex, gemini,
  # cursor), since the guarantee runs only for an agent the engine can spawn.
  # github-copilot and opencode have command-generation adapters but no spawn
  # adapter (resolveAdapter → UnknownAgentError before any spawn), so they can
  # never be the spawn agent and are out of scope for this spawn-time guarantee.
  Scenario Outline: The guarantee renders through the per-agent command adapter
    Given a local-locus spawn whose configured agent is "<agent>"
    And the project root has no rct command file for the forced transition
    When the engine guarantees the skill in the spawn locus
    Then it resolves "<agent>"'s command adapter from the command-generation
      registry and renders the command at that adapter's path
    And it never hard-codes a single agent's command path in the shared spawn path

    Examples:
      | agent  |
      | claude |
      | cursor |
      | codex  |
      | gemini |
