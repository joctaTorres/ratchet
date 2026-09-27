# Fixture: issue-scope-reconciliation

The worked example from
[issue #100](https://github.com/joctaTorres/ratchet/issues/100), reassembled as
a self-contained ratchet project so the hardened reconciliation procedure can be
replayed against it.

| File | What it is |
| --- | --- |
| `issue-80.md` | Issue #80's text, verbatim. Its Why names the permission-posture bypass; its fix proposal hedges the gating requirement as "**Consider** requiring an explicit opt-in pairing flag". |
| `manifest-excerpt.yaml` | The phase-one contract that hard-codes `Closes #80` in `goal` and `success`, and whose `gate-and-mark-agent-cmd-override` change `done` ends "Fixes #80." |
| `phase-1-plan.md` | The shipped phase-one plan carrying the self-approved `## Out of scope` de-scope bullet. |

Every file here is an **input** — a record of what the unhardened workflows
produced. None of it is a model to copy.

The three escapes the reconciliation procedure must flag:

1. The issue's gating requirement (fix item 3) is present in the issue and
   absent from the authored scope — and its hedged "Consider" wording does not
   lower the bar, because the exposure is a permission bypass.
2. The permission-posture bypass named in the issue's Why (problem 2) is absent
   from the authored scope and was never even noted as deferred.
3. The manifest's hard-coded `Closes #80` / "Fixes #80." is premature: the
   issue's material requirements are not all implemented.
