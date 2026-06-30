/**
 * Shared tmpdir fixture for the `test/commands/batch/` verb tests.
 *
 * Each scenario builds an isolated repo under `fs.mkdtemp(os.tmpdir())`, writes
 * only the minimal `.ratchet/batches/<name>/batch.yaml` manifest and the
 * `.ratchet/changes/<change>/` trees it exercises, and tears it down in
 * `afterEach` (see the `testing` standard: fixture isolation, no real-repo
 * dependence, order independence, leave nothing behind). The batch verbs resolve
 * their project root through `resolveCurrentPlanningHomeSync`, which each test
 * mocks to return `fixture.root`.
 *
 * This extends the change-tree builders in `../change-fixture.ts` (so done/ready
 * change state is shared) and adds the batch manifest writer plus the
 * journal/parked-state seams a scenario needs.
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { stringify as stringifyYaml } from 'yaml';
import { CommandFixture } from '../change-fixture.js';
import {
  parkStep,
  appendJournal,
  recordProofOfWork,
  type ParkedStep,
  type JournalEntry,
  type ProofOfWorkRecord,
} from '../../../src/core/batch/journal.js';

/** The default executable proof-of-work stamped on a fixture phase. */
const DEFAULT_PROOF = { kind: 'integration', run: 'pnpm test', pass: 'exit code 0' };

export interface FixtureChange {
  name: string;
  after?: string[];
  done?: string;
}

export interface FixturePhase {
  name?: string;
  goal?: string;
  success?: string;
  proofOfWork?: { kind: string; run: string; pass: string };
  changes?: FixtureChange[];
}

export interface BatchManifestSpec {
  /** Manifest `name:` line — defaults to the on-disk batch name. */
  name?: string;
  created?: string;
  /** Per-manifest setting overrides (e.g. `{ gate: 'autonomous' }`). */
  settings?: Record<string, unknown>;
  phases?: FixturePhase[];
}

export class BatchFixture extends CommandFixture {
  batchDir(batch: string): string {
    return path.join(this.root, '.ratchet', 'batches', batch);
  }

  manifestPath(batch: string): string {
    return path.join(this.batchDir(batch), 'batch.yaml');
  }

  /** Write a raw manifest string verbatim (for malformed/sentinel inputs). */
  async writeManifestRaw(batch: string, yaml: string): Promise<void> {
    await fs.mkdir(this.batchDir(batch), { recursive: true });
    await fs.writeFile(this.manifestPath(batch), yaml, 'utf-8');
  }

  /** Build and write a structurally valid manifest from a spec. */
  async writeBatch(batch: string, spec: BatchManifestSpec = {}): Promise<void> {
    const manifest: Record<string, unknown> = {
      name: spec.name ?? batch,
      created: spec.created ?? '2026-01-01',
      ...(spec.settings ? { settings: spec.settings } : {}),
      phases: (spec.phases ?? []).map((phase, i) => ({
        name: phase.name ?? `phase-${i + 1}`,
        goal: phase.goal ?? 'Ship a slice.',
        success: phase.success ?? 'The slice works end to end.',
        proofOfWork: phase.proofOfWork ?? { ...DEFAULT_PROOF },
        changes: (phase.changes ?? []).map((c) => ({
          name: c.name,
          after: c.after ?? [],
          done: c.done ?? 'the change is complete',
        })),
      })),
    };
    await this.writeManifestRaw(batch, stringifyYaml(manifest));
  }

  /** Write a project config (`.ratchet/config.yaml`) verbatim. */
  async writeProjectConfig(yaml: string): Promise<void> {
    await fs.writeFile(path.join(this.root, '.ratchet', 'config.yaml'), yaml, 'utf-8');
  }

  configPath(): string {
    return path.join(this.root, '.ratchet', 'config.yaml');
  }

  /** Park a change step (blocked / awaiting-approval) in the run state. */
  park(batch: string, step: Omit<ParkedStep, 'parkedAt'> & { parkedAt?: string }): ParkedStep {
    return parkStep(this.root, batch, step);
  }

  /** Append a journal entry for a change. */
  journal(batch: string, entry: Omit<JournalEntry, 'at'> & { at?: string }): JournalEntry {
    return appendJournal(this.root, batch, entry);
  }

  /**
   * Journal a verify completion for a change so it satisfies the single
   * journal-aware done-rule. Under the current (post-#37) behavior a change is
   * `done` only when its tasks are all checked AND a verify completion is
   * journaled; tasks-checked alone is `awaiting-verify`, not done.
   */
  completeVerify(batch: string, change: string): JournalEntry {
    return appendJournal(this.root, batch, {
      change,
      kind: 'completion',
      message: 'verified',
      transition: 'verify',
    });
  }

  /**
   * Record a passing boundary proof-of-work for a phase. The terminal phase's
   * proof-of-work must be recorded as satisfied before a batch whose changes are
   * all done reports `done` (the terminal-phase proof gate, C2).
   */
  passProof(batch: string, phase: string, over: Partial<ProofOfWorkRecord> = {}): void {
    recordProofOfWork(this.root, batch, phase, {
      phase,
      passed: true,
      gatePassed: true,
      policy: 'hard-gate',
      reason: 'pass-condition-met',
      detail: 'Proof-of-work passed (exit 0).',
      ...over,
    });
  }
}

/** Build an isolated fixture repo with empty `.ratchet/{changes,batches}/` trees. */
export async function makeBatchFixture(prefix = 'ratchet-batch-cmd-'): Promise<BatchFixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await fs.mkdir(path.join(root, '.ratchet', 'changes'), { recursive: true });
  await fs.mkdir(path.join(root, '.ratchet', 'batches'), { recursive: true });
  return new BatchFixture(root);
}
