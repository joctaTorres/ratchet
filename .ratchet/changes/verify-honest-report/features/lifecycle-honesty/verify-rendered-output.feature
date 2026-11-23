Feature: Verify honesty guardrails pinned on every agent's rendered output
  As a ratchet maintainer
  I want a test that renders the verify skill and command for every
  registered agent and asserts the honesty guardrails
  So that the verify workflow cannot silently regress to claiming more than
  it proved

  Scenario: Every registered agent's rendered verify output carries the honesty guardrails
    Given the supported-tools registry
    When the verify skill template and command template are rendered for each
      registered agent
    Then every rendered body makes a scenario with no implementation and no
      test a CRITICAL issue
    And every rendered body reports a check that could not run as
      "Not verified" blocking "Ready for archive"
    And every rendered body requires running the project's own discovered
      test command and citing the fresh result
    And every rendered body states that reasonable inference no longer counts
      as test evidence
    And every rendered body keeps the @holdout warning non-blocking and
      count-only
    And the checked agent set is non-empty and covers every registered agent

  Scenario: The honesty assertions reject a dishonest verify body
    Given a sample verify body in the pre-change shape — an uncovered scenario
      is only a WARNING, inference counts as evidence, and unrun checks are
      silent
    When the lifecycle-honesty assertions run against it
    Then the assertions fail
