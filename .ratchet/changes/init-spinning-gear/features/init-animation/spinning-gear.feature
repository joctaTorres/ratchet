Feature: Spinning gear init animation
  As a user running `ratchet init`
  I want the animated welcome screen to show a continuously spinning gear
  So that the setup feels alive and reinforces Ratchet's mechanical "ratchet/gear" identity

  Background:
    Given the welcome screen renders ASCII art side-by-side with the welcome text

  Scenario: Gear spins continuously while waiting for the user
    Given a terminal that supports animation
    When the welcome screen is displayed during init
    Then the ASCII art shows a gear that rotates one step on every frame
    And the rotation loops seamlessly so the last frame flows back into the first
    And the gear keeps spinning until the user presses Enter

  Scenario: Every frame depicts a complete gear at a different rotation
    Given the welcome animation frame set
    When any single frame is rendered
    Then that frame shows a recognizable, fully-formed gear
    But the gear's teeth are offset from the previous frame to convey rotation

  Scenario: Frames keep uniform dimensions for clean redraw
    Given the welcome animation frame set
    When the frames are inspected
    Then every frame has the same number of rows as the first frame
    And every row fits within the fixed art column width used by the renderer
    So that the cursor-up redraw overwrites each frame without leaving residue

  Scenario: Static fallback shows a complete gear in non-animating terminals
    Given a terminal that does not support animation
    When the welcome screen is displayed during init
    Then a single static frame is printed once
    And that frame shows a complete gear rather than a partial or empty shape

  Scenario: Gear art respects Unicode capability
    Given a terminal without full Unicode support
    When the gear animation is rendered
    Then the gear is drawn using the ASCII fallback character set
    And no characters outside the supported set are emitted
