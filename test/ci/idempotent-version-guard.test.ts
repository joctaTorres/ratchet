import { describe, it, expect } from 'vitest';
import {
  loadCiWorkflow,
  findRunStepIndex,
  type WorkflowJob,
} from './helpers/workflow.js';

/**
 * This slice adds the idempotency guard to the already-gated `publish` job: a
 * version-guard step decides PUBLISH (new version) vs SKIP (already on the
 * registry) and exposes a `should_publish` step output, and the dry-run publish
 * step is conditioned on that output being the literal `true`. An
 * already-published version skips the publish step while the job — and the whole
 * pipeline — stays green.
 *
 * A unit test can't run GitHub Actions, so the wiring is proven structurally
 * against the parsed-workflow model — matching on substrings so it stays robust
 * to cosmetic renames — mirroring `gated-publish-job.test.ts`. The publish stays
 * `npm publish --dry-run`; no token/secret or provenance permission is added in
 * this slice.
 */

const workflow = loadCiWorkflow();

/** Look a job up by id, asserting it exists. */
function job(id: string): WorkflowJob {
  const found = workflow.jobs.find((j) => j.id === id);
  expect(found, `workflow defines a "${id}" job`).toBeDefined();
  return found as WorkflowJob;
}

describe('idempotent version guard', () => {
  describe('the publish job has a version-guard step exposing should_publish', () => {
    it('runs the version-guard runner', () => {
      const { steps } = job('publish');
      const guard = steps[findRunStepIndex(steps, 'version-guard.js')];
      expect(guard, 'publish job has a version-guard step').toBeDefined();
    });

    it('gives the guard step an id (so its output can be referenced)', () => {
      const { steps } = job('publish');
      const guard = steps[findRunStepIndex(steps, 'version-guard.js')];
      expect(guard.id).toBeDefined();
    });
  });

  describe('the dry-run publish step is gated on should_publish', () => {
    it("is conditioned on the guard's should_publish output == 'true'", () => {
      const { steps } = job('publish');
      const guard = steps[findRunStepIndex(steps, 'version-guard.js')];
      const publishStep = steps[findRunStepIndex(steps, 'npm publish --dry-run')];
      expect(publishStep, 'publish job has a dry-run publish step').toBeDefined();

      const cond = (publishStep.if ?? '').replace(/\s+/g, ' ').trim();
      expect(cond).toContain(`steps.${guard.id}.outputs.should_publish`);
      expect(cond).toMatch(/==\s*'true'/);
    });

    it('runs the guard before the publish step', () => {
      const { steps } = job('publish');
      const guard = findRunStepIndex(steps, 'version-guard.js');
      const publishStep = findRunStepIndex(steps, 'npm publish --dry-run');
      expect(guard).toBeGreaterThanOrEqual(0);
      expect(guard).toBeLessThan(publishStep);
    });
  });

  describe('the publish stays a dry-run (no real release in this slice)', () => {
    it('runs "npm publish --dry-run"', () => {
      const { steps } = job('publish');
      const publishStep = steps[findRunStepIndex(steps, 'npm publish --dry-run')];
      expect(publishStep.run).toMatch(/npm\s+publish\s+--dry-run/);
    });

    it('runs no bare "npm publish" without --dry-run (no real release)', () => {
      const { steps } = job('publish');
      const realPublish = steps.find(
        (s) => /npm\s+publish/i.test(s.run ?? '') && !/--dry-run/i.test(s.run ?? ''),
      );
      expect(realPublish).toBeUndefined();
    });
  });
});
