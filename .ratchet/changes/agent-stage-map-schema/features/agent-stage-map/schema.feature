Feature: Per-stage agent map config schema
  As a ratchet user coordinating a batch
  I want the batch `agent` setting to accept either a single agent name or a
  per-stage `{propose, apply, verify}` map
  So that I can route each lifecycle stage to a different coding agent while a
  plain agent name keeps behaving exactly as before

  Background:
    Given the batch `agent` setting is validated by one shared schema
    And that schema is applied at both project-config scope and per-change manifest scope

  Scenario Outline: A scalar agent name is accepted at every scope
    Given a <scope> configuration whose batch `agent` is the string "opencode"
    When the configuration is validated against its schema
    Then validation succeeds
    And the resolved `agent` setting is the string "opencode"

    Examples:
      | scope           |
      | project-config  |
      | manifest        |

  Scenario Outline: A full propose/apply/verify stage-map is accepted at every scope
    Given a <scope> configuration whose batch `agent` is the map:
      | stage   | agent    |
      | propose | claude   |
      | apply   | opencode |
      | verify  | opencode |
    When the configuration is validated against its schema
    Then validation succeeds
    And the resolved `agent` setting maps propose to "claude" and apply and verify to "opencode"

    Examples:
      | scope           |
      | project-config  |
      | manifest        |

  Scenario Outline: A partial stage-map is accepted at every scope
    Given a <scope> configuration whose batch `agent` is the map:
      | stage | agent    |
      | apply | opencode |
    When the configuration is validated against its schema
    Then validation succeeds
    And the resolved `agent` setting defines only the "apply" stage

    Examples:
      | scope           |
      | project-config  |
      | manifest        |

  Scenario Outline: An unset agent is accepted and stays unset at every scope
    Given a <scope> configuration whose batch block omits `agent`
    When the configuration is validated against its schema
    Then validation succeeds
    And the resolved `agent` setting is absent

    Examples:
      | scope           |
      | project-config  |
      | manifest        |

  Scenario Outline: An unknown stage key is rejected at every scope
    Given a <scope> configuration whose batch `agent` is the map:
      | stage  | agent  |
      | deploy | claude |
    When the configuration is validated against its schema
    Then validation fails because "deploy" is not one of propose, apply, or verify

    Examples:
      | scope           |
      | project-config  |
      | manifest        |

  Scenario Outline: A non-string agent value is rejected at every scope
    Given a <scope> configuration whose batch `agent` map sets `propose` to the number 42
    When the configuration is validated against its schema
    Then validation fails because a stage agent must be a string

    Examples:
      | scope           |
      | project-config  |
      | manifest        |
