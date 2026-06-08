Feature: Materializing standard links on archive
  As a developer archiving a completed change
  I want the change's standard links carried into the feature store and reflected back on the standards
  So that the permanent spec records which features satisfy which standards, without anyone hand-maintaining it

  Background:
    Given a project with a standard tagged "security"
    And a change "add-auth" that declares the security standard
    And the change adds features "auth/login.feature" and "auth/logout.feature"

  Scenario: Archiving carries the forward link into the feature store
    Given the change "add-auth" is ready to archive
    When I archive the change "add-auth"
    Then ".ratchet/features/auth/.ratchet.yaml" records that "login.feature" follows "security"
    And it records that "logout.feature" follows "security"

  Scenario: Archiving materializes the reverse link on the standard
    Given the change "add-auth" is ready to archive
    When I archive the change "add-auth"
    Then the "security" standard lists "auth/login.feature" and "auth/logout.feature" as implementing features
    And that list is a generated section, not hand-written

  Scenario: The reverse link is regenerated, never appended blindly
    Given the "security" standard already lists "auth/login.feature"
    And the change removes "auth/login.feature" via a tombstone
    When I archive the change
    Then the "security" standard no longer lists "auth/login.feature"

  Scenario: A second change extends the standard's implementing features
    Given the "security" standard already lists "auth/login.feature"
    And a later change "add-billing" declares the security standard and adds "billing/charge.feature"
    When I archive the change "add-billing"
    Then the "security" standard lists both "auth/login.feature" and "billing/charge.feature"

  Scenario: Archiving a change with no standards leaves the store links untouched
    Given a change "add-docs" that declares no standards
    When I archive the change "add-docs"
    Then no standard's implementing-features list changes
    And no standards sidecar is written for the change's features
