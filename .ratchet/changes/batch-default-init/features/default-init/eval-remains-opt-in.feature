Feature: Eval workflow remains opt-in after batch becomes default
  As a ratchet maintainer
  I want only the batch workflow promoted into the default install
  So that the eval workflow stays opt-in and the change scope is contained

  Scenario: A stock init does not install the eval workflow
    Given a fresh project with no ratchet configuration
    When ratchet init runs with the default core profile
    Then the batch workflow is installed
    But the eval workflow is not installed

  Scenario: The core workflow set excludes eval
    Given the core profile is in effect
    When ratchet resolves the workflows for the core profile
    Then the resolved set includes "batch"
    But the resolved set does not include "eval"
