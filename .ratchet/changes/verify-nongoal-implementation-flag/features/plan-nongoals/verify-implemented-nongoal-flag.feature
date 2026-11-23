Feature: Verify flags an implemented Non-goal
  As a developer running the verify workflow on a change
  I want verify to read the plan's "## Non-goals" section and flag any listed
  Non-goal the implementation implements
  So that work the change deliberately ruled out surfaces in the verification
  report instead of passing silently

  Background:
    Given the shared verify body rendered for every registered agent

  Scenario: The verify body reads the plan's Non-goals section when present
    Given the shared verify body
    When the body walks the agent through verifying a change
    Then the body directs reading plan.md's "## Non-goals" section when the plan carries one

  Scenario: The verify body flags a listed Non-goal the implementation implements
    Given the shared verify body
    When the body walks the agent through verifying a change
    Then the body directs checking each listed Non-goal against the implementation
    And the body directs flagging each Non-goal the implementation implements as a WARNING issue naming the Non-goal entry
    And the flag carries a specific recommendation

  Scenario: A plan without a Non-goals section skips the check
    Given the shared verify body
    When the body walks the agent through verifying a change
    Then the body directs skipping the Non-goals check when the plan carries no "## Non-goals" section
    And a plan predating the section is never failed for its absence

  Scenario: A plan whose Non-goals section records that nothing was ruled out has no entries to check
    Given the shared verify body
    When the body walks the agent through verifying a change
    Then the body treats the explicit nothing-ruled-out one-liner as a section with no Non-goal entries to check

  Scenario: Every registered agent's rendered verify output carries the Non-goal flag guidance
    Given the supported-tools registry
    When the verify skill template and command template are rendered for each registered agent
    Then every rendered body directs reading plan.md's "## Non-goals" section when the plan carries one
    And every rendered body directs flagging each Non-goal the implementation implements as a WARNING issue naming the Non-goal entry
    And every rendered body directs skipping the check when the plan carries no "## Non-goals" section
    And the checked agent set is non-empty and covers every registered agent

  Scenario: The Non-goal assertions reject a pre-change body shape
    Given a sample verify body in the pre-change shape with no Non-goals check
    When the rendered-output assertions run against it
    Then the assertions fail
