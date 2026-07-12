Feature: Sidecar docker image defers to REX_IMAGE
  As a ratchet maintainer
  I want sidecar.py to take the docker image only from the REX_IMAGE
  environment variable that Node always threads
  So that the image default is declared once, in config.ts, not re-declared in Python

  Scenario: The Python-side image literal is removed
    Given sidecar.py previously re-declared DEFAULT_DOCKER_IMAGE = "python:3.12"
    When the docker deployment is built after this change
    Then sidecar.py contains no hardcoded default image literal
    And config.ts remains the single declaration of DEFAULT_DOCKER_IMAGE

  Scenario: Docker deployment uses the threaded REX_IMAGE
    Given REX_IMAGE is set to an image reference in the sidecar environment
    When the sidecar builds a docker deployment
    Then the deployment uses exactly that image reference

  Scenario: A missing REX_IMAGE fails loudly instead of silently defaulting
    Given REX_IMAGE is unset or empty in the sidecar environment
    When the sidecar is asked to build a docker deployment
    Then it raises a clear error naming REX_IMAGE as required for the docker locus
    And it does not silently fall back to any built-in image
