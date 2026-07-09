Feature: Agent environment allowlist
  As a ratchet operator running batch steps on my own machine
  I want engine-spawned agents to receive only an allowlisted environment
  So that host secrets outside the allowlist never reach a spawned agent

  Scenario: A non-allowlisted host secret is dropped
    Given a host environment containing "SUPER_SECRET_TOKEN=hunter2" alongside PATH and HOME
    When the agent environment is scoped through the allowlist
    Then the scoped environment does not contain "SUPER_SECRET_TOKEN"
    And the scoped environment contains PATH and HOME unchanged

  Scenario: Baseline process variables pass through
    Given a host environment with PATH, HOME, TMPDIR, LANG, TERM, and an HTTPS_PROXY value
    When the agent environment is scoped through the allowlist
    Then every one of those baseline variables is present in the scoped environment with its host value

  Scenario: Ratchet control variables pass through
    Given a host environment containing "RATCHET_BATCH_AGENT_CMD=echo stub-agent"
    When the agent environment is scoped through the allowlist
    Then the scoped environment contains "RATCHET_BATCH_AGENT_CMD" with the host value

  Scenario Outline: Every registered agent's declared keys pass through
    Given the adapter registry entry for "<agent>" declaring its env passthrough
    And a host environment containing a variable matching that declaration
    When the agent environment is scoped through the allowlist
    Then the matching variable is present in the scoped environment

    Examples:
      | agent    |
      | claude   |
      | codex    |
      | gemini   |
      | cursor   |
      | opencode |

  Scenario: Every registered adapter declares an env passthrough
    Given the built-in adapter registry
    When each registered adapter is inspected
    Then each adapter declares an env passthrough list so the allowlist cannot silently omit a newly added agent

  Scenario: Operator escape hatch extends the allowlist
    Given a host environment containing "MY_CUSTOM_CA=/etc/ca.pem" and "RATCHET_AGENT_ENV_ALLOW=MY_CUSTOM_CA"
    When the agent environment is scoped through the allowlist
    Then the scoped environment contains "MY_CUSTOM_CA" with the host value
    And a host secret not named by the escape hatch is still dropped
