Feature: Agent-cmd override prints a one-line notice
  As a ratchet operator
  I want an active RATCHET_BATCH_AGENT_CMD / RATCHET_EVAL_AGENT_CMD to be loudly surfaced
  So that a leftover test override can never silently replace the configured coding agent

  Scenario: batch apply text output carries the override notice
    Given RATCHET_BATCH_AGENT_CMD is set to a stand-in command
    When `ratchet batch apply` runs a step that spawns the agent
    Then the rendered step result includes the one-line notice "⚠ agent overridden by RATCHET_BATCH_AGENT_CMD"

  Scenario: batch apply --json output carries agentOverride
    Given RATCHET_BATCH_AGENT_CMD is set to a stand-in command
    When `ratchet batch apply --json` runs a step that spawns the agent
    Then the emitted step-result JSON has an "agentOverride" field set to true

  Scenario: eval run text output carries the override notice
    Given RATCHET_EVAL_AGENT_CMD is set to a stand-in command
    When `ratchet eval run` executes
    Then the scorecard output includes the one-line notice "⚠ agent overridden by RATCHET_EVAL_AGENT_CMD"

  Scenario: eval run --json output carries agentOverride
    Given RATCHET_EVAL_AGENT_CMD is set to a stand-in command
    When `ratchet eval run --json` executes
    Then the emitted run JSON has an "agentOverride" field set to true

  Scenario: no override means no notice and no flag
    Given neither RATCHET_BATCH_AGENT_CMD nor RATCHET_EVAL_AGENT_CMD is set
    When `ratchet batch apply` or `ratchet eval run` executes
    Then no override notice line is printed
    And the --json output carries no "agentOverride" field
