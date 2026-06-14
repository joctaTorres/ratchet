/**
 * Batch Settings
 *
 * Effective batch settings are resolved as: hard-coded defaults ← project
 * config (`.ratchet/config.yaml` `batch:` section) ← per-manifest overrides.
 *
 * `ratchet batch config` reads the resolved settings and can get/set the
 * project-level `batch:` section, validating enum values and leaving the file
 * unchanged on invalid input.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { RATCHET_DIR_NAME } from '../config.js';
import { readProjectConfig } from '../project-config.js';
import type { BatchManifest } from './manifest.js';

export const GATE_VALUES = ['voluntary', 'after-propose', 'every-phase', 'autonomous'] as const;
export const STRATEGY_VALUES = ['vertical-slice', 'feature'] as const;
export const PROOF_OF_WORK_POLICY_VALUES = ['hard-gate', 'warn'] as const;
/**
 * Execution locus: where a step's agent runs. `local` drives the in-process ReX
 * sidecar (the default); `docker` runs the same step inside a container via ReX
 * `DockerDeployment` with the project root bind-mounted in. `remote` is a later
 * phase; the enum is the clean extension point — add a value here and a runtime
 * selector branch in the engine.
 */
export const LOCUS_VALUES = ['local', 'docker'] as const;

/**
 * The default container image for `locus: docker` when no `image` is configured.
 * A small, generic image that proves the plumbing; a REAL agent image (node +
 * the chosen coding agent + `ratchet` on PATH) is a documented follow-on.
 */
export const DEFAULT_DOCKER_IMAGE = 'python:3.12';

export type Gate = (typeof GATE_VALUES)[number];
export type Strategy = (typeof STRATEGY_VALUES)[number];
export type ProofOfWorkPolicy = (typeof PROOF_OF_WORK_POLICY_VALUES)[number];
export type Locus = (typeof LOCUS_VALUES)[number];

export interface BatchSettings {
  gate: Gate;
  strategy: Strategy;
  proofOfWork: ProofOfWorkPolicy;
  /** Where the agent runs. Defaults to `local` (the ReX sidecar). */
  locus: Locus;
  agent?: string;
  /**
   * Container image for `locus: docker` (free-form, like `agent`). Ignored for
   * `local`. When unset and locus is `docker`, the runtime uses
   * `DEFAULT_DOCKER_IMAGE`.
   */
  image?: string;
}

/** Where each effective value came from. */
export type SettingSource = 'default' | 'project' | 'manifest';

export interface ResolvedBatchSettings {
  settings: BatchSettings;
  sources: Record<keyof BatchSettings, SettingSource>;
}

export const DEFAULT_BATCH_SETTINGS: BatchSettings = {
  gate: 'voluntary',
  strategy: 'vertical-slice',
  proofOfWork: 'hard-gate',
  locus: 'local',
};

const SETTING_KEYS: (keyof BatchSettings)[] = [
  'gate',
  'strategy',
  'proofOfWork',
  'locus',
  'agent',
  'image',
];

const ALLOWED_VALUES: Record<string, readonly string[] | null> = {
  gate: GATE_VALUES,
  strategy: STRATEGY_VALUES,
  proofOfWork: PROOF_OF_WORK_POLICY_VALUES,
  locus: LOCUS_VALUES,
  agent: null, // free-form string
  image: null, // free-form string (container image reference)
};

/**
 * Resolve effective batch settings: defaults ← project config ← manifest.
 */
export function resolveBatchSettings(
  projectRoot: string,
  manifest?: BatchManifest | null
): ResolvedBatchSettings {
  const settings: BatchSettings = { ...DEFAULT_BATCH_SETTINGS };
  const sources: Record<keyof BatchSettings, SettingSource> = {
    gate: 'default',
    strategy: 'default',
    proofOfWork: 'default',
    locus: 'default',
    agent: 'default',
    image: 'default',
  };

  const writable = settings as { [K in keyof BatchSettings]: BatchSettings[K] };

  const projectBatch = readProjectConfig(projectRoot)?.batch;
  if (projectBatch) {
    for (const key of SETTING_KEYS) {
      const value = projectBatch[key];
      if (value !== undefined) {
        (writable[key] as BatchSettings[typeof key]) = value as BatchSettings[typeof key];
        sources[key] = 'project';
      }
    }
  }

  const manifestOverrides = manifest?.settings;
  if (manifestOverrides) {
    for (const key of SETTING_KEYS) {
      const value = manifestOverrides[key];
      if (value !== undefined) {
        (writable[key] as BatchSettings[typeof key]) = value as BatchSettings[typeof key];
        sources[key] = 'manifest';
      }
    }
  }

  return { settings, sources };
}

export interface SetResult {
  ok: boolean;
  /** Error message when ok is false; the file is left unchanged. */
  error?: string;
  key?: keyof BatchSettings;
  value?: string;
}

/** Validate a `key=value` setting against the allowed enum values. */
export function validateSetting(key: string, value: string): SetResult {
  if (!SETTING_KEYS.includes(key as keyof BatchSettings)) {
    return {
      ok: false,
      error: `Unknown batch setting '${key}'. Allowed keys: ${SETTING_KEYS.join(', ')}`,
    };
  }

  const allowed = ALLOWED_VALUES[key];
  if (allowed && !allowed.includes(value)) {
    return {
      ok: false,
      error: `Invalid value '${value}' for '${key}'. Allowed values: ${allowed.join(', ')}`,
    };
  }

  // A free-form `image` must be a non-empty reference — an empty value is
  // rejected before any container is started so the project config is left
  // unchanged (see features/container-locus/configurable-image.feature).
  if (key === 'image' && value.trim().length === 0) {
    return {
      ok: false,
      error: `Invalid value for 'image': the container image reference must not be empty.`,
    };
  }

  return { ok: true, key: key as keyof BatchSettings, value };
}

function configFilePath(projectRoot: string): string {
  const yamlPath = path.join(projectRoot, RATCHET_DIR_NAME, 'config.yaml');
  if (existsSync(yamlPath)) return yamlPath;
  const ymlPath = path.join(projectRoot, RATCHET_DIR_NAME, 'config.yml');
  if (existsSync(ymlPath)) return ymlPath;
  return yamlPath; // default to .yaml when creating
}

/**
 * Set a project-level batch setting in `.ratchet/config.yaml`. Validates the
 * enum value first and leaves the file untouched on invalid input.
 */
export function setProjectBatchSetting(
  projectRoot: string,
  key: string,
  value: string
): SetResult {
  const validation = validateSetting(key, value);
  if (!validation.ok) {
    return validation;
  }

  const filePath = configFilePath(projectRoot);
  let raw: Record<string, unknown> = {};
  if (existsSync(filePath)) {
    try {
      const parsed = parseYaml(readFileSync(filePath, 'utf-8'));
      if (parsed && typeof parsed === 'object') {
        raw = parsed as Record<string, unknown>;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Failed to read config.yaml: ${message}` };
    }
  }

  const batch = (raw.batch && typeof raw.batch === 'object' ? raw.batch : {}) as Record<
    string,
    unknown
  >;
  batch[key] = value;
  raw.batch = batch;

  writeFileSync(filePath, stringifyYaml(raw), 'utf-8');
  return validation;
}
