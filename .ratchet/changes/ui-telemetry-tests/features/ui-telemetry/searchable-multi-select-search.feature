Feature: the searchable multi-select filters, paginates, and renders state
  As a maintainer holding ratchet to the testing standard
  I want src/prompts/searchable-multi-select.ts's search and render paths under test
  So that filtering, backspace, pagination, status labels, and the done view are proven

  # test/prompts/searchable-multi-select.test.ts already covers Space/Enter/Tab and
  # the hint text, but the file's remaining branches are uncovered: typing to
  # filter (printable char input -> filteredChoices), the no-matches render,
  # backspace deleting a search char versus removing the last selected item,
  # cursor clamping at the list bounds, the pagination window + "(page/total)"
  # indicator when choices exceed pageSize, the per-item status suffixes
  # (configured / detected / selected / refresh), the selected-chips row, and the
  # done-state render (joined names, and "(none)" when empty). These scenarios
  # extend the existing @inquirer/core-mocked harness to drive those branches at
  # the unit layer, per the testing standard.

  Background:
    Given the @inquirer/core hook system is mocked and re-renders on state change
    And a fresh prompt is set up per test with a known set of choices

  Scenario: typing filters the choice list by name and value
    When a character matching only one choice is typed
    Then the rendered list shows only the matching choice

  Scenario: a search term that matches nothing renders the no-matches notice
    When a character that matches no choice is typed
    Then the rendered output contains the "No matches" notice

  Scenario: backspace deletes a search character before removing selections
    Given a search term has been typed
    When Backspace is pressed
    Then the trailing search character is removed and selections are untouched

  Scenario: backspace removes the last selected item when the search box is empty
    Given the search box is empty and at least one item is selected
    When Backspace is pressed
    Then the most recently selected item is removed

  Scenario: the cursor is clamped at the top and bottom of the list
    When Up is pressed at the first item and Down is pressed past the last item
    Then the cursor never moves outside the list bounds

  Scenario: a list longer than the page size shows a pagination indicator
    Given more choices than the page size
    When the prompt renders
    Then a "(current/total)" page indicator is shown

  Scenario: choices render configured, detected, and selected status suffixes
    Given choices flagged configured and detected
    When the prompt renders and a configured choice is toggled on
    Then unselected choices show "(configured)" or "(detected)" and the toggled one shows "(refresh)"

  Scenario: the selected-chips row reflects the current selection
    When an item is toggled on
    Then the rendered "Selected:" row lists that item's name and not "(none selected)"

  Scenario: the done view joins selected names and shows "(none)" when empty
    When the prompt is confirmed with no selection
    Then the done-state render shows "(none)"
