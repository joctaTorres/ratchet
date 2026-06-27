---
title: ratchet init
sidebar_position: 10
---

# `ratchet init`

Initializes Ratchet in a project directory. Creates the `.ratchet/` directory structure, writes `config.yaml`, and generates AI tool skill files and slash commands for each selected tool.

## Synopsis

```bash
ratchet init [path] [options]
```

`[path]` is the target project directory. Defaults to `.` (current directory). If the directory does not exist, it is created.

## Options

| Option | Argument | Description |
|---|---|---|
| `--tools` | `<tools>` | Configure AI tools non-interactively. Accepts `all`, `none`, or a comma-separated list of tool IDs. When provided, interactive prompts are suppressed. |
| `--force` | | Auto-cleanup legacy files without prompting. |
| `--profile` | `<profile>` | Override the global config profile for this run. Accepted values: `core`, `custom`. |

## Behavior

1. **Path validation.** The resolved path must be a directory or must not exist (it is created). A non-directory file at the path is an error.

2. **Extend mode.** If `.ratchet/` already exists at the target path, `init` runs in extend mode: directories are ensured, skills and commands are refreshed for the selected tools, and an existing `config.yaml` is left intact.

3. **Legacy cleanup.** Before tool selection, `init` scans for legacy Ratchet artifacts. When found, interactive mode prompts for confirmation; `--force` or non-interactive mode proceeds automatically. Canceling in interactive mode exits with a message.

4. **Tool detection.** Available AI tool directories are scanned in the project (e.g., `.claude/`, `.cursor/`). Detected tools are pre-selected in the interactive prompt for first-time setup.

5. **Tool selection.**
   - With `--tools all`: all supported tools are selected.
   - With `--tools none`: no tools are selected; only directory structure and config are written.
   - With `--tools <id>[,<id>...]`: the comma-separated list is used directly.
   - Without `--tools` in a non-interactive environment (CI, pipe): detected tool directories are used; an error is raised if none are detected.
   - Without `--tools` in an interactive terminal: a searchable multi-select prompt is shown.

6. **Profile resolution.** The `--profile` flag overrides the global config profile for the current run. The profile determines which workflows are installed:
   - `core` (default): installs `propose`, `apply`, `verify`, `archive`, `propose-standard`, `apply-batch`, `archive-batch`, `propose-batch`, `brainstorm`.
   - `custom`: installs only the workflows listed in the global config's `workflows` field.

7. **Skill and command generation.** For each selected tool, `init` writes skill files under `<tool-dir>/skills/` and slash-command files via the tool's command adapter. The global config `delivery` setting controls whether skills, commands, or both are written.

8. **`config.yaml` creation.** `.ratchet/config.yaml` is created with the default schema on first init. In non-interactive mode without `--force`, config creation is skipped if the file does not already exist. An existing config file is never overwritten.

9. **Sandbox permission setup.** In interactive mode, when no project-level permission policy exists in `.ratchet/config.yaml`, `init` offers to configure an agent sandbox permission posture. This governs what spawned coding agents may do without approval. The offer is skipped in non-interactive mode and when a project-level policy already exists.

10. **Doctor check.** On a first init (not extend mode), `init` runs a non-blocking dependency check (`ratchet doctor`) and reports any missing external dependencies as warnings. A failing doctor check never aborts initialization.

## Directory layout created

```
<path>/
└── .ratchet/
    ├── config.yaml
    ├── changes/
    │   └── archive/
    ├── features/
    └── standards/
```

Skill files are written outside `.ratchet/`, under each tool's own directory (e.g., `.claude/skills/`, `.cursor/skills/`).

## Supported tool IDs

The following tool IDs are accepted by `--tools`:

| ID | Tool |
|---|---|
| `claude` | Claude Code |
| `codex` | Codex |
| `cursor` | Cursor |
| `gemini` | Gemini |
| `github-copilot` | GitHub Copilot |
| `opencode` | OpenCode |

## Deprecated alias

`ratchet experimental` is a hidden alias for `init`, retained for backwards compatibility. It maps `--tool <id>` to `--tools` and accepts `--no-interactive`. New scripts should use `ratchet init` instead. A deprecation notice is printed at runtime.

## Notes

- Restart the IDE after `init` for slash commands to take effect.
- Re-running `init` on a project that already has `.ratchet/` refreshes skills and commands without removing the existing config.
- Use `ratchet update` to refresh skills for an already-initialized project without re-running tool selection.

## See also

- [`ratchet update`](./update.md)
