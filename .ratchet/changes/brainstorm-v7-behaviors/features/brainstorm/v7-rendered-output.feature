Feature: Brainstorm v7 behaviors pinned on every agent's rendered output
  As a ratchet maintainer
  I want a test that renders the brainstorm skill and command for every
  registered agent and asserts each superpowers v7 behavior, restated in
  ratchet terms
  So that the shared brainstorm body cannot silently regress to the pre-change
  shape on any agent

  Background:
    Given the shared brainstorm body constant and the supported-tools registry

  Scenario: Every registered agent's rendered brainstorm output carries each v7 behavior
    Given the brainstorm skill template and command template
    When they are rendered for each registered agent
    Then every rendered body routes a complete request straight to /rct:propose at triage
    And every rendered body opens with why-first open questions before named options with a pick
    And every rendered body asks only when the answer changes what gets built, otherwise proceeding on defaults said aloud as a correctable proposal
    And every rendered body looks at the project before asking and sends a first-message echo
    And every rendered body presents approaches in their own message and allows one sensible way
    And every rendered body plays the design back in a compact 200-300-word summary that labels agent-filled proposals, with per-section approval kept
    And every rendered body offers a skip-ahead opt-out routing to /rct:propose
    And every rendered body steps up a size to /rct:propose-batch for work bigger than one change
    And every rendered body hands off the why, the approaches considered, and the non-goals into the chosen proposer

  Scenario: The v7 surface stays agent-neutral and defined once
    Given the brainstorm skill template and command template
    When they are inspected and rendered for each registered agent
    Then the skill template and the command template consume one shared body constant
    And every rendered body uses capability-plus-fallback phrasing for any agent-specific capability
    And every rendered body references other ratchet workflows only by their canonical /rct: names
    And no rendered body branches on which agent is running
    And the checked agent set is non-empty and covers every registered agent

  Scenario: The v7 assertions reject the pre-change body shape
    Given a sample brainstorm body in the pre-change shape — no triage, a
      multiple-choice-first questioning preference, forced two-to-three
      approaches, no playback, and no skip-ahead opt-out
    When the v7 rendered-output assertions run against it
    Then the assertions fail

  Scenario: The provenance header records the absorbed baseline
    Given the brainstorm workflow template source file
    When its provenance header is read
    Then it records the exact string "superpowers 7.0.2" as the absorbed upstream baseline

  Scenario: The restated surface is Reference-documented
    Given the shipped documentation set
    When a reader looks up the brainstorm workflow surface
    Then README.md's brainstorm descriptions match the v7 behaviors
    And the generated-artifacts Reference entry for the brainstorm surface is accurate
