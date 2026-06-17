Feature: MIT-licensed open source project
  As a user or contributor
  I want the entire project released under the MIT license
  So that I can use, modify, and distribute it freely

  Scenario: The repository carries an MIT license
    Given the repository root
    When I look for a license file
    Then a LICENSE file is present declaring the MIT license

  Scenario: Package metadata declares MIT
    Given the published package manifests
    When I inspect each package.json license field
    Then every package declares "MIT"

  Scenario: No proprietary licensing remains anywhere
    Given the source tree
    When I search for license-key, authorization, or activation machinery
    Then no runtime license check, key, or activation gate exists
