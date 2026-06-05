Feature: Change status for agents and humans
  As an agent or developer driving a change
  I want machine- and human-readable status of a change's artifacts
  So that I know what is done, what is blocked, and what to do next

  Scenario: Status as JSON reports the artifact graph and apply requirements
    Given a change "add-login" exists
    When I run "ratchet status --change add-login --json"
    Then the JSON reports the artifacts and their statuses
    And it includes "applyRequires", "planningHome", "changeRoot" and "artifactPaths"

  Scenario: A blocked artifact lists the dependencies that block it
    Given a change whose "plan" artifact has incomplete prerequisites
    When the change status is computed
    Then "plan" is shown as blocked
    And the blocking dependency is named

  Scenario: Status without a change name when none exist is informational
    Given a project with no active changes
    When I run "ratchet status" without specifying a change
    Then it reports that there are no active changes
    And it suggests creating one with "ratchet new change <name>"

  Scenario: A complete change is reported as complete
    Given a change whose every artifact is done
    When the change status is rendered as text
    Then the progress shows all artifacts complete
    And an all-complete message is shown
