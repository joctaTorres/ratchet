Feature: Spinning gear init animation
  As a user running `ratchet init`
  I want the welcome screen to show a smooth cogwheel spinning anti-clockwise
  So that the setup feels alive and reinforces Ratchet's mechanical gear identity

  Background:
    Given the welcome screen renders the gear art side-by-side with the welcome text

  Scenario: Gear spins anti-clockwise while waiting for the user
    Given a terminal that supports animation and Unicode
    When the welcome screen is displayed during init
    Then a cogwheel rendered with Braille sub-pixels rotates one step per frame
    And the rotation is anti-clockwise
    And the gear keeps spinning until the user presses Enter

  Scenario: Every frame is a complete cogwheel with squared teeth
    Given the welcome animation frame set
    When any single frame is rendered
    Then that frame shows a recognizable, fully-formed gear with a hollow centre
    And the teeth have flat (squared) tips rather than pointed ones
    But the teeth are offset from the previous frame to convey rotation

  Scenario: The rotation loops seamlessly
    Given the gear has evenly spaced teeth
    When the frames sweep a whole number of tooth pitches
    Then the last frame flows back into the first with no visible jump

  Scenario: Frames keep uniform dimensions for clean redraw
    Given the welcome animation frame set
    When the frames are inspected
    Then every frame has the same number of rows as the first frame
    And every row fits within the fixed art column width used by the renderer
    So that the cursor-up redraw overwrites each frame without leaving residue

  Scenario: Static fallback when the terminal cannot animate
    Given a terminal that is not a TTY, has NO_COLOR set, or is too narrow
    When the welcome screen is displayed during init
    Then a single static gear frame is printed once
    And that frame shows a complete gear rather than a partial or empty shape

  Scenario: Graceful degrade without Unicode support
    Given a terminal without full Unicode support
    When the welcome screen is displayed during init
    Then the gear is drawn without Braille code points
    And no characters outside the supported set are emitted
