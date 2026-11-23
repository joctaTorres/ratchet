Feature: Brainstorm spike guidance is payload-conditional
  As a maintainer of the brainstorm workflow
  I want the shared brainstorm body to offer throwaway spikes only when the
    `ratchet instructions brainstorm --json` payload reports `spikes.enabled`
    as true, and to never mention spikes otherwise
  So that the spike opt-in reaches the skill as payload data — never as a
    config read inside skill prose — and spike experiments stay user-approved,
    throwaway, and outside the tracked tree

  Background:
    Given the shared brainstorm body constant rendered into the
      ratchet-brainstorm skill and the rct-brainstorm command

  Scenario: The opt-in is read from the instructions payload, never from config
    Given the shared brainstorm body
    When its spike guidance is inspected
    Then it instructs the agent to read `spikes.enabled` from the
      `ratchet instructions brainstorm --json` payload
    And it forbids the agent from reading `.ratchet/config.yaml` directly

  Scenario: A spike offer requires the payload value true and explicit user approval
    Given the payload reports spikes enabled as true
    And an approach question is genuinely uncertain
    When the agent offers a spike
    Then the offer names what the spike would prove
    And no spike work begins before the user's explicit approval

  Scenario: A spike is throwaway, built outside the tracked tree
    Given the user has approved a spike
    When the spike is built
    Then it is built outside the tracked tree in a scratch location
    And it is thrown away once it has answered its question

  Scenario: Keeping anything from a spike routes as a new propose request
    Given a spike has produced something worth keeping
    When the agent routes the keeping
    Then it routes as a new /rct:propose request
    And the spike output is never merged into the project directly

  Scenario: Spikes are never mentioned when the value is false or unavailable
    Given the payload reports spikes enabled as false, or the payload is
      unavailable
    When the brainstorm dialogue runs
    Then the agent never mentions spikes

  Scenario: The guidance is pinned on every registered agent's rendered output
    Given the rendered-output assertions appended to
      test/core/shared/brainstorm-v7-rendered-output.test.ts
    When the brainstorm skill and command are rendered for each registered agent
    Then every rendered body carries the payload-conditional spike guidance
    And the checked agent set is non-empty and covers every registered agent

  Scenario: The assertions reject unconditional spike wording and config-direct reads
    Given a sample body that offers spikes without conditioning on the payload
    And a sample body that reads the config file directly
    When the spike-guidance assertions run against them
    Then the assertions fail

  Scenario: The guidance is Reference-documented
    Given the shipped documentation set
    When a reader looks up the generated brainstorm surface
    Then "docs/configuration/generated-artifacts.md" documents the
      payload-conditional spike guidance
