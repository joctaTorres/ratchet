---
title: ratchet validate
sidebar_position: 16
---

# `ratchet validate`

Validate changes, specs, and batch manifests against their structural and content rules. The command resolves the target item, runs the appropriate validator, and reports issues by level (`ERROR`, `WARNING`, `INFO`).

## Synopsis

```bash
ratchet validate [item-name] [options]
ratchet validate --all [options]
ratchet validate --changes [options]
ratchet validate --specs [options]
```

`[item-name]` is the name of a single change, spec, or batch to validate. Omitting it with no bulk flag opens an interactive selector in a TTY; in a non-interactive context the command exits with an error and usage hint.

## Options

| Option | Argument | Description |
|---|---|---|
| `--all` | | Validate all changes and all specs. |
| `--changes` | | Validate all changes. |
| `--specs` | | Validate all specs. |
| `--type` | `change\|spec` | Override the inferred item type when the name is ambiguous (matches both a change and a spec). |
| `--strict` | | Treat `WARNING`-level issues as failures. In normal mode only `ERROR` issues make an item invalid. |
| `--json` | | Output results as a JSON object (see [JSON output](#json-output)). |
| `--concurrency` | `<n>` | Maximum number of items validated in parallel during bulk runs. Defaults to `RATCHET_CONCURRENCY` env var or `6`. |
| `--no-interactive` | | Disable interactive prompts; fail with a hint when no item is specified. |

## Behavior

### Item resolution

When `[item-name]` is given without a bulk flag, the command resolves the target in this order:

1. Checked as an active change (`.ratchet/changes/<name>/`).
2. Checked as a spec (`.ratchet/features/<name>/`).
3. Checked as a batch manifest (`.ratchet/batches/<name>/`), only when it matches neither a change nor a spec and `--type` is not set.
4. If the name matches both a change and a spec and `--type` is not given, the command exits with an ambiguity error and a hint to pass `--type change|spec`.
5. If the name is not found, the command exits with an error and nearest-match suggestions.

### Change validation

A change is valid when all three sub-validators pass:

**Feature files** (`.ratchet/changes/<name>/features/**/*.feature`):
- At least one `.feature` file must exist — `ERROR` if none found.
- Each file must parse as valid Gherkin with a `Feature:` header and at least one `Scenario`.
- Each scenario must contain at least one `Given`, one `When`, and one `Then` step (`And`/`But` alone do not satisfy) — `ERROR` if missing.
- Duplicate scenario names within a file — `WARNING`.
- `Scenario Outline` with no `<placeholder>` parameters — `INFO`.

**Plan** (`.ratchet/changes/<name>/plan.md`):
- `## Why` section present, at least 50 characters, no more than 1 000 characters. Missing section is `ERROR`; length violations are `WARNING`.
- `## What Changes` section present and non-empty — `ERROR` if absent or blank.
- `## Design` section present — `ERROR` if absent.
- `## Tasks` section present with at least one `- [ ]` checkbox — `ERROR` if absent or no checkbox.

**Standards** (`.ratchet/changes/<name>/.ratchet.yaml`):
- Every tag listed under `standards` in the change's `.ratchet.yaml` must resolve to a standard in `.ratchet/standards/` — `ERROR` for each unresolved tag.
- Duplicate `tag` values across `.ratchet/standards/` files — `ERROR` per offending tag.

### Spec validation

A spec (`.ratchet/features/<name>/`) is validated against the same Gherkin rules as the feature-file sub-validator above: at least one `.feature` file, valid `Feature:` header, at least one scenario per file, and each scenario must have `Given`/`When`/`Then` steps.

### Batch validation

A batch manifest (`.ratchet/batches/<name>/`) is checked for:
- Valid YAML structure and required fields — `ERROR` on parse or schema failure.
- Per-phase DAG integrity: no cycles, no unknown `dependsOn` references — `ERROR` per offending phase.

### Strict mode

With `--strict`, any `WARNING`-level issue makes the item invalid (non-zero exit). Without `--strict`, only `ERROR`-level issues fail validation.

### Bulk validation

`--all`, `--changes`, and `--specs` discover all items and validate them in a bounded concurrency pool (default 6, overridable via `--concurrency` or `RATCHET_CONCURRENCY`). Results are sorted alphabetically by item id. A spinner is shown unless `--json` or `--no-interactive` is set.

Text output per item: `✓ change/<id>` or `✗ change/<id>`, followed by a totals line.

Exit code is `1` if any item fails; `0` if all pass.

### Interactive mode

When no item name and no bulk flag is given in a TTY, the command presents a menu:

- All (changes + specs)
- All changes
- All specs
- Pick a specific change or spec

Pass `--no-interactive` to suppress the menu and fail with a usage hint instead.

## JSON output

With `--json`, a single JSON object is written to stdout:

```json
{
  "items": [
    {
      "id": "<item-id>",
      "type": "change" | "spec" | "batch",
      "valid": true | false,
      "issues": [
        {
          "level": "ERROR" | "WARNING" | "INFO",
          "path": "<location>",
          "message": "<description>"
        }
      ],
      "durationMs": 42
    }
  ],
  "summary": {
    "totals": { "items": 1, "passed": 1, "failed": 0 },
    "byType": {
      "change": { "items": 1, "passed": 1, "failed": 0 }
    }
  },
  "version": "1.0"
}
```

`byType` is present for bulk runs and keyed by the types included in the scope. Batch-single output omits `byType` and `durationMs`. `version` is always `"1.0"`.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | All validated items are valid. |
| `1` | One or more items are invalid, or no item was resolvable. |
