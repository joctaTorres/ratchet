---
title: Standalone settings resolution
sidebar_position: 2
---

# Standalone settings: `resolveChangeStepSettings`

Resolve effective settings for a **standalone change step** — one driven with no
batch manifest, as the headless `propose`/`apply`/`verify` verbs do. Exported
from `src/core/batch/config.ts`.

## Signature

```ts
interface ChangeStepSettingOverrides {
  agent?: string;
  locus?: string;
  image?: string;
}

function resolveChangeStepSettings(
  projectRoot: string,
  overrides?: ChangeStepSettingOverrides
): BatchSettings;
```

## Resolution

Settings cascade `flag → project config → built-in default`:

1. Start from `resolveBatchSettings(projectRoot)` — project config
   (`.ratchet/config.yaml` `batch:` section) over the built-in defaults, with
   **no manifest**.
2. Apply each provided override in turn: `agent`, then `locus`, then `image`. An
   undefined override is skipped (config/default wins).

Each applied override is validated through `validateSetting`. An invalid value
throws an actionable error (naming the allowed values for an enum key such as
`locus`) **before any agent is spawned**. The returned `BatchSettings` feeds
`runChangeStep` directly, and `selectRuntime` keys off `locus`/`image` exactly as
for a batch step.

## Overridable keys

| Key | Values | Notes |
|---|---|---|
| `agent` | free-form string | Coding agent override for the step. |
| `locus` | `local`, `docker`, `remote` | Where the agent runs. Defaults to `local`. |
| `image` | non-empty string | Container image for `locus: docker`; an empty value is rejected. |

Non-overridable settings (`gate`, `strategy`, `proofOfWork`, `permissions`, and
the `remote`-locus keys `host`/`port`/`authToken`/`insecure`) come from the
project config / defaults via `resolveBatchSettings`.
