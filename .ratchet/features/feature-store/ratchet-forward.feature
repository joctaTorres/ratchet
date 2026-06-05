Feature: Ratcheting features into the permanent store
  As a team accumulating behavior over time
  I want archiving to copy a change's features into a permanent store by whole file
  So that the feature store is the living, authoritative description of the system

  Background:
    Given a permanent feature store at ".ratchet/features/"
    And a change with files under its "features/" directory

  Scenario: A new feature file is added to the store
    Given a change feature "user-auth/login.feature" with no matching store file
    When the change's features are applied to the store
    Then the file is copied to ".ratchet/features/user-auth/login.feature"
    And it is classified as added

  Scenario: A changed feature file overwrites the store copy by path
    Given a store already contains "user-auth/login.feature"
    And the change's version of that file differs byte-for-byte
    When the change's features are applied
    Then the store file is overwritten with the change's version
    And it is classified as overwritten

  Scenario: An identical feature file is left unchanged
    Given a store file that is byte-for-byte identical to the change's version
    When the change's features are applied
    Then the store file is not rewritten
    And it is classified as unchanged

  Scenario: The summary is grouped by capability
    Given a change touching several capabilities with a mix of new and changed files
    When the change's features are applied
    Then the result reports added, overwritten, deleted and unchanged counts per capability
    And totals across all capabilities are reported
