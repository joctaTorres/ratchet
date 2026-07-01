---
tag: instruction-fed-config
---

# Instruction-fed dynamic skill config

> Concern: architecture

## Intent

Ratchet skills are static, agent-neutral templates. Their dynamic,
project-specific, config-driven behavior arrives at skill-invocation time as
**data** — the payload returned by `ratchet instructions <artifact-id>` (and its
apply/verify counterparts) — never by the skill reading config files inline or
hard-coding config-branching in template prose. The `ratchet instructions`
command is the single seam that assembles a skill's dynamic inputs (applicable
project standards, config-derived choices, resolved context) into one payload the
skill consults and acts on. This is the standard way to inject dynamic behavior
into ratchet skills from ratchet config.

This already works today for **project standards**. `generateInstructions`
(`src/core/artifact-graph/instruction-loader.ts`) loads the project's standards
library and injects it into the payload as a `standards` array
(`src/core/artifact-graph/instruction-loader.ts` ~lines 320-325, 341; typed on
`ArtifactInstructions` ~lines 98-99 as `StandardDoc[]`, defined in
`src/core/standards.ts`). The `ratchet instructions <artifact-id> --json`
command surfaces that array (`src/commands/workflow/instructions.ts`), and the
propose workflow template consumes it directly from the JSON payload
(`src/core/templates/workflows/propose.ts` ~lines 63-84: "The instructions JSON
includes … `standards` … Embed the applicable `standards` into the artifact").
The rendered `rct:propose` / `rct:apply` / `rct:verify` skills that
`ratchet init` writes never read `.ratchet/standards/` themselves — the
instructions payload feeds them. That is the pattern this standard generalizes.

The pattern already extends beyond standards. The `heldOutCount` field added to
the apply-instructions payload (`ApplyInstructions` in
`src/commands/workflow/shared.ts`) is consumed by the verify skill's `VERIFY_BODY`
template to drive its hold-out warning — a second example of instruction-fed
dynamic data reaching a skill as payload data rather than as config the skill
reads on its own.

## Guidelines

- **Extend the payload, not the skill.** Any new config-driven or dynamic
  behavior that should influence a skill MUST be surfaced by extending the
  `ratchet instructions <artifact-id>` payload (or its apply/verify counterpart);
  the skill reads the resolved value/array from there. Do not add a new config
  read inside a skill to reach the same behavior.
- **Skills never read config directly.** Skills and skill templates MUST NOT read
  `.ratchet/config.yaml` (or other config files) directly, nor embed
  config-branching logic in template prose. They consume resolved values and
  arrays from the instructions payload. A skill that opens config, or that encodes
  "if config says X then …" in its prose, violates this standard.
- **The instructions command is the one assembly point.** The `ratchet
  instructions` command layer is the single place that merges standards + config +
  context into the payload. Keep that assembly at the command/loader layer
  (`instruction-loader.ts`, `src/commands/workflow/`), where it is unit-testable,
  rather than in fuzzy, untestable skill prose.
- **Agent-neutral by construction.** This composes with `multi-agent-support`:
  because the dynamic inputs are DATA in the payload — identical for every agent —
  and the template body stays static, the behavior is agent-neutral by
  construction. Config-driven behavior expressed as payload data cannot
  special-case one agent.
- **Precedent to follow.** Applicable standards flow to skills via the payload's
  `standards` array; new config-driven inputs flow the same way. The exemplar
  application: `propose` consults **hold-out configuration via the instructions
  payload** — whether/how to author `@holdout` tags is a decision surfaced through
  `ratchet instructions`, not something the propose skill reads from config or
  decides on its own. (This standard names that application; it does not define the
  hold-out authoring rules themselves — that is a separate concern.)
- **Verification treats an inline config read as a defect.** A change that makes a
  skill read config directly, or embeds config-branching in template prose,
  instead of extending the instructions payload and consuming it, does not satisfy
  this standard.

## Applies to

Every ratchet skill that consumes `ratchet instructions` — propose, apply, verify,
and the batch flows built on them — and every change that adds config-driven or
dynamic skill behavior. Such a change must route the new behavior through the
`ratchet instructions <artifact-id>` payload and have the skill consume it as
data, keeping the assembly at the command/loader layer.

## Implemented by

<!-- ratchet:implemented-by — generated from .ratchet/features/<capability>/.ratchet.yaml; do not edit by hand -->
