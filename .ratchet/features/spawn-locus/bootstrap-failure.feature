Feature: A spawn locus that cannot host the rct skill fails with a clear bootstrap message
  As the batch engine
  I want to refuse to spawn a delegation the agent cannot run when I cannot
  guarantee the rct skill is present in the spawn locus
  So that a headless agent is never told to invoke `/rct:<transition>` in a
  locus where that command does not and cannot exist — failing loudly and
  actionably instead

  Background:
    Given a change-verb spawn driven by the engine's change-scoped core
      (runChangeStep) for a forced transition
    And an injected agent runtime so a spawn would be observable if it happened

  # The local/docker loci spawn in the project root the engine controls on disk,
  # so the engine can render the command there. The remote locus runs the agent
  # in a remote workdir over the REST API — the engine cannot write the command
  # file into that working tree from here, so it cannot guarantee the skill.
  Scenario: A locus the engine cannot render into fails before any spawn
    Given a spawn locus where the engine cannot place the rct command file
      (e.g. a remote workdir it does not control on disk)
    When the engine prepares to spawn the change-verb agent
    Then it does NOT spawn the agent
    And the step fails with a clear, actionable bootstrap message that names the
      missing rct command and the spawn locus and states the remedy
    And the message never instructs the agent to invoke a skill it cannot run

  Scenario: A render failure surfaces as an actionable bootstrap error, not a spawn
    Given a local-locus spawn whose rct command is missing and cannot be written
      (the render step fails)
    When the engine prepares to spawn the change-verb agent
    Then no agent is spawned
    And the failure is reported through the engine's normal outcome channel as a
      blocked/failed step carrying the actionable message
    And the step stays resumable (mirroring the engine's existing bootstrap-error
      contract — non-zero result, message surfaced, no new outcome state)

  Scenario: The guarantee runs before the spawn request is built
    Given any change-verb spawn
    When the engine runs one change step
    Then the skill-in-locus guarantee is evaluated before the agent spawn request
      is built and before the runtime is invoked
    And a guarantee failure short-circuits the step with no agent process started
