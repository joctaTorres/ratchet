Feature: Sidecar unit tests wired into CI
  As a ratchet maintainer
  I want test_sidecar.py to run on every CI build with a packaging assertion
  So that sidecar regressions and a missing packaged sidecar fail the pipeline

  Scenario: A Makefile target runs the sidecar unit tests
    Given the repository Makefile
    When "make test-sidecar" is invoked
    Then it runs test_sidecar.py with the system python3 and no extra dependencies
    And the target exits non-zero when any sidecar unit test fails

  Scenario: CI runs the sidecar unit tests as a pipeline step
    Given the ci.yml workflow
    When the CI job runs
    Then a dedicated step invokes the sidecar-test Makefile target
    And a sidecar unit-test failure fails the CI job

  Scenario: The build asserts sidecar.py is packaged next to the compiled runtime module
    Given a build that compiles TypeScript into dist/
    When the asset-copy step finishes without producing dist/core/batch/engine/runtime/sidecar.py
    Then the build exits non-zero with an error naming the missing sidecar asset
    And it no longer merely prints a warning and continues
