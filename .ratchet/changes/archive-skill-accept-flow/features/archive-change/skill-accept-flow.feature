Feature: Archive skill scenario-loss accept flow
  As a developer finalizing a change through the archive skill
  I want the skill to run the real archive command and route a scenario-loss
  refusal through me, naming what would be lost
  So that accepted behavior is never dropped from the feature store by the
  agent acting on its own initiative

  Background:
    Given the archive-change skill and command bodies shared by every registered agent

  Scenario: The archive skill runs ratchet archive so the scenario guard engages
    Given a change ready to archive
    When the archive-change body archives the change
    Then the body runs "ratchet archive" for the named change
    And the first archive attempt runs without "-y"
    And the first archive attempt does not pass "--accept-removed-scenarios"

  Scenario: A scenario-loss refusal is surfaced to the user naming the lost scenarios
    Given "ratchet archive" exited non-zero because the change would drop store scenarios
    When the archive-change body handles the refusal
    Then the body directs the agent to name each lost scenario and its store file as listed in the refusal output
    And the body directs the agent to ask the user whether the removal is intentional
    And the ask is phrased as a capability plus a plain-prose fallback

  Scenario: Retrying with --accept-removed-scenarios requires explicit user approval
    Given "ratchet archive" exited non-zero because the change would drop store scenarios
    When the user explicitly confirms the scenario removal is intentional
    Then the body retries the archive with "--accept-removed-scenarios"
    But without that explicit confirmation the body never retries with the flag

  Scenario: The tombstone is presented as the intentional whole-file-removal route
    Given "ratchet archive" exited non-zero because the change would drop store scenarios
    When the user intends to remove a whole feature file from the store
    Then the body directs the agent to list the store-relative path in the change's "features/.deleted" tombstone
    And the body re-runs "ratchet archive" without "--accept-removed-scenarios"

  Scenario: Every registered agent's rendered archive output carries the accept flow
    Given the supported-tools registry
    When the archive skill template and command template are rendered for each registered agent
    Then every rendered body carries the first attempt without "-y"
    And every rendered body names the lost scenarios and asks the user with capability-plus-fallback phrasing
    And every rendered body gates the "--accept-removed-scenarios" retry on explicit user approval
    And every rendered body presents the "features/.deleted" tombstone as the whole-file-removal route
    And the checked agent set is non-empty and covers every registered agent

  Scenario: The accept-flow assertions reject a pre-change archive body
    Given a sample archive body in the pre-change shape — archiving with "-y" and no scenario-loss handling
    When the accept-flow rendered-output assertions run against it
    Then the assertions fail
