---
tag: multi-agent-support
---

# Multi-agent support

> Concern: architecture

## Intent

Ratchet integrates with every coding agent supported by `ratchet init` — Claude Code,
Cursor, Codex, GitHub Copilot, and OpenCode (the registry in `src/core/config.ts`).
Every change must serve all of these agents equally; nothing ratchet generates or
documents may be tuned for only one agent (e.g. only Claude).

## Guidelines

- Any change that adds or modifies a skill, command, or other init-generated artifact
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
- At proposal time, any change touching init-generated artifacts must enumerate the
  per-agent outputs (file paths per agent) in its plan, so the multi-agent surface is
  explicit before implementation starts.
- Tests for skill/command generation must assert output for all registered agents
  (or iterate the registry), not just a single hard-coded agent.

## Applies to

Every change that touches `ratchet init`, skill or command generation, shared
templates, adapters, or any documentation describing how agents drive ratchet.
Changes to unrelated core logic (parsing, storage, etc.) are exempt unless they alter
what init generates.
