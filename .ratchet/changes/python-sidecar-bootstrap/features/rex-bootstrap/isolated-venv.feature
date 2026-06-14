Feature: Isolated ratchet-owned Python runtime for the sidecar
  As ratchet needing swe-rex available without touching the user's environment
  I want the bootstrap to build an isolated venv containing a pinned swe-rex
  So that the sidecar can be launched reproducibly without polluting global Python

  Background:
    Given a host with a usable Python interpreter version 3.10 or newer
    And no ratchet-owned ReX venv exists yet

  Scenario: Bootstrap creates an isolated venv with the pinned swe-rex
    When the ReX runtime bootstrap is run
    Then it creates a venv under a ratchet-owned cache directory, not the user's global site-packages
    And it installs the pinned swe-rex version into that venv
    And swe-rex is importable from the venv's Python interpreter
    And it returns a resolved launch command (interpreter path, args, and env) for the sidecar

  Scenario: The bootstrap prefers uv when available and falls back otherwise
    Given the bootstrap must create the venv
    When the "uv" tool is available on PATH
    Then the bootstrap uses uv to create the venv and install swe-rex
    But when "uv" is not available
    Then the bootstrap falls back to "python -m venv" plus pip

  Scenario: The resolved launch command can start the sidecar
    Given the venv has been bootstrapped
    When the resolved launch command is used to start the sidecar script
    Then the sidecar imports swe-rex successfully and emits "ready"
