Feature: Propose-batch is rendered for every supported agent
  As a maintainer of a tool-agnostic ratchet
  I want the propose-batch skill and command defined once and rendered per agent
  So that no single coding agent is special-cased

  Scenario: Define skill and command content once as shared, agent-neutral content
    Given the propose-batch workflow is added
    When its skill and command are authored
    Then the content lives in shared templates, not an agent-specific copy
    And the content refers to "the coding agent" rather than naming one agent
    And any structured-question step is phrased as optional with a plain-prose fallback

  Scenario Outline: Render the skill and command into each supported agent's directory
    Given ratchet init runs with the propose-batch workflow enabled for "<agent>"
    When skills and commands are generated
    Then the propose-batch skill is rendered for "<agent>"
    And the propose-batch command is rendered for "<agent>"

    Examples:
      | agent          |
      | claude-code    |
      | codex          |
      | cursor         |
      | github-copilot |
      | opencode       |

  Scenario: Propose-batch is opt-in, not part of the core profile
    Given a project using the streamlined core profile
    When ratchet resolves which workflows to install
    Then the propose-batch workflow is not installed by default
    And it is installed only for custom profiles that request it alongside the batch workflow
