/**
 * Unit tests for the pure policy functions in src/core/change-status-policy.ts.
 *
 * Implements features/core-util-tests/change-status-policy.feature:
 * planning-home summaries, the repo-local action context, and next-step
 * guidance. These are deterministic over in-memory inputs — the tests touch no
 * filesystem and spawn no process.
 */
import { describe, it, expect } from 'vitest';
import {
  summarizePlanningHome,
  summarizeAffectedAreas,
  buildActionContext,
  buildNextSteps,
} from '../../src/core/change-status-policy.js';
import type { PlanningHome } from '../../src/core/planning-home.js';

const planningHome: PlanningHome = {
  kind: 'repo',
  root: '/repo',
  changesDir: '/repo/.ratchet/changes',
  batchesDir: '/repo/.ratchet/batches',
  defaultSchema: 'ratchet',
};

describe('change-status-policy', () => {
  describe('summarizePlanningHome', () => {
    it('projects exactly the public summary fields', () => {
      expect(summarizePlanningHome(planningHome)).toEqual({
        kind: 'repo',
        root: '/repo',
        changesDir: '/repo/.ratchet/changes',
        defaultSchema: 'ratchet',
      });
    });

    it('passes undefined through', () => {
      expect(summarizePlanningHome(undefined)).toBeUndefined();
    });
  });

  describe('summarizeAffectedAreas', () => {
    it('is always undefined for repo-local planning', () => {
      expect(summarizeAffectedAreas({})).toBeUndefined();
      expect(summarizeAffectedAreas({ planningHome })).toBeUndefined();
    });
  });

  describe('buildActionContext', () => {
    it('produces the repo-local context with artifact ids and the project root as sole edit root', () => {
      const context = buildActionContext({
        projectRoot: '/repo',
        artifactIds: ['features', 'plan'],
      });

      expect(context.mode).toBe('repo-local');
      expect(context.sourceOfTruth).toBe('repo');
      expect(context.planningArtifacts).toEqual(['features', 'plan']);
      expect(context.linkedContext).toEqual([]);
      expect(context.allowedEditRoots).toEqual(['/repo']);
      expect(context.requiresAffectedAreaSelection).toBe(false);
      expect(context.constraints).toHaveLength(1);
      expect(context.constraints[0]).toMatch(/repo-local/i);
    });
  });

  describe('buildNextSteps', () => {
    it('points at the first ready artifact', () => {
      const steps = buildNextSteps({
        changeName: 'my-change',
        artifactStatuses: [
          { id: 'features', status: 'done' },
          { id: 'plan', status: 'ready' },
        ],
        allArtifactsComplete: false,
      });

      expect(steps).toHaveLength(1);
      expect(steps[0]).toContain('ratchet instructions plan');
      expect(steps[0]).toContain('my-change');
    });

    it('reports completion when all artifacts are complete', () => {
      const steps = buildNextSteps({
        changeName: 'my-change',
        artifactStatuses: [{ id: 'plan', status: 'done' }],
        allArtifactsComplete: true,
      });

      expect(steps).toEqual([
        'All planning artifacts are complete; review tasks before implementation.',
      ]);
    });

    it('returns no steps when nothing is ready and work remains', () => {
      const steps = buildNextSteps({
        changeName: 'my-change',
        artifactStatuses: [{ id: 'plan', status: 'blocked' }],
        allArtifactsComplete: false,
      });

      expect(steps).toEqual([]);
    });
  });
});
