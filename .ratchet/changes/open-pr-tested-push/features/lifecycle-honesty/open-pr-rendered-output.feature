Feature: Open-PR tested-push guardrails pinned on every agent's rendered output
  As a ratchet maintainer
  I want a test that renders the open-pr skill and command for every registered
  agent and asserts the tested-push guardrails
  So that the open-pr workflow cannot silently regress to pushing an untested
  or red tree, force-pushing, or retrying a rejected push

  Scenario: Every registered agent's rendered open-pr output carries the tested-push guardrails
    Given the supported-tools registry
    When the open-pr skill template and command template are rendered for each
      registered agent
    Then every rendered body requires a fresh run of the project's own
      discovered test command on the committed tree before pushing, with no
      new ratchet configuration and no assumed toolchain
    And every rendered body forbids pushing a red tree and forbids opening the
      pull request on a red, unrun, or undiscoverable test result
    And every rendered body forbids force-pushing under any circumstances and
      directs the agent to stop and report a rejected push instead of retrying
    And the skill template and the command template consume one shared body
      constant
    And the checked agent set is non-empty and covers every registered agent

  Scenario: The tested-push assertions reject a test-less open-pr body
    Given a sample open-pr body in the pre-change shape — commits, pushes, and
      opens the pull request with no test run, no force-push rule, and no
      rejected-push rule
    When the lifecycle-honesty open-pr assertions run against it
    Then the assertions fail
