/**
 * Batch Manifest
 *
 * A batch manifest (`.ratchet/batches/<name>/batch.yaml`) is declarative intent:
 * ordered phases, each with a goal, success criteria, and an executable
 * proof-of-work, and a DAG of change intents (name + optional `after` edges).
 *
 * The manifest NEVER stores progress — batch status is derived live from change
 * state on disk (see `status.ts`). A change intent with no change directory yet
 * is `pending`, not an error: this is what lets changes be created lazily as the
 * batch progresses.
 */

import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { RATCHET_DIR_NAME } from '../config.js';
import { PermissionsPolicySchema } from './permissions-policy.js';

// -----------------------------------------------------------------------------
// Zod schema
// -----------------------------------------------------------------------------

/** Proof-of-work kinds are constrained to executable checks an agent can run. */
export const PROOF_OF_WORK_KINDS = ['integration', 'blackbox', 'llm-judge'] as const;
export type ProofOfWorkKind = (typeof PROOF_OF_WORK_KINDS)[number];

export const ProofOfWorkSchema = z.object({
  kind: z.enum(PROOF_OF_WORK_KINDS, {
    error: `proof-of-work kind must be one of: ${PROOF_OF_WORK_KINDS.join(', ')}`,
  }),
  run: z.string().min(1, { error: 'proof-of-work run command is required' }),
  pass: z.string().min(1, { error: 'proof-of-work pass condition is required' }),
});

export const ChangeIntentSchema = z.object({
  name: z.string().min(1, { error: 'change intent name is required' }),
  after: z.array(z.string()).default([]),
  /**
   * Required, short definition of done for THIS change — what "done" means for
   * it, distinct from the phase-level `success`. Must be non-empty: every change
   * intent must state its own bar.
   */
  done: z.string().min(1, { error: 'change intent done criterion is required' }),
});

export const PhaseSchema = z.object({
  name: z.string().min(1, { error: 'phase name is required' }),
  goal: z.string().min(1, { error: 'phase goal is required' }),
  success: z.string().min(1, { error: 'phase success criteria are required' }),
  proofOfWork: ProofOfWorkSchema,
  changes: z.array(ChangeIntentSchema).default([]),
});

/** Optional per-manifest setting overrides (project config provides defaults). */
export const BatchSettingsOverrideSchema = z
  .object({
    gate: z.enum(['voluntary', 'after-propose', 'every-phase', 'autonomous']).optional(),
    strategy: z.enum(['vertical-slice', 'feature']).optional(),
    proofOfWork: z.enum(['hard-gate', 'warn']).optional(),
    locus: z.enum(['local', 'docker', 'remote']).optional(),
    agent: z.string().optional(),
    image: z.string().optional(),
    host: z.string().optional(),
    port: z.number().optional(),
    authToken: z.string().optional(),
    // Per-change agent permission override. `permissions` is a known key, so the
    // schema stays `.strict()` (it rejects unknown keys, not this one).
    permissions: PermissionsPolicySchema.optional(),
    insecure: z.boolean().optional(),
  })
  .strict();

export const BatchManifestSchema = z.object({
  name: z.string().min(1, { error: 'batch name is required' }),
  created: z.string().optional(),
  settings: BatchSettingsOverrideSchema.optional(),
  phases: z.array(PhaseSchema).default([]),
});

export type ProofOfWork = z.infer<typeof ProofOfWorkSchema>;
export type ChangeIntent = z.infer<typeof ChangeIntentSchema>;
export type Phase = z.infer<typeof PhaseSchema>;
export type BatchSettingsOverride = z.infer<typeof BatchSettingsOverrideSchema>;
export type BatchManifest = z.infer<typeof BatchManifestSchema>;

// -----------------------------------------------------------------------------
// Paths
// -----------------------------------------------------------------------------

export function getBatchesDir(projectRoot: string): string {
  return path.join(projectRoot, RATCHET_DIR_NAME, 'batches');
}

export function getBatchDir(projectRoot: string, name: string): string {
  return path.join(getBatchesDir(projectRoot), name);
}

export function getBatchManifestPath(projectRoot: string, name: string): string {
  return path.join(getBatchDir(projectRoot, name), 'batch.yaml');
}

export function batchExists(projectRoot: string, name: string): boolean {
  return existsSync(getBatchManifestPath(projectRoot, name));
}

// -----------------------------------------------------------------------------
// Parse / validate
// -----------------------------------------------------------------------------

export class BatchManifestError extends Error {
  constructor(
    message: string,
    /** Source location, e.g. file path or `phases[0].changes[1]`. */
    public readonly location?: string
  ) {
    super(message);
    this.name = 'BatchManifestError';
  }
}

/**
 * Turn a ZodError into clear, located messages for each malformed entry, so the
 * caller can report the offending entry without losing valid ones.
 */
export function formatManifestIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const location = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `${location}: ${issue.message}`;
  });
}

/** Parse and validate manifest content (already loaded from disk). */
export function parseBatchManifest(content: string): BatchManifest {
  let raw: unknown;
  try {
    raw = parseYaml(content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new BatchManifestError(`Failed to parse batch manifest YAML: ${message}`);
  }

  if (!raw || typeof raw !== 'object') {
    throw new BatchManifestError('Batch manifest must be a YAML object');
  }

  const result = BatchManifestSchema.safeParse(raw);
  if (!result.success) {
    const issues = formatManifestIssues(result.error);
    throw new BatchManifestError(
      `Invalid batch manifest:\n  ${issues.join('\n  ')}`,
      issues[0]
    );
  }

  return result.data;
}

/** Load and validate the manifest for a batch by name. */
export function loadBatchManifest(projectRoot: string, name: string): BatchManifest {
  const manifestPath = getBatchManifestPath(projectRoot, name);
  if (!existsSync(manifestPath)) {
    throw new BatchManifestError(
      `Batch '${name}' not found at ${manifestPath}`,
      manifestPath
    );
  }

  const content = readFileSync(manifestPath, 'utf-8');
  const manifest = parseBatchManifest(content);
  // The on-disk name is authoritative even if the manifest omits/differs.
  return { ...manifest, name: manifest.name || name };
}

/** Collect every change intent across all phases. */
export function allChangeIntents(manifest: BatchManifest): ChangeIntent[] {
  return manifest.phases.flatMap((phase) => phase.changes);
}
