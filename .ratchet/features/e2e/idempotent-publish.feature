Feature: Phase proof — re-publishing an already-published version is an idempotent, green SKIP
  As a maintainer
  I want the blackbox publish harness to also prove the idempotent version guard
  So that I can see, end to end, that a new version reaches the (dry-run) publish path while an already-published version is SKIPped without erroring the pipeline

  Scenario: A new version on a green main reaches the dry-run publish path
    Given the package is built
    And the release gate ALLOWs on "main" with every wired gate green
    And the local version is not among the already-published versions
    When the version-guard runner is executed and its step output is captured
    Then the version guard records "should_publish=true"
    And the dry-run publish path is exercised and nothing is published
    And the pipeline exits zero

  Scenario: An already-published version is SKIPped without erroring the pipeline
    Given the package is built
    And the release gate ALLOWs on "main" with every wired gate green
    And the local version is already among the already-published versions
    When the version-guard runner is executed and its step output is captured
    Then the version guard records "should_publish=false"
    And the dry-run publish path is not reached
    And the pipeline still exits zero so the re-run is idempotent
