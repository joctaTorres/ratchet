Feature: Web lifecycle harness fails fast without Playwright
  As a ratchet user running a web-tier eval on a machine without Playwright
  I want the harness to fail fast instead of triggering an implicit install
  So that an eval run never performs a surprise network install midway

  Scenario: The harness invokes Playwright with --no-install
    Given a web binding whose spec is executed by the harness
    When the harness runs the Playwright test command
    Then the command passes --no-install to npx
    And the harness never triggers an implicit Playwright install mid-run
