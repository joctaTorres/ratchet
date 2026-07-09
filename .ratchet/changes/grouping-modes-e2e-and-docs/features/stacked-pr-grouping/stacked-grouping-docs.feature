Feature: Stacked PR grouping — Reference documentation and overview diagram
  As a reader of the ratchet docs
  I want the per-phase / per-change stacked grouping modes and the stacked-branch
  base rule described in the Reference docs and the README
  So that I can look up how stacked PRs are grouped and based, and see the
  stacking as a picture

  Scenario: The Reference doc carries a vertical Mermaid overview of stacked grouping
    Given the stacked PR grouping documentation in "docs/engine/agent-runtime.md"
    When I open its stacked-grouping overview
    Then it carries a valid Mermaid diagram of stacked base selection across groups
    And the diagram is vertically oriented (top-down)
    And every classDef sets an explicit "color:" for high contrast
    And the nodes are labelled with semantic Unicode symbols
    And the diagram depicts group 0 basing on the batch base branch and group N basing on group N-1's branch

  Scenario: The README documents the stacked modes with the same overview diagram
    Given the repository "README.md"
    When I read its coverage of PR grouping
    Then it documents "prGrouping: per-phase" as one stacked PR per completed phase
    And it documents "prGrouping: per-change" as one stacked PR per change
    And it states the stacked-branch base rule: group 0 targets the batch base branch and group N targets group N-1's branch
    And it carries the same high-contrast vertical Mermaid overview of stacked grouping

  Scenario: No documented passage describes the stacked wiring as unshipped
    Given the Reference and README descriptions of stacked PR grouping
    When I compare them against the shipped batch apply behavior
    Then no passage states that the per-boundary CLI surfacing lands in a later change
    And no passage states that nothing calls the stacked-base selection policy
    And they state that batch apply drives one stacked PR per group boundary, idempotently per group, through the pr stage
    And no described flag, default, or config key is stale
