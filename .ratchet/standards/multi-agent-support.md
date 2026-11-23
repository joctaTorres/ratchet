---
tag: multi-agent-support
---

# Multi-agent support

> Concern: architecture

## Intent

Ratchet is tool-agnostic by design: it integrates with every coding agent in the
supported-tools registry — the set of agents `ratchet init` and `ratchet update`
generate skills and commands for. Every change to this repo must assume and
preserve that tool-agnosticism; nothing ratchet does, generates, or documents
may be tuned for only one agent.

## Guidelines

- Every change to this repo must treat ratchet as tool-agnostic. Core logic, CLI
  behavior, generated artifacts, and documentation must work the same regardless
  of which coding agent drives ratchet — never special-case one agent in shared
  code paths.
- Any change that adds or modifies a skill, command, or other generated artifact
  must produce it for **every** agent in the supported-tools registry, not just
  one. A new skill that only lands in one agent's configuration directory is
  incomplete.
- Define skill and command content once as tool-agnostic shared content, and
  render it per agent through the adapter layer. The shared-template layer
  authors the body; the adapter layer owns only per-agent formatting and file
  placement. Never hand-author agent-specific copies of shared content.
- Shared template bodies must not assume agent-specific capabilities. Any
  reference to an agent-specific capability in shared content must use the
  capability-plus-fallback form: name the capability, optionally cite one
  agent's tool as an example — a structured-question capability such as
  AskUserQuestion, a progress-tracking capability such as TodoWrite — qualify it
  with "if your agent has one", and pair it with an "otherwise …" plain-prose
  fallback that works in any agent. Shared content must never instruct the agent
  to use a bare agent-specific tool name.
- Shared content that references another ratchet workflow must use the canonical
  `/rct:<name>` invocation form, never an agent-specific invocation syntax.
- Shared content must not branch on which agent is running: no prose of the form
  "if you are <agent>, do X" and no per-agent instruction variants. The
  capability-plus-fallback form is the only permitted way to acknowledge agent
  differences.
- Naming in shared content must be agent-neutral: refer to "the coding agent" or
  "your agent", never to a specific agent by name, except where an
  agent-specific adapter or file is genuinely the subject.
- Adding support for a new coding agent means: an entry in the supported-tools
  registry, a command adapter registered for the agent, and skills and commands
  rendered into that agent's directory by `ratchet init` — with no changes to
  shared template logic.
- At proposal time, any change with an agent-facing surface (skills, commands,
  templates, docs, CLI output an agent consumes) must enumerate the per-agent
  outputs (file paths per agent) in its plan, so the multi-agent surface is
  explicit before implementation starts.
- Tests for skill/command generation must assert output for all registered
  agents — by iterating the supported-tools registry — not just a single
  hard-coded agent.

## Applies to

Every change that alters ratchet — core logic, CLI, `ratchet init`, skill or
command generation, shared templates, adapters, and any documentation describing
how agents drive ratchet. All changes in this repo must assume ratchet is
tool-agnostic.

## Implemented by

<!-- ratchet:implemented-by — generated from .ratchet/features/<capability>/.ratchet.yaml; do not edit by hand -->

- batch-archive/archive-command.feature
- batch-archive/done-gate.feature
- batch-archive/listing-excludes-archive.feature
- batch-archive/workflow-surface.feature
- propose-batch/gated-chain-in.feature
- propose-batch/multi-agent-surface.feature
- propose-batch/phase-elicitation.feature
- propose-batch/proof-of-work-required.feature
- propose-batch/reject-horizontal-phases.feature
- propose-batch/scaffold-manifest.feature
