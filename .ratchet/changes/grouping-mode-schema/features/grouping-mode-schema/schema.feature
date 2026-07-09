Feature: Stacked PR-grouping modes and the shared grouping-active predicate
  As a ratchet user coordinating a batch
  I want the batch `prGrouping` setting to additionally accept `per-phase` and
  `per-change` alongside the existing `off` (default) and `whole-batch`, and the
  shared "grouping is active" predicate to treat every non-`off` mode as active
  So that a later phase can spawn stacked per-phase / per-change PRs while every
  existing config keeps validating exactly as before and doctor's remote warning
  already fires for the two new modes

  Background:
    Given the batch `prGrouping` setting is validated by one shared enum
    And that enum is the single source of truth consumed at project-config scope
      and per-change manifest scope
    And a shared predicate decides whether PR grouping is active for a given mode

  # --- new stacked modes accepted ---------------------------------------------

  Scenario Outline: `prGrouping: per-phase` is accepted at every scope
    Given a <scope> configuration whose batch `prGrouping` is the string "per-phase"
    When the configuration is validated against its schema
    Then validation succeeds
    And the resolved `prGrouping` setting is "per-phase"

    Examples:
      | scope           |
      | project-config  |
      | manifest        |

  Scenario Outline: `prGrouping: per-change` is accepted at every scope
    Given a <scope> configuration whose batch `prGrouping` is the string "per-change"
    When the configuration is validated against its schema
    Then validation succeeds
    And the resolved `prGrouping` setting is "per-change"

    Examples:
      | scope           |
      | project-config  |
      | manifest        |

  # --- existing modes unchanged (regression) ----------------------------------

  Scenario Outline: The existing `off` and `whole-batch` modes still validate at every scope
    Given a <scope> configuration whose batch `prGrouping` is the string "<mode>"
    When the configuration is validated against its schema
    Then validation succeeds
    And the resolved `prGrouping` setting is "<mode>"

    Examples:
      | scope           | mode        |
      | project-config  | off         |
      | project-config  | whole-batch |
      | manifest        | off         |
      | manifest        | whole-batch |

  Scenario: An unset `prGrouping` still defaults to `off`
    Given a project configuration whose batch block omits `prGrouping`
    When effective batch settings are resolved
    Then validation succeeds
    And the resolved `prGrouping` setting is "off"
    And its source is the built-in default

  # --- invalid modes still rejected -------------------------------------------

  Scenario Outline: An invalid `prGrouping` mode is still rejected at every scope
    Given a <scope> configuration whose batch `prGrouping` is the string "<mode>"
    When the configuration is validated against its schema
    Then validation fails because "<mode>" is not one of the accepted grouping modes

    Examples:
      | scope           | mode       |
      | project-config  | per-batch  |
      | project-config  | bogus      |
      | manifest        | per-batch  |
      | manifest        | bogus      |

  # --- shared grouping-active predicate ---------------------------------------

  Scenario Outline: The grouping-active predicate treats every non-`off` mode as active
    Given the `prGrouping` mode "<mode>"
    When the shared grouping-active predicate is evaluated for that mode
    Then it reports that PR grouping is <active>

    Examples:
      | mode        | active   |
      | off         | inactive |
      | whole-batch | active   |
      | per-phase   | active   |
      | per-change  | active   |

  # --- doctor's remote warning already covers the new modes -------------------

  Scenario Outline: Doctor's PR-remote warning fires for a new grouping mode with no remote
    Given a project whose batch `prGrouping` resolves to "<mode>"
    And the repository has no configured git remote
    When the PR-remote doctor check runs
    Then it emits the missing-remote warning

    Examples:
      | mode       |
      | per-phase  |
      | per-change |

  Scenario Outline: Doctor's PR-remote warning stays silent when a remote exists
    Given a project whose batch `prGrouping` resolves to "<mode>"
    And the repository has a configured git remote
    When the PR-remote doctor check runs
    Then the check is silent

    Examples:
      | mode       |
      | per-phase  |
      | per-change |
