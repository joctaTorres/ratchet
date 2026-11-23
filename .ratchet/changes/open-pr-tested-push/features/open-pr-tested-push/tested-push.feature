Feature: Open-PR tested push
  As a ratchet user relying on /rct:open-pr to open the batch's pull request
  I want the open-pr workflow to push only a freshly tested tree, to never
  force-push, and to stop on a rejected push
  So that a pull request can no longer claim more than the workflow proved —
  no red tree is ever pushed, no PR is opened on an unrun or failing test
  result, and a rejected push is reported instead of silently retried

  Scenario: The open-pr body runs the project's own test command on the committed tree before pushing
    Given the shared workflow template for open-pr
    When its body is rendered
    Then it directs the agent to discover the project's own test command from
      the project itself — its package manifest test script, a Makefile test
      target, CI configuration, or whatever the project already declares —
      without adding new ratchet configuration and without assuming a toolchain
    And it directs the agent to run that command fresh on the committed tree —
      the exact commit that will be pushed — before any push
    And the test step sits between the commit step and the push step

  Scenario: A red or unrun test result stops the flow — no push, no pull request
    Given the shared workflow template for open-pr
    When its body is rendered
    Then it directs the agent to STOP and report the exact command and its
      failing result when the fresh test run fails
    And it forbids pushing a red tree and forbids opening the pull request on
      a red or unrun test result
    And it directs the agent to STOP and report when no test command can be
      discovered — the pull request is opened only on a fresh green run of the
      project's own test command

  Scenario: The open-pr body never force-pushes and stops on a rejected push
    Given the shared workflow template for open-pr
    When its body is rendered
    Then it forbids force-pushing under any circumstances — no `git push
      --force` and no `--force-with-lease`
    And it directs the agent to STOP and report a rejected push, naming the
      remote's rejection, instead of retrying the push or forcing it

  Scenario: The PR-step output cites the fresh test evidence
    Given the shared workflow template for open-pr
    When its body is rendered
    Then its output summary cites the exact test command discovered and run
      and its fresh green result alongside the commit, the pushed branch, and
      the single pull request opened
