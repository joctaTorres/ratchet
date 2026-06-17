---
tag: multi-agent-support
---

# Multi-agent support

> Concern: architecture

## Intent

Ratchet is tool-agnostic by design: it integrates with every coding agent supported
by `ratchet init` — Claude Code, Cursor, Codex, GitHub Copilot, and OpenCode (the
registry in `src/core/config.ts`). Every change to this repo must assume and preserve
that tool-agnosticism; nothing ratchet does, generates, or documents may be tuned for
only one agent (e.g. only Claude).

## Guidelines

- Every change to this repo must treat ratchet as tool-agnostic. Core logic, CLI
  behavior, generated artifacts, and documentation must work the same regardless of
  which coding agent drives ratchet — never special-case one agent in shared code
  paths.
- Any change that adds or modifies a skill, command, or other generated artifact
  must produce it for **every** agent in the supported-tools registry
  (`src/core/config.ts`), not just one. A new skill that only lands in `.claude/` is
  incomplete.
- Define skill and command content once as tool-agnostic shared content
  (`src/core/shared/skill-generation.ts` / `src/core/templates/`), and render it
  per agent through the adapter registry
  (`src/core/command-generation/registry.ts`). Never hand-author agent-specific
  copies of shared content.
- Shared template bodies must not assume agent-specific capabilities. If a step
  references a tool only one agent has (e.g. Claude Code's `AskUserQuestion`), the
  template must phrase it as optional with a plain-prose fallback that works in any
  agent.
- Naming in shared content must be agent-neutral: refer to "the coding agent" or
  "your agent", not "Claude", except where an agent-specific adapter or file is
  genuinely the subject.
- Adding support for a new coding agent means: an entry in the supported-tools
  registry (`src/core/config.ts`), a `ToolCommandAdapter` registered in
  `src/core/command-generation/registry.ts`, and skills/commands rendered into that
  agent's directory by `ratchet init` — no changes to shared template logic.
- At proposal time, any change with an agent-facing surface (skills, commands,
  templates, docs, CLI output an agent consumes) must enumerate the per-agent
  outputs (file paths per agent) in its plan, so the multi-agent surface is explicit
  before implementation starts.
- Tests for skill/command generation must assert output for all registered agents
  (or iterate the registry), not just a single hard-coded agent.

## Applies to

Every change that alters ratchet — core logic, CLI, `ratchet init`, skill or command
generation, shared templates, adapters, and any documentation describing how agents
drive ratchet. All changes in this repo must assume ratchet is tool-agnostic.

## Implemented by

<!-- ratchet:implemented-by — generated from .ratchet/features/<capability>/.ratchet.yaml; do not edit by hand -->

- propose-batch/gated-chain-in.feature
- propose-batch/multi-agent-surface.feature
- propose-batch/phase-elicitation.feature
- propose-batch/proof-of-work-required.feature
- propose-batch/reject-horizontal-phases.feature
- propose-batch/scaffold-manifest.feature
