Feature: Landing page at the site root
  As a first-time visitor
  I want a distinctive landing page at the site root
  So that I understand what ratchet is and can jump into the docs

  Background:
    Given the documentation site is built
    And a visitor opens the site root "/"

  Scenario: The hero introduces ratchet and links into the docs
    When the landing page renders
    Then the hero shows the ratchet logo
    And the hero shows the project name and tagline
    And a primary "Read the docs" call to action links to "/docs/intro"
    And a secondary call to action links to the project's GitHub repository

  Scenario: The landing page summarizes ratchet's capabilities
    When the landing page renders
    Then a row of three feature cards is shown
    And the cards summarize spec-driven development, BDD/Gherkin features, and batch orchestration
    And the card copy is consistent with the project README

  Scenario: The landing page applies the machined dark-first theme
    When the landing page renders
    Then a dark-first theme with a single sharp accent color is applied via theme CSS variables
    And the hero headline uses a monospaced display typeface
    And body text uses a humanist sans typeface that is not Inter or Roboto
    And the page load reveals the hero and feature cards with a staggered animation
