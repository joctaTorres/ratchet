Feature: Archive-batch guided workflow across all supported agents
  As a coding agent driving a batch to completion
  I want a guided archive step that closes the batch lifecycle
  So that the batch workflow ends in archive rather than leaving finished
  batches in the active directory forever

  Background:
    Given the supported-tools registry in "src/core/config.ts"
    And the per-agent command/skill adapter registry

  Scenario: The archive-batch workflow body is defined once as shared content
    Given the shared workflow templates directory
    Then there is a single archive-batch workflow body shared across agents
    And it is rendered per agent through the adapter registry
    And it is not hand-authored per agent

  Scenario: ratchet init generates the archive-batch surface for every agent
    When "ratchet init" generates command and skill surfaces
    Then each agent in the supported-tools registry receives the archive-batch surface
    And no agent in the registry is missing it

  Scenario: The workflow drives the cascading archive command
    Given a batch whose changes are all done
    When the archive-batch workflow runs
    Then it reports the derived batch status to the user
    And it invokes "ratchet batch archive <name>" to perform the cascade and move
    And it does not move directories by hand

  Scenario: The workflow body is agent-neutral
    When the archive-batch workflow body is rendered
    Then it refers to "your agent" or "the coding agent" rather than naming one agent
    And any step that uses an agent-specific tool offers a plain-prose fallback

  Scenario: The apply-batch workflow points to archive as the terminal step
    Given the apply-batch workflow
    When a batch reaches done
    Then the workflow tells the user the next step is to archive the batch
