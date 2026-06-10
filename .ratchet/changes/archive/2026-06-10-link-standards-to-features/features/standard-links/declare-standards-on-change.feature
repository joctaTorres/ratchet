Feature: Declaring standards on a change
  As a developer proposing a change
  I want the change to record which standards it follows
  So that the link from work to standards is captured up front and can be validated

  Background:
    Given a project with standards tagged "security" and "testing"

  Scenario: Propose records the chosen standards on the change
    Given I propose a change that must follow the security and testing standards
    When the proposal is created
    Then the change's ".ratchet.yaml" lists "security" and "testing" under "standards"

  Scenario: A change may follow no standards
    Given I propose a change that follows no particular standard
    When the proposal is created
    Then the change's ".ratchet.yaml" has no "standards" entry
    And the change is valid

  Scenario: Referencing an unknown standard tag is an error
    Given a change whose ".ratchet.yaml" lists the standard "nonexistent"
    When the change is validated
    Then validation reports an unknown standard tag "nonexistent"

  Scenario: Verify checks the change against its declared standards
    Given a change that declares the security standard
    When the change is verified
    Then verification checks the implementation against the security standard
    And it does not require standards the change never declared
