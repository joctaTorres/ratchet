Feature: Actionable prerequisite errors from the bootstrap
  As a user whose machine is missing a prerequisite
  I want a clear message telling me exactly what to install or do
  So that I never face a hang or a raw Python traceback

  Scenario: Missing a suitable Python interpreter yields an actionable error
    Given no Python interpreter version 3.10 or newer can be found on the host
    When the ReX runtime bootstrap is run
    Then it fails fast with a clear message naming the minimum required Python version
    And the message tells the user how to install or point ratchet at a suitable Python
    And it does not hang and does not print a raw stack trace

  Scenario: A failed venv build reports the cause and the remedy
    Given a suitable Python is present but the venv build fails, for example because the network is unavailable
    When the ReX runtime bootstrap is run
    Then it fails with a clear message describing what failed (creating the venv or installing swe-rex)
    And the message suggests a concrete remedy such as checking network access or installing uv
    And it does not leave a partially built venv that would be mistaken for a usable one

  Scenario: The verification path skips explicitly when prerequisites are unavailable
    Given the proof-of-work check for this change is run on a host without Python or network access
    When the check executes
    Then it prints an explicit SKIP message naming the missing prerequisite
    And it does not silently report success
