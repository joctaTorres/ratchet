Feature: batch view summarizes the real runtime isolation and posture
  As an operator inspecting a batch
  I want `ratchet batch view` to show the locus, its real isolation, and the posture with enforcement and source
  So that the batch's runtime story is honest wherever settings are displayed

  Scenario: batch view renders a runtime summary line
    Given a batch whose resolved locus is "local" and resolved posture is "repo-sandboxed-permissive"
    When I run `ratchet batch view <batch>`
    Then the output includes a runtime summary naming the locus and its isolation ("advisory — no isolation")
    And the summary names the posture with its source scope and per-agent enforcement status
