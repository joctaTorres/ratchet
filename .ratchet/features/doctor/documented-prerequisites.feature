Feature: Documented runtime prerequisites
  As someone evaluating or installing ratchet
  I want the prerequisites documented in the README
  So that I know what to install beyond `npm install` before running ratchet

  Scenario: README lists the non-npm runtime prerequisites
    Given the project README
    When I read its requirements section
    Then it states the required Node.js version
    And it states that a supported coding-agent CLI must be installed separately
    And it states that Python 3.10+ or uv is required for the SWE-ReX runtime
    And it states that Docker is required only for the docker execution locus
    And it points readers to "ratchet doctor" to validate their setup
