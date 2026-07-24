Feature: Config write path refuses agent specs the loader rejects
  As a ratchet user setting the batch agent from the CLI
  I want `ratchet batch config --set agent=<value>` to validate the value through the same parser the loader uses
  So that the write path can never persist an agent value that the next config load rejects

  Scenario: a malformed scalar spec is rejected without writing, naming the value
    Given a project config whose batch section sets gate to "after-propose"
    When I run batch config --set with agent="claude:"
    Then the command fails with an error whose message contains "claude:"
    And the project config file is byte-for-byte unchanged

  Scenario Outline: every malformed scalar shape is rejected naming the offending value
    Given any project root
    When validateSetting validates key "agent" with value <value>
    Then the result is not ok and the error message contains <value>

    Examples:
      | value           |
      | "claude:"       |
      | ":fable"        |
      | "claude: opus"  |
      | "claude :m"     |
      | "claude:-flag"  |

  Scenario: a malformed per-stage entry in an inline stage map is rejected naming the stage and the value
    Given any project root
    When validateSetting validates key "agent" with the inline map value "{apply: 'claude:'}"
    Then the result is not ok
    And the error message contains "apply" and "claude:"
    And setProjectBatchSetting with that value leaves the project config file unchanged

  Scenario: a valid scalar spec still writes unchanged
    Given a project root with no config file
    When I run batch config --set with agent="opencode:zai/glm-5.2"
    Then the project config batch section contains agent "opencode:zai/glm-5.2" as a plain string

  Scenario: a valid inline stage map persists as a real map the loader accepts
    Given a project root with no config file
    When I run batch config --set with agent="{apply: opencode, verify: 'claude:fable'}"
    Then the persisted batch.agent is a YAML map with apply "opencode" and verify "claude:fable"
    And readProjectConfig loads that config back with no warning and the same agent map

  Scenario: a malformed standalone agent override fails before any settings are applied
    Given resolved change-step settings for a project root
    When resolveChangeStepSettings applies the override agent="claude:"
    Then it throws an error whose message contains "claude:"
    And a valid override agent="codex:gpt-5.2-codex" is applied unchanged
