Feature: Validate warns on a plan without a Non-goals section
  As a developer running ratchet validate on a change
  I want a missing "## Non-goals" section in plan.md reported as a WARNING — never an ERROR
  So that plans authored before the section existed keep validating, while new
  plans are nudged to record what the change deliberately will not do

  Background:
    Given the plan validation rules in "src/core/validation/validator.ts" and
    the validation message constants in "src/core/validation/constants.ts"

  Scenario: A plan without a Non-goals section is warned, not errored
    Given a plan.md with "## Why", "## What Changes", "## Design", and "## Tasks" sections
    And the plan.md has no "## Non-goals" section
    When the plan is validated
    Then a WARNING issue is reported for the missing "## Non-goals" section
    And no ERROR issue is reported for the missing "## Non-goals" section
    And the plan is still valid

  Scenario: A plan with a Non-goals section draws no Non-goals issue
    Given a plan.md with "## Why", "## What Changes", "## Non-goals", "## Design", and "## Tasks" sections
    When the plan is validated
    Then no reported issue mentions the "## Non-goals" section
    And the plan is still valid

  Scenario: The missing-Non-goals warning names the section and the remedy
    Given a plan.md with "## Why", "## What Changes", "## Design", and "## Tasks" sections
    And the plan.md has no "## Non-goals" section
    When the plan is validated
    Then the WARNING message names "## Non-goals"
    And the WARNING message directs recording what the change deliberately will not do
    And the WARNING message allows stating explicitly that nothing was ruled out

  Scenario: Every existing and archived plan still validates without a new ERROR
    Given every plan.md under the repository's active changes and its change archive
    When each plan is validated
    Then no plan reports an ERROR issue from the missing-Non-goals check
    And every plan that validated before the check still validates
