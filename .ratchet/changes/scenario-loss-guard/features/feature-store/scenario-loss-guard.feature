Feature: Scenario-loss guard for feature store application
  As a team accumulating behavior in the permanent feature store
  I want archive to refuse overwriting a store file when the change's version drops scenarios
  So that accepted behavior is never silently lost from the living specification

  Background:
    Given a permanent feature store at ".ratchet/features/"
    And a change with files under its "features/" directory

  Scenario: An overwrite that drops a store scenario is refused before anything is applied
    Given the store file "user-auth/login.feature" contains scenarios "Successful login" and "Locked account"
    And the change's version of "user-auth/login.feature" contains only "Successful login"
    When the change's features are applied without accepting removed scenarios
    Then the application fails listing "user-auth/login.feature" and the lost scenario "Locked account"
    And no file in the store is modified

  Scenario: Scenario Outline names are compared too
    Given the store file "billing/invoice.feature" contains a Scenario Outline "Totals with tax"
    And the change's version of "billing/invoice.feature" drops that outline
    When the change's features are applied without accepting removed scenarios
    Then the application fails listing the lost scenario "Totals with tax"

  Scenario: A renamed scenario is reported as a loss of the old name
    Given the store file "user-auth/login.feature" contains a scenario "Successful login"
    And the change's version renames it to "Login works"
    When the change's features are applied without accepting removed scenarios
    Then the application fails listing the lost scenario "Successful login"

  Scenario: Every lost scenario across every overwritten file is listed
    Given two store files each lose scenarios in the change's versions
    When the change's features are applied without accepting removed scenarios
    Then the failure lists every lost scenario name grouped by its store file
    And no file in the store is modified

  Scenario: A superset overwrite that keeps every store scenario applies normally
    Given the store file "user-auth/login.feature" contains a scenario "Successful login"
    And the change's version keeps "Successful login" and adds "Password reset"
    When the change's features are applied
    Then the store file is overwritten with the change's version
    And it is classified as overwritten

  Scenario: A file for a fresh capability adds without any guard check
    Given the store has no file "reports/monthly.feature"
    When the change's features are applied
    Then the file is copied to ".ratchet/features/reports/monthly.feature"
    And it is classified as added

  Scenario: A tombstoned store file is removed without a scenario check
    Given the store contains "user-auth/legacy.feature" with scenarios
    And the change's tombstone lists "user-auth/legacy.feature"
    When the change's features are applied
    Then the store file is removed
    And no scenario-loss refusal is raised for it

  Scenario: Accepting removed scenarios applies the overwrite
    Given the store file "user-auth/login.feature" contains a scenario "Locked account"
    And the change's version of "user-auth/login.feature" drops that scenario
    When the change's features are applied with removed scenarios accepted
    Then the store file is overwritten with the change's version
