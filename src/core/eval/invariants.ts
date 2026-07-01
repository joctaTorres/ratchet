/**
 * Anti-gaming invariant manifest loader.
 *
 * Authored YAML at `.ratchet/evals/invariants.yaml` declares a list of run-level
 * invariants the eval gate's `invariants` contributor enforces. Each invariant
 * is one of four kinds — `deterministic` (an absolute predicate that must hold),
 * `monotonic` (a named measure that must not decrease vs the baseline run),
 * `snapshot` (current output diffed against a checked-in golden), and `mutation`
 * (a seeded-fault survives/killed verdict against the user's own test suite) —
 * and carries an `active` flag so an invariant can be scaffolded inert before it
 * is turned on.
 *
 * Unlike the eval-spec binding loader (`spec.ts`), which collects warnings and
 * degrades an invalid binding to `unjudged`, this loader **fails closed**: an
 * absent manifest is the only path to an empty set. A present-but-malformed or
 * invalid manifest throws `InvariantManifestError`, never a silently empty set —
 * because an empty active set is a vacuous pass, the exact gaming hole the
 * invariant set exists to close.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { RATCHET_DIR_NAME } from '../config.js';

export type InvariantKind = 'deterministic' | 'monotonic' | 'snapshot' | 'mutation';

const DeterministicInvariantSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('deterministic'),
  active: z.boolean(),
  description: z.string().optional(),
  /** Absolute predicate: a command plus the condition under which it passes. */
  check: z.object({
    run: z.string().min(1),
    /** `exit-zero` | `contains:<text>` | `regex:<pattern>` | substring. */
    pass: z.string().default('exit-zero'),
  }),
});

const MonotonicInvariantSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('monotonic'),
  active: z.boolean(),
  description: z.string().optional(),
  /** Named metric whose current value must be ≥ the baseline run's recording. */
  measure: z.string().min(1),
});

const SnapshotInvariantSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('snapshot'),
  active: z.boolean(),
  description: z.string().optional(),
  /** Path to the checked-in golden the current output is diffed against. */
  golden: z.string().min(1),
  /** Command that emits the current value to compare against the golden. */
  produce: z.object({
    run: z.string().min(1),
  }),
});

const MutationInvariantSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('mutation'),
  active: z.boolean(),
  description: z.string().optional(),
  /** The user's own test command — the oracle every seeded mutant is run against. */
  test: z.string().min(1),
  /** Ceiling: at most this many mutants are seeded per run. */
  budget: z.number().int().positive(),
  /** Floor: at least this many mutants must reach a kill/survive verdict to be evaluable. */
  threshold: z.number().int().positive(),
});

export const InvariantSchema = z.discriminatedUnion('kind', [
  DeterministicInvariantSchema,
  MonotonicInvariantSchema,
  SnapshotInvariantSchema,
  MutationInvariantSchema,
]);

export type DeterministicInvariant = z.infer<typeof DeterministicInvariantSchema>;
export type MonotonicInvariant = z.infer<typeof MonotonicInvariantSchema>;
export type SnapshotInvariant = z.infer<typeof SnapshotInvariantSchema>;
export type MutationInvariant = z.infer<typeof MutationInvariantSchema>;
export type Invariant = z.infer<typeof InvariantSchema>;

/** The result of loading `.ratchet/evals/invariants.yaml`. */
export interface InvariantManifest {
  /** Invariants in declared order (violations are surfaced in this order). */
  invariants: Invariant[];
}

/**
 * Raised for any present-but-broken manifest — invalid YAML, a schema
 * violation, or a duplicate id. Surfacing this (rather than returning an empty
 * set) is what makes the loader fail closed.
 */
export class InvariantManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvariantManifestError';
  }
}

/** Resolve `<projectRoot>/<RATCHET_DIR_NAME>/evals/invariants.yaml`. */
export function invariantsManifestPath(projectRoot: string): string {
  return path.join(projectRoot, RATCHET_DIR_NAME, 'evals', 'invariants.yaml');
}

const ManifestSchema = z.object({
  invariants: z.array(z.unknown()).default([]),
});

/**
 * Load and validate the invariant manifest for a project.
 *
 * - **Absent** file ⇒ empty set, no error (the only empty-set path).
 * - **Malformed YAML** ⇒ throws `InvariantManifestError`.
 * - **Invalid invariant** (unknown kind, missing `active`, missing a
 *   kind-required field, duplicate id) ⇒ throws `InvariantManifestError` naming
 *   the offending invariant.
 */
export function loadInvariantManifest(projectRoot: string): InvariantManifest {
  const file = invariantsManifestPath(projectRoot);
  if (!existsSync(file)) {
    return { invariants: [] };
  }

  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(file, 'utf-8'));
  } catch (err) {
    throw new InvariantManifestError(
      `Failed to parse ${path.basename(file)}: ${(err as Error).message}`
    );
  }

  const envelope = ManifestSchema.safeParse(raw ?? {});
  if (!envelope.success) {
    throw new InvariantManifestError(
      `Invalid ${path.basename(file)}: ${envelope.error.issues.map((i) => i.message).join('; ')}`
    );
  }

  const invariants: Invariant[] = [];
  const seen = new Set<string>();
  envelope.data.invariants.forEach((entry, index) => {
    const parsed = InvariantSchema.safeParse(entry);
    if (!parsed.success) {
      const id =
        entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string'
          ? (entry as { id: string }).id
          : `#${index}`;
      throw new InvariantManifestError(
        `Invalid invariant '${id}' in ${path.basename(file)}: ${parsed.error.issues
          .map((i) => i.message)
          .join('; ')}`
      );
    }
    if (seen.has(parsed.data.id)) {
      throw new InvariantManifestError(
        `Duplicate invariant id '${parsed.data.id}' in ${path.basename(file)}.`
      );
    }
    seen.add(parsed.data.id);
    invariants.push(parsed.data);
  });

  return { invariants };
}
