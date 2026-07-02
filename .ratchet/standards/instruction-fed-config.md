---
tag: instruction-fed-config
---

# Instruction-fed dynamic skill config

> Concern: architecture

## Intent

Ratchet skills are static templates. Their dynamic, project-specific,
config-driven behavior arrives at skill-invocation time as **data** — the payload
returned by `ratchet instructions <artifact-id>` (and its apply/verify
counterparts) — never by a skill reading config files inline or hard-coding
config-branching in template prose. The `ratchet instructions` command is the
single seam that assembles a skill's dynamic inputs — applicable project
standards, config-derived choices, resolved context — into one payload the skill
consults and acts on. This is the standard way to inject dynamic, config-driven
behavior into ratchet skills.

Project standards already reach skills this way: the applicable standards are
delivered as a `standards` array in the payload, not read by the skill. This
standard generalizes that principle to every config-driven and dynamic skill
input.

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
- **Agent-neutral by construction.** Because the dynamic inputs are DATA in the
  payload — identical for every agent — and the template body stays static, the
  resolved behavior does not change with the agent that consumes it. Config-driven
  behavior expressed as payload data cannot special-case one agent.
- **Config-driven decisions are surfaced, not self-served.** When a skill's
  behavior depends on user or project configuration, that decision is resolved
  into the payload and the skill acts on the resolved value — it does not read
  config or decide on its own. This standard governs the routing mechanism only; it
  does not define any particular config's authoring rules.
- **Verification treats an inline config read as a defect.** A change that makes a
  skill read config directly, or embeds config-branching in template prose,
  instead of extending the instructions payload and consuming it, does not satisfy
  this standard.

## Applies to

Any ratchet skill that needs configuration loading, routing, or dynamic behavior
driven by the user's or project's specific config — and any change that adds such
behavior. Route it through the `ratchet instructions <artifact-id>` payload and
have the skill consume it as data, keeping the assembly at the command/loader
layer.

## Implemented by

<!-- ratchet:implemented-by — generated from .ratchet/features/<capability>/.ratchet.yaml; do not edit by hand -->
