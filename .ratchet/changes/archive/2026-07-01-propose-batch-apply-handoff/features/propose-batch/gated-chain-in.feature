Feature: Gated hand-off to drive the batch via apply-batch
  As an engineer who has just defined a batch
  I want the skill to offer to drive the batch now with apply-batch
  So that I flow straight from proposing the manifest into orchestrating it,
  in this session or on my own later

  Background:
    Given the propose-batch workflow skill has written the batch manifest

  Scenario: Offer to drive the batch now via apply-batch
    Given the phases are defined and the manifest is complete
    When the manifest is written
    Then the skill offers to drive the batch now by running the apply-batch workflow on it
    And it presents this as an explicit gate, not an automatic action
    And it no longer offers to propose phase one's changes as the next step

  Scenario: Drive directly with the current session as orchestrator
    Given the user accepts the offer to drive the batch now
    When the skill continues
    Then it chains into the apply-batch workflow for this batch in the current session
    And the current session acts as the batch orchestrator

  Scenario: Defer to an indirect run by the user
    Given the user declines to drive the batch in this session
    When the skill continues
    Then it stops without creating any change directories
    And it tells the user they can drive the batch later by running apply-batch on it
    And it explains that changes are created lazily during "ratchet batch apply"

  Scenario: The hand-off is agent-neutral
    Given the propose-batch workflow body shared across coding agents
    When it presents the gated hand-off
    Then the hand-off names the apply-batch workflow without assuming a single coding agent
    And any structured-question step has a plain-prose fallback for agents without one
