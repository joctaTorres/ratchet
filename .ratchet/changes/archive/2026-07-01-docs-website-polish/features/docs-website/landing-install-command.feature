Feature: Install command on the landing page
  As a first-time visitor
  I want the install command shown on the landing page
  So that I can install ratchet without leaving the homepage

  Background:
    Given the documentation site is built
    And a visitor opens the site root "/"

  Scenario: The landing page shows the npx install command
    When the landing page renders
    Then an install command "npx ratchet-ai@beta init" is shown
    And the command is presented in a monospaced, copy-friendly code block

  Scenario: The install command is agent-neutral
    When the install command is shown
    Then it does not hard-code any single coding agent via the "--tools" option
