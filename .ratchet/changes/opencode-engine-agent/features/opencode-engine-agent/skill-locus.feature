Feature: OpenCode command file is guaranteed in the spawn locus
  As the batch engine
  I want the opencode rct command file present where opencode is spawned
  So that the spawned agent can invoke /rct-<transition> <change>

  Background:
    Given the skill-in-spawn-locus guarantee renders the canonical rct command before spawning
    And the opencode command adapter writes to .opencode/commands/rct-<id>.md

  Scenario: The opencode transition command is rendered into the spawn locus
    Given a change step that will spawn opencode in a local locus
    And the .opencode/commands/rct-apply.md file is absent
    When the engine ensures the skill is in the spawn locus
    Then it renders the canonical apply command into .opencode/commands/rct-apply.md
    And the spawn proceeds

  Scenario: An existing opencode command file is left untouched
    Given a change step that will spawn opencode in a local locus
    And the .opencode/commands/rct-apply.md file already exists
    When the engine ensures the skill is in the spawn locus
    Then it leaves the existing file untouched
    And the spawn proceeds

  Scenario: opencode remote locus is rejected
    Given a change step that will spawn opencode in a remote locus
    When the engine ensures the skill is in the spawn locus
    Then it throws a SkillLocusError before spawning
    Because the engine cannot write into a remote worktree
