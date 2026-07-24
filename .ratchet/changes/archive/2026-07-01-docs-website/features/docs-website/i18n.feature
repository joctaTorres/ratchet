Feature: Internationalization support
  As a documentation maintainer
  I want i18n infrastructure enabled with English as the default
  So that translations can be added later without restructuring the site

  Background:
    Given the ratchet repository
    And a Docusaurus app at "website/"

  Scenario: English is the default locale and builds at the site root
    When the i18n configuration is inspected
    Then the default locale is "en"
    And the configured locales list contains "en"
    And the default-locale site is served at the root without a "/en/" path prefix

  Scenario: The site is ready to add a new language without rework
    Given only the "en" locale is configured
    When a maintainer follows the documented translation workflow
    Then a new locale can be added through the standard Docusaurus i18n directory convention
    And no locale switcher is shown while only one locale exists
