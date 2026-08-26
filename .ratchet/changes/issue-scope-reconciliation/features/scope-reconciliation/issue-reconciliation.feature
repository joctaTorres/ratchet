Feature: Originating-issue reconciliation in change authoring
  As a maintainer whose work originates from tracked issues
  I want the propose and propose-batch workflows to reconcile authored scope against every originating issue
  So that a requirement the issue states can never be dropped without a human being asked

  Background:
    Given the ratchet workflow templates are the single source of the propose and propose-batch skill bodies
    And the generated skill and command artifacts for every supported coding agent render from those templates

  Scenario: Propose fetches every originating issue before authoring artifacts
    Given the propose workflow body
    When an author reads its steps
    Then it instructs the author to identify every originating issue referenced by the user, the batch manifest, or the injected done criterion
    And it instructs the author to fetch each originating issue through the project's issue tracker before writing any artifact
    And it names "gh issue view <n>" only as a GitHub example rather than a required command
    And it instructs the author to ask the user to paste the issue text when no tracker client is available

  Scenario: Propose reconciles authored scope against the fetched issue
    Given the propose workflow body
    When an author reads its reconciliation step
    Then it requires enumerating the issue's material requirements from both its explicit fix items and the problems named in its narrative
    And it requires mapping every enumerated requirement to an authored feature scenario or plan task
    And it requires listing every requirement that the authored scope does not cover

  Scenario: An omitted requirement is surfaced as an explicit decision point
    Given the propose workflow body
    When an author reads its rules for a requirement the authored scope omits
    Then it requires surfacing the omission to the user as an enumerated "issue asks X, this proposal does not include X" decision point before artifacts are finalized
    And it forbids self-approving the omission by writing it into plan prose

  Scenario: Propose-batch reconciles the manifest against the originating issues
    Given the propose-batch workflow body
    When an author reads its steps
    Then it instructs the author to fetch every issue an objective or phase originates from
    And it requires reconciling each phase goal, success criterion, and change-level done against those issues' material requirements
    And it requires surfacing any material requirement the manifest omits to the user before the manifest is scaffolded

  Scenario: The reconciliation rules reach every supported coding agent
    Given the propose and propose-batch command templates
    When each is rendered through every registered tool command adapter
    Then the rendered command file for every adapter contains the originating-issue reconciliation step
    And no adapter's rendering drops the prohibition on self-approved omissions
