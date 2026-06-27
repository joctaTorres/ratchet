---
tag: generalizable-defaults
---

# Generalizable defaults

> Concern: architecture

## Intent

Ratchet runs inside arbitrary user repositories and writes artifacts and
instructions into them. Any default value or behavior ratchet ships that executes
in, or is written into, a ratchet user's repository must be ecosystem-agnostic: it
must never assume a particular package manager, test runner, build tool,
language/toolchain, command string, or tool-specific path. This standard exists to
prevent ratchet's own development toolchain from leaking into the projects that
consume it.

## Guidelines

- **No shipped default may hardcode a specific ecosystem or toolchain.** A default
  that executes in, or is written into, a consuming repository must not name a
  particular package manager, test runner, build tool, language/toolchain, command
  string, or absolute/tool-specific path (e.g. `pnpm vitest run`, `npm test`,
  `cargo test`, `/usr/local/bin/...`). What works in ratchet's own repo must not be
  assumed to work in the user's.
- **Default proof-of-work commands must be project-derived or a neutral
  placeholder.** A default proof-of-work that ships into change artifacts or agent
  instructions must either be derived from the user's project configuration or
  detected environment, or be a neutral, clearly-labeled placeholder the user is
  required to fill in. It must never default to a literal command string from
  ratchet's own toolchain. The `DEFAULT_PROOF_OF_WORK.run = 'pnpm vitest run'`
  baked into the headless verbs is the motivating example: a ratchet-specific
  command written verbatim into every consuming project's instructions, regardless
  of whether that project uses pnpm or vitest.
- **The same rule covers every generated command, script, template, and config
  default.** Anything ratchet generates into a user's repository — a command in a
  template, a script body, a config key's default value, a scaffolded file — must
  be ecosystem-agnostic by the same standard, not only proof-of-work.
- **Any literal shipped into change artifacts or agent instructions must
  generalize.** A command, path, or toolchain name embedded in a feature, plan,
  manifest, skill, or agent instruction reaches the user's repository and must not
  carry ratchet's own toolchain with it.
- **Derive, detect, or require — never assume.** When a default genuinely needs a
  project-specific command, derive it from the user's project configuration or
  detected environment; if neither is available, emit a neutral placeholder the
  user must fill in and label it as such. Do not silently fall back to a value that
  only happens to work in ratchet's repository.
- **This is distinct from `multi-agent-support`.** That standard requires being
  agnostic across coding *agents*; this one requires being agnostic across the
  user's *project ecosystem/toolchain*. A default can satisfy one and violate the
  other.
- **Verification treats a leaked toolchain default as a defect.** A change that
  introduces or modifies a shipped default carrying a ratchet-specific package
  manager, test runner, build tool, language/toolchain, command string, or
  tool-specific path does not satisfy this standard.

## Applies to

Every change that introduces or modifies a default — a value or behavior — that
ships to, or runs in, a consuming project: proof-of-work defaults, generated
commands, scripts, templates, config-key defaults, and any literal embedded in
change artifacts or agent instructions.
