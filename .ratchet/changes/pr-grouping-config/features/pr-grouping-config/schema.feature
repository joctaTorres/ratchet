Feature: PR-grouping mode and the `pr` routable agent stage
  As a ratchet user coordinating a batch
  I want the batch `prGrouping` setting to accept `off` (the default) or
  `whole-batch`, and the shared `agent` stage-map to accept `pr` as a fourth
  routable stage alongside propose/apply/verify
  So that a later phase can spawn a dedicated PR agent for whole-batch PR
  opening, while every existing scalar-or-unset config keeps behaving exactly as
  before

  Background:
    Given the batch `prGrouping` setting is validated by one shared enum
    And the batch `agent` setting is validated by one shared stage-map schema
    And both schemas are applied at project-config scope and per-change manifest scope

  # --- prGrouping mode ---------------------------------------------------------

  Scenario Outline: `prGrouping: off` is accepted at every scope
    Given a <scope> configuration whose batch `prGrouping` is the string "off"
    When the configuration is validated against its schema
    Then validation succeeds
    And the resolved `prGrouping` setting is "off"

    Examples:
      | scope           |
      | project-config  |
      | manifest        |

  Scenario Outline: `prGrouping: whole-batch` is accepted at every scope
    Given a <scope> configuration whose batch `prGrouping` is the string "whole-batch"
    When the configuration is validated against its schema
    Then validation succeeds
    And the resolved `prGrouping` setting is "whole-batch"

    Examples:
      | scope           |
      | project-config  |
      | manifest        |

  Scenario: An unset `prGrouping` defaults to `off`
    Given a project configuration whose batch block omits `prGrouping`
    When effective batch settings are resolved
    Then validation succeeds
    And the resolved `prGrouping` setting is "off"
    And its source is the built-in default

  Scenario Outline: An invalid `prGrouping` mode is rejected at every scope
    Given a <scope> configuration whose batch `prGrouping` is the string "<mode>"
    When the configuration is validated against its schema
    Then validation fails because "<mode>" is not one of off or whole-batch

    Examples:
      | scope           | mode        |
      | project-config  | per-change  |
      | project-config  | bogus       |
      | manifest        | per-change  |
      | manifest        | bogus       |

  # --- `pr` as a fourth routable agent stage ----------------------------------

  Scenario Outline: An `agent` stage-map that names `pr` is accepted at every scope
    Given a <scope> configuration whose batch `agent` is the map:
      | stage   | agent    |
      | apply   | opencode |
      | pr      | claude   |
    When the configuration is validated against its schema
    Then validation succeeds
    And the resolved `agent` setting maps the "pr" stage to "claude"

    Examples:
      | scope           |
      | project-config  |
      | manifest        |

  Scenario Outline: A full propose/apply/verify/pr stage-map is accepted at every scope
    Given a <scope> configuration whose batch `agent` is the map:
      | stage   | agent    |
      | propose | claude   |
      | apply   | opencode |
      | verify  | opencode |
      | pr      | claude   |
    When the configuration is validated against its schema
    Then validation succeeds
    And the resolved `agent` setting defines the propose, apply, verify, and pr stages

    Examples:
      | scope           |
      | project-config  |
      | manifest        |

  Scenario Outline: An unknown stage key is still rejected at every scope
    Given a <scope> configuration whose batch `agent` is the map:
      | stage  | agent  |
      | deploy | claude |
    When the configuration is validated against its schema
    Then validation fails because "deploy" is not one of propose, apply, verify, or pr

    Examples:
      | scope           |
      | project-config  |
      | manifest        |
