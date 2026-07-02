---
tag: instruction-fed-config
---

# Instruction-fed dynamic skill config

> Concern: architecture

## Intent

Ratchet skills are static, agent-neutral templates. Their dynamic,
project-specific, config-driven behavior arrives at skill-invocation time as
**data** — the payload returned by `ratchet instructions <artifact-id>` (and its
apply/verify counterparts) — never by a skill reading config files inline or
hard-coding config-branching in template prose. The `ratchet instructions`
command is the single seam that assembles a skill's dynamic inputs — applicable
project standards, config-derived choices, resolved context — into one payload
the skill consults and acts on. This is the standard way to inject dynamic,
config-driven behavior into ratchet skills.

This already works for **project standards**. The applicable standards library
is resolved and injected into the instructions payload as a `standards` array;
`ratchet instructions <artifact-id>` surfaces it, and the propose skill embeds
the applicable standards from that payload. The rendered `rct:propose` /
`rct:apply` / `rct:verify` skills never read the standards library themselves —
the payload feeds them. The pattern already reaches beyond standards: a hold-out
count also travels on the apply/verify payload and drives the verify skill's
hold-out warning as payload data, not as config the skill reads on its own. This
standard generalizes that pattern to all config-driven and dynamic skill inputs.

## Guidelines

- **Extend the payload, not the skill.** Any new config-driven or dynamic
  behavior that should influence a skill MUST be surfaced by extending the
  `ratchet instructions <artifact-id>` payload (or its apply/verify counterpart);
  the skill reads the resolved value or array from there. Do not add a new config
  read inside a skill to reach the same behavior.
- **Skills never read config directly.** Skills and skill templates MUST NOT read
  ratchet config files directly, nor embed config-branching logic in template
  prose. They consume resolved values and arrays from the instructions payload. A
  skill that opens config, or that encodes "if config says X then …" in its prose,
  violates this standard.
- **The instructions command is the one assembly point.** The `ratchet
  instructions` command layer is the single place that merges standards, config,
  and context into the payload. Keep that assembly at the command/loader layer,
  where it is unit-testable, rather than in fuzzy, untestable skill prose.
- **Agent-neutral by construction.** This composes with `multi-agent-support`:
  because the dynamic inputs are DATA in the payload — identical for every agent —
  and the template body stays static, the behavior is agent-neutral by
  construction. Config-driven behavior expressed as payload data cannot
  special-case one agent.
- **Precedent to follow.** Applicable standards flow to skills via the payload's
  `standards` array; new config-driven inputs flow the same way. The exemplar
  application: `propose` consults **hold-out configuration via the instructions
  payload** — whether and how to author hold-out tags is a decision surfaced
  through `ratchet instructions`, not something the propose skill reads from config
  or decides on its own. (This standard names that application; it does not define
  the hold-out authoring rules themselves — that is a separate concern.)
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
