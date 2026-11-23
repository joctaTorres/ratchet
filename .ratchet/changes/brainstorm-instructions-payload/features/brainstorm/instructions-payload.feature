Feature: Brainstorm instructions payload carries spikes opt-in as data
  As a maintainer of the brainstorm workflow
  I want `ratchet instructions brainstorm --json` to resolve the project's
    `brainstorm.spikes` config into a payload value
  So that the brainstorm skill consumes the opt-in as payload data and never
    reads config files itself

  Background:
    Given the `ratchet instructions brainstorm --json` invocation
    And it runs without `--change` and outside the artifact flow

  Scenario: The payload always carries a spikes object
    Given any project state
    When the invocation runs
    Then the emitted JSON carries a top-level "spikes" object with an "enabled" boolean
    And the process exits with code zero

  Scenario: Spikes explicitly enabled in project config
    Given a ".ratchet/config.yaml" whose "brainstorm" section sets "spikes" to true
    When the invocation runs from inside that project
    Then the emitted JSON reports spikes enabled as true

  Scenario: Spikes explicitly disabled in project config
    Given a ".ratchet/config.yaml" whose "brainstorm" section sets "spikes" to false
    When the invocation runs from inside that project
    Then the emitted JSON reports spikes enabled as false

  Scenario: Spikes default off when the config names no brainstorm section
    Given a ".ratchet/config.yaml" with no "brainstorm" section
    When the invocation runs from inside that project
    Then the emitted JSON reports spikes enabled as false

  Scenario: No ratchet root resolves to disabled without failing
    Given a directory with no ".ratchet" planning root above it
    When the invocation runs from that directory
    Then the emitted JSON reports spikes enabled as false
    And the process exits with code zero

  Scenario: An unreadable or malformed config resolves to disabled without failing
    Given a ".ratchet" planning root whose config cannot be parsed
    When the invocation runs from inside that project
    Then the emitted JSON reports spikes enabled as false
    And the process exits with code zero

  Scenario: The project config schema accepts an optional brainstorm section
    Given the project config schema
    When a config with a "brainstorm" section holding a boolean "spikes" key is validated
    Then the section loads as a typed optional section
    And a malformed "brainstorm" section is dropped with a warning while valid sibling fields load

  Scenario: The new surface is Reference-documented
    Given the shipped documentation set
    When a reader looks up the surface
    Then "docs/commands/instructions.md" documents the brainstorm special-case payload
    And "docs/configuration/config-yaml.md" documents the "brainstorm.spikes" key
    And README.md matches the shipped behavior
