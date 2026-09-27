Feature: Batch-less report command
  As a headless agent advancing a standalone change
  I want a `ratchet report <change>` command
  So that my progress, blockers and completion land in the change-local journal the engine reads

  Scenario Outline: Each report kind appends to the change-local journal
    Given a project with an existing change "add-hello"
    When I run "ratchet report add-hello --<flag> \"note\""
    Then ".ratchet/changes/add-hello/.run/journal.jsonl" gains one "<kind>" entry for change "add-hello" with message "note"
    And no ".ratchet/batches" directory is created

    Examples:
      | flag        | kind        |
      | status      | progress    |
      | blocker     | blocker     |
      | needs-input | needs-input |
      | complete    | completion  |

  Scenario: A report during a fresh propose is accepted before the change directory exists
    Given a project with no change directory "new-idea" yet, as during a fresh `ratchet propose`
    When I run "ratchet report new-idea --blocker \"which database?\""
    Then ".ratchet/changes/new-idea/.run/journal.jsonl" gains one "blocker" entry for change "new-idea"

  Scenario Outline: An invalid change name is rejected before any path is built
    Given a project whose "src" directory exists
    When I run "ratchet report <name> --complete \"done\""
    Then the command fails naming the invalid change name
    And no ".run" directory is created anywhere in the project

    Examples:
      | name       |
      | ../../src  |
      | ../escape  |
      | Bad_Name   |

  Scenario: Exactly one report kind is required
    Given a project with an existing change "add-hello"
    When I run "ratchet report add-hello" with no report kind, or with both --status and --complete
    Then the command fails asking for exactly one of --status, --blocker, --needs-input or --complete

  Scenario: A standalone report is not captured by a lone batch in the project
    Given a project with an existing change "add-hello" and exactly one batch "b1"
    When I run "ratchet report add-hello --complete \"done\""
    Then the completion is appended to ".ratchet/changes/add-hello/.run/journal.jsonl"
    And the batch "b1" run journal is unchanged
