---
title: ratchet new
sidebar_position: 20
---

# `ratchet new`

Scaffold new items. `new` is a command group; invoke it with a subcommand.

## `new change`

Create a new change directory under `.ratchet/changes/`.

### Synopsis

```bash
ratchet new change <name> [options]
```

`<name>` is required. It must be a valid kebab-case identifier.

### Options

| Option | Argument | Description |
|---|---|---|
| `--description` | `<text>` | Description written into a `README.md` inside the new change directory. Omitting this flag creates no `README.md`. |
| `--schema` | `<name>` | Workflow schema to associate with the change. Defaults to the project config value, or `ratchet` when no project config is present. |
| `--json` | | Output the result as JSON instead of human-readable text. |

### Behavior

1. **Name validation.** `<name>` is validated as kebab-case before any
   filesystem operations. An invalid name exits with an error and creates
   nothing.
2. **Schema resolution.** The schema resolves `--schema flag → project config →
   default (ratchet)`. When `--schema` is supplied, the named schema must exist
   (project-local or bundled); an unrecognised schema name exits with an error.
3. **Refuse-if-exists.** If `.ratchet/changes/<name>/` already exists the
   command exits with an error. No files are modified.
4. **Files created.**
   - `.ratchet/changes/<name>/` — the change directory.
   - `.ratchet/changes/<name>/.ratchet.yaml` — change metadata containing the
     resolved schema name and the creation date (`YYYY-MM-DD`).
   - `.ratchet/changes/<name>/README.md` — created only when `--description` is
     given. Content: `# <name>\n\n<description>\n`.
5. **Output.** Without `--json`, prints the change location and schema to
   stdout. With `--json`, prints a structured object:

   ```json
   {
     "change": {
       "id": "<name>",
       "path": "<absolute path to change dir>",
       "metadataPath": "<absolute path to .ratchet.yaml>",
       "schema": "<resolved schema>"
     }
   }
   ```

   On error with `--json`, prints `{ "change": null, "status": [{ "code":
   "error", "message": "..." }] }` and exits with code 1.

---

## `new batch`

Scaffold a new batch manifest at `.ratchet/batches/<name>/batch.yaml`.

`ratchet new batch <name>` and `ratchet batch new <name>` invoke the same
underlying command (`newBatchCommand`) and are equivalent.

### Synopsis

```bash
ratchet new batch <name> [options]
# equivalent:
ratchet batch new <name> [options]
```

`<name>` is required. It must be a valid kebab-case identifier.

### Options

| Option | Argument | Description |
|---|---|---|
| `--json` | | Output the result as JSON instead of human-readable text. |

### Behavior

1. **Name validation.** `<name>` is validated as kebab-case before any
   filesystem operations. An invalid name exits with an error.
2. **Refuse-if-exists.** If `.ratchet/batches/<name>/batch.yaml` already exists
   the command exits with an error. No files are modified.
3. **Template rendering.** The canonical `batch.yaml` template is loaded from
   the `ratchet` schema templates directory (project-local override wins when
   present). The template's `name:` field is replaced with `<name>` and the
   `created:` field is set to the current date (`YYYY-MM-DD`).
4. **Files created.**
   - `.ratchet/batches/<name>/` — the batch directory.
   - `.ratchet/batches/<name>/batch.yaml` — the rendered manifest.
5. **Output.** Without `--json`, prints the relative path to the created
   manifest. With `--json`, prints:

   ```json
   {
     "batch": {
       "name": "<name>",
       "path": "<absolute path to batch.yaml>"
     }
   }
   ```

## See also

- [`ratchet template`](./template.md) — print a raw schema template to stdout.
- [`ratchet batch`](./batch.md) — manage the full batch lifecycle.
