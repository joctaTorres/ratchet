---
tag: eval-holdouts
---

# Eval hold-out authoring

> Concern: testing

## Intent

The `@holdout` Gherkin tag is ratchet's anti-overfitting mechanism for
eval-driven projects: a `@holdout`-tagged scenario is stripped from the spec the
building agent can see at **apply** time, so the implementation cannot be tuned
to satisfy a test it was never shown. This standard governs **when and how a
proposal authors `@holdout` tags** so the mechanism does its one job — measuring
generalization on projects that actually run evals — instead of silently grading
an implementer against scenarios it could never have read. The default is to add
**no** hold-outs; tagging is a deliberate, eval-intent-only act.

## Guidelines

- **Default to no `@holdout`.** A proposal must not tag any scenario `@holdout`
  unless the project has genuine **eval intent** — it runs `ratchet eval run`, or
  it carries an eval suite (`.ratchet/evals/` specs, fixtures, or an invariant
  manifest). For an ordinary change on a project with no eval usage, hold-outs
  accomplish nothing and actively harm: the implementer is graded on a spec it
  never saw, which reads as a broken tool. When in doubt, do not tag.
- **Establish eval intent before tagging.** Only author `@holdout` when
  `.ratchet/evals/` exists (specs/fixtures/`invariants.yaml`) or the project
  otherwise demonstrates it drives `ratchet eval run`. Absence of an eval suite is
  a hard signal to leave every scenario visible.
- **Hold out generalization, not the obvious.** When eval intent is present, tag a
  **small** number of scenarios — roughly **1–3** — that test **stretch / edge /
  non-obvious** behavior: cases that cannot be trivially satisfied by
  pattern-matching the visible scenarios. Never hold out the core happy-path or
  the scenarios that define the change's basic contract; those must stay visible so
  the implementer can build to them.
- **Keep the selection unpredictable.** A hold-out's value dies the moment the
  implementer can guess which scenario was held out. Do not tag by a mechanical,
  guessable rule (e.g. "always the last scenario", "every error case"). Vary the
  choice per change so the held-out behavior cannot be inferred from the visible
  spec.
- **Never rely on hold-outs to change apply/verify behavior on non-eval projects.**
  Hold-outs are inert wherever no eval runs. If a scenario's enforcement matters
  for an ordinary change, it must be a normal, visible scenario — not a `@holdout`
  the apply/verify path will simply not see.
- **Know the enforcement boundary — state it, don't fight it.** Held-out scenarios
  are enforced by `ratchet eval run`, **not** by `rct:verify`. At **apply** time
  `@holdout` scenarios are stripped from the building agent's materialized spec,
  and at **`rct:verify`** time they are **also invisible** — verify reads the same
  filtered copy **by design**, because verify feedback loops back into the apply
  cycle and revealing a held-out scenario at verify would leak exactly what the
  hold-out hides. Do not author hold-outs expecting `rct:verify` to catch them, and
  do not attempt to make verify see them.
- **A hold-out only pays off under an eval baseline.** Because enforcement lives in
  `ratchet eval run`, a `@holdout` scenario has no grading effect until it is a
  bound eval case scored against a baseline. Tagging without that binding measures
  nothing; ensure eval intent is real, not aspirational, before tagging.

## Applies to

Every proposal that authors or edits Gherkin `.feature` scenarios for a change on
a project that runs evals. The `propose` flow — which already receives the
applicable-standards array via `ratchet instructions <artifact-id> --json` — must
apply this standard when deciding whether to add `@holdout` tags: default to none,
tag only under genuine eval intent, hold out a small, unpredictable set of
generalization scenarios, and respect the eval-run-vs-verify enforcement boundary.

## Implemented by

<!-- ratchet:implemented-by — generated from .ratchet/features/<capability>/.ratchet.yaml; do not edit by hand -->
