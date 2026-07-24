Feature: Animated hero logo on the landing page
  As a first-time visitor
  I want the hero logo enlarged and gently animated
  So that the landing page feels alive and draws the eye to the brand

  Background:
    Given the documentation site is built
    And a visitor opens the site root "/"

  Scenario: The hero logo is enlarged and spins slowly anti-clockwise
    When the landing page renders
    Then the hero logo is displayed at an enlarged size
    And it rotates continuously in the anti-clockwise direction
    And the rotation is slow

  Scenario: The logo animation respects reduced-motion preferences
    Given the visitor prefers reduced motion
    When the landing page renders
    Then the hero logo does not rotate
    And the hero logo remains visible
