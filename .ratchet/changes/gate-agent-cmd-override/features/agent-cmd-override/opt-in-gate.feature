Feature: The agent-command override requires an explicit operator opt-in
  As an operator running ratchet
  I want RATCHET_BATCH_AGENT_CMD / RATCHET_EVAL_AGENT_CMD to be ignored unless I deliberately opt in
  So that a leftover value from an eval session, CI, or a .envrc can never silently replace my coding agent

  Scenario: An override without the opt-in refuses the batch step
    Given "RATCHET_BATCH_AGENT_CMD" is set to a stub command
    And "--allow-agent-override" was not passed
    When "ratchet batch apply" drives a transition
    Then the stub command is not run
    And the configured agent is not spawned either
    And the step fails with a message naming "RATCHET_BATCH_AGENT_CMD" and "--allow-agent-override"
    And the batch run-state stays resumable

  Scenario: An override with the opt-in is honored
    Given "RATCHET_BATCH_AGENT_CMD" is set to a stub command
    When "ratchet batch apply --allow-agent-override" drives a transition
    Then the stub command runs via bash in place of the configured agent
    And it receives the step instructions on stdin

  Scenario: The opt-in alone changes nothing
    Given "RATCHET_BATCH_AGENT_CMD" is unset
    When "ratchet batch apply --allow-agent-override" drives a transition
    Then the configured agent adapter is spawned exactly as without the flag
    And no override notice is printed

  Scenario: A blank override is inactive and needs no opt-in
    Given "RATCHET_BATCH_AGENT_CMD" is set to whitespace only
    And "--allow-agent-override" was not passed
    When the engine drives a transition
    Then the configured agent adapter is spawned
    And the step is not refused

  Scenario Outline: Every engine-spawning verb carries the opt-in flag
    Given "RATCHET_BATCH_AGENT_CMD" is set to a stub command
    When "<verb>" runs without "--allow-agent-override"
    Then the spawn is refused with the opt-in message
    And "<verb> --allow-agent-override" runs the stub

    Examples:
      | verb                 |
      | ratchet batch apply  |
      | ratchet apply        |
      | ratchet verify       |
      | ratchet propose      |

  Scenario: The opt-in cannot be supplied by the process environment
    Given "RATCHET_BATCH_AGENT_CMD" is set to a stub command
    And no command-line opt-in and no engine opt-in dependency is given
    When the engine builds a spawn request
    Then the override is refused regardless of any other environment variable
