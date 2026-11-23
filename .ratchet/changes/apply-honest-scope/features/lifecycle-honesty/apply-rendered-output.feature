Feature: Apply scope-honesty guardrails pinned on every agent's rendered output
  As a ratchet maintainer
  I want a test that renders the apply skill and command for every registered
  agent and asserts the scope-honesty guardrails
  So that the apply workflow cannot silently regress to narrowing scope or
  claiming tasks without evidence

  Scenario: Every registered agent's rendered apply output carries the scope-honesty guardrails
    Given the supported-tools registry
    When the apply skill template and command template are rendered for each
      registered agent
    Then every rendered body forbids silent scope narrowing and directs the
      agent to stop, name the narrowed scope, and ask the user
    And every rendered body requires concrete evidence the specified behavior
      is fully implemented before a task is ticked [x]
    And every rendered body suggests /rct:verify when all tasks are done
    And the skill template and the command template consume one shared body
      constant
    And the checked agent set is non-empty and covers every registered agent

  Scenario: The scope-honesty assertions reject a dishonest apply body
    Given a sample apply body in the pre-change shape — divergent skill and
      command copies, silent scope narrowing allowed, tasks ticked without
      evidence, and archive suggested on completion
    When the lifecycle-honesty apply assertions run against it
    Then the assertions fail
