Feature: Proposing and applying changes via /rct: workflows
  As a developer working with an AI agent
  I want propose to scaffold a change and apply to implement it
  So that the agent produces features and a plan, then satisfies each scenario

  Scenario: Propose clarifies, names, and scaffolds an apply-ready change
    Given a vague feature request from the user
    When the agent runs the /rct:propose workflow
    Then it clarifies the intent before scaffolding
    And it derives a kebab-case change name and writes features plus a plan until the change is apply-ready

  Scenario: Apply implements against context files and updates the plan
    Given an apply-ready change
    When the agent runs the /rct:apply workflow
    Then it reads every path listed under "contextFiles" from the apply instructions
    And it implements against each scenario's Given/When/Then and flips "- [ ]" to "- [x]" in plan.md

  Scenario: Apply stops on the workspace-planning guard
    Given the apply instructions report actionContext mode "workspace-planning"
    When the agent runs the /rct:apply workflow
    Then it explains that workspace planning is not supported in this slice
    And it stops without implementing
