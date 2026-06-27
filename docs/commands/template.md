---
title: ratchet template
sidebar_position: 19
---

# `ratchet template`

Print the content of a named template from the canonical templates directory for a
given schema. The output is written to stdout. This is the same template loading
path used internally by the `instructions` command, so the output exactly matches
what the engine consults at runtime.

## Synopsis

```bash
ratchet template <name> [options]
```

`<name>` is required. It names the template to print (e.g. `standard`).

## Options

| Option | Argument | Description |
|---|---|---|
| `--schema` | `<name>` | Schema whose templates directory is searched. Defaults to `ratchet`. |

## Behavior

1. **Project root detection.** The command resolves the nearest project root
   (the directory that contains `.ratchet/`). If no project root is found the
   bundled schema templates are used.
2. **Schema resolution.** The schema defaults to `ratchet` when `--schema` is
   omitted. A project-local schema directory takes precedence over the bundled
   copy when both exist.
3. **Extension probing.** When `<name>` contains no file extension the command
   tries the following extensions in order and returns the first match:
   `.md`, `.feature`, `.yaml`, `.yml`. When `<name>` already contains an
   extension it is used as-is. If no candidate resolves, the command exits with
   an error.
4. **Output.** The template content is written to stdout. A trailing newline is
   appended if the file does not already end with one.
