Feature: the animated welcome screen renders and gates animation correctly
  As a maintainer holding ratchet to the testing standard
  I want src/ui/welcome-screen.ts's render, capability, and input paths under test
  So that the static fallback, the animation gate, and the Enter wait are proven

  # src/ui/welcome-screen.ts has no test today and is one of the files named in
  # this phase's definition of done. Its behavior is pure-logic plus thin process
  # I/O: getWelcomeText builds the right column, renderFrame pads the art column to
  # ART_COLUMN_WIDTH and prefixes the clear-line escape, canAnimate gates on
  # isTTY/NO_COLOR/terminal width, waitForEnter resolves on a non-TTY stdin and on
  # Enter, and showWelcomeScreen takes the static-fallback branch when animation is
  # unavailable. These scenarios drive those branches at the unit layer with
  # process.stdout/stdin and process.env stubbed and restored per test — no
  # spawn, no real terminal — per the testing standard.

  Background:
    Given process.stdout (isTTY, columns, write) and process.env are stubbed per test
    And every stub is restored in afterEach so tests are order-independent

  Scenario: the welcome text lists the framework, setup items, and quick-start verbs
    When getWelcomeText is rendered into a frame
    Then the output contains "Welcome to Ratchet"
    And it names the /rct:propose, /rct:apply, and /rct:archive quick-start verbs
    And it ends with the "Press Enter to select tools..." prompt

  Scenario: a rendered frame pads the art column and clears the line
    Given an art line shorter than ART_COLUMN_WIDTH beside a text line
    When a frame is rendered
    Then the art segment is padded to ART_COLUMN_WIDTH before the text
    And each line is prefixed with the clear-line escape sequence

  Scenario: animation is disabled when stdout is not a TTY
    Given process.stdout.isTTY is false
    Then canAnimate reports false

  Scenario: animation is disabled when NO_COLOR is set
    Given process.stdout.isTTY is true and process.env.NO_COLOR is set
    Then canAnimate reports false

  Scenario: animation is disabled on a terminal narrower than the minimum width
    Given process.stdout.isTTY is true and process.stdout.columns is below the minimum
    Then canAnimate reports false

  Scenario: animation is enabled on a wide colour-capable TTY
    Given process.stdout.isTTY is true, NO_COLOR is unset, and columns are wide
    Then canAnimate reports true

  Scenario: showWelcomeScreen prints a single static frame when animation is unavailable
    Given canAnimate would return false (non-TTY stdout)
    When showWelcomeScreen is awaited
    Then exactly one complete static frame is written to stdout
    And the call resolves without starting an animation interval

  Scenario: showWelcomeScreen resolves immediately when stdin is not a TTY
    Given a non-TTY stdout so the static branch is taken and stdin is not a TTY
    When showWelcomeScreen is awaited
    Then it resolves without waiting for a keypress
