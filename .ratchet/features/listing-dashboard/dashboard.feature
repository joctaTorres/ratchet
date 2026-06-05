Feature: Interactive dashboard
  As a developer who wants an overview
  I want an interactive dashboard of changes and the feature store
  So that I can browse work and accumulated behavior in one view

  Scenario: The dashboard renders changes and features
    Given a project with active changes and a populated feature store
    When I run "ratchet view"
    Then an interactive dashboard renders the active changes
    And it renders the feature store capabilities alongside them

  Scenario: The dashboard works when the store is empty
    Given a freshly initialized project with no archived features
    When I run "ratchet view"
    Then the dashboard still renders without error
    And it shows that the feature store has no entries yet
