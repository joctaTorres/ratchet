Feature: Whole-batch PR flow — Reference documentation and overview diagram
  As a reader of the ratchet docs
  I want the whole-batch PR flow described in the Reference docs and the README
  So that I can look up prGrouping, the pr stage, and see the flow as a picture

  Scenario: The Reference doc leads the PR flow with a vertical Mermaid overview
    Given the "Completion PR step" flow in "docs/engine/agent-runtime.md"
    When I open its overview section
    Then its first artifact is a valid Mermaid diagram
    And the diagram is vertically oriented (top-down)
    And every classDef sets an explicit "color:" for high contrast
    And the nodes are labelled with semantic Unicode symbols
    And the diagram depicts the flow from batch completion through the spawned pr-stage agent to a single opened PR

  Scenario: The README documents prGrouping and the pr stage with the overview diagram
    Given the repository "README.md"
    When I read its coverage of batch PR opening
    Then it documents the "prGrouping" setting with "off" as the default and "whole-batch" as the single-PR mode
    And it documents "pr" as the fourth routable agent stage alongside propose, apply, and verify
    And it carries the same high-contrast vertical Mermaid overview of the whole-batch PR flow

  Scenario: The documented flow matches the shipped behavior
    Given the Reference and README descriptions of the whole-batch PR flow
    When I compare them against the e2e-proven behavior
    Then they state that PR opening runs only under "prGrouping: whole-batch"
    And they state that exactly one PR is opened at batch completion
    And they state that an off or unset batch opens no PR and behaves unchanged
    And no described flag, default, or config key is stale
