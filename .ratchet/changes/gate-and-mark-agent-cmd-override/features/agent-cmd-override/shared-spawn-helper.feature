Feature: One shared helper owns override-aware spawn-request construction
  As a ratchet maintainer
  I want the env-override gate and spawn-request construction to exist in exactly one helper
  So that the batch engine, the eval judge, and the mutation harness cannot drift apart (the #67 triplication)

  Scenario: the three spawn seams share one override gate
    Given the batch engine, the eval judge, and the mutation harness each build an agent spawn request
    When their override env var is set to a stand-in command
    Then each produces the same `bash -c <override>` request shape through the shared helper
    And each reports that the agent was overridden

  Scenario: a whitespace-only override is inactive
    Given RATCHET_BATCH_AGENT_CMD is set to only whitespace
    When a spawn request is built
    Then the configured adapter path is used
    And the agent is not reported as overridden

  Scenario: an override-built request threads env like any other request
    Given a spawn request built under an active override with a per-step env var
    When a rex runtime builds the launch command for it
    Then the launch command exports the per-step env var before invoking the override command
