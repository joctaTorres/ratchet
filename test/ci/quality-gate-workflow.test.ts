import { describe, it, expect } from 'vitest';
import {
  loadCiWorkflow,
  findRunStepIndex,
  findUsesStepIndex,
  type WorkflowJob,
} from './helpers/workflow.js';

const workflow = loadCiWorkflow();

/** The single CI job that runs the install -> lint -> test spine. */
function ciJob(): WorkflowJob {
  const job = workflow.jobs[0];
  expect(job, 'workflow defines at least one job').toBeDefined();
  return job;
}

describe('CI quality-gate workflow', () => {
  describe('triggers', () => {
    it('runs on push', () => {
      expect(workflow.triggers).toContain('push');
    });

    it('runs on pull_request', () => {
      expect(workflow.triggers).toContain('pull_request');
    });
  });

  describe('install -> lint -> test ordering', () => {
    it('checks out the repository before running any package steps', () => {
      const { steps } = ciJob();
      const checkout = findUsesStepIndex(steps, 'actions/checkout');
      const install = findRunStepIndex(steps, 'install');
      const lint = findRunStepIndex(steps, 'lint');
      const test = findRunStepIndex(steps, 'test');

      expect(checkout).toBeGreaterThanOrEqual(0);
      expect(install).toBeGreaterThanOrEqual(0);
      expect(checkout).toBeLessThan(install);
      expect(checkout).toBeLessThan(lint);
      expect(checkout).toBeLessThan(test);
    });

    it('installs dependencies', () => {
      expect(findRunStepIndex(ciJob().steps, 'install')).toBeGreaterThanOrEqual(0);
    });

    it('runs the linter after installing dependencies', () => {
      const { steps } = ciJob();
      expect(findRunStepIndex(steps, 'lint')).toBeGreaterThan(findRunStepIndex(steps, 'install'));
    });

    it('runs the test suite after running the linter', () => {
      const { steps } = ciJob();
      expect(findRunStepIndex(steps, 'test')).toBeGreaterThan(findRunStepIndex(steps, 'lint'));
    });

    it('orders install, then lint, then test', () => {
      const { steps } = ciJob();
      const install = findRunStepIndex(steps, 'install');
      const lint = findRunStepIndex(steps, 'lint');
      const test = findRunStepIndex(steps, 'test');
      expect(install).toBeLessThan(lint);
      expect(lint).toBeLessThan(test);
    });
  });

  describe('release path positioning', () => {
    it('places any release-path (publish) step after the install/lint/test spine', () => {
      const { steps } = ciJob();
      const test = findRunStepIndex(steps, 'test');
      const publish = findRunStepIndex(steps, 'publish');

      // This change ships the spine only; no publish step exists yet (-1). When a
      // later change adds one, it must sit AFTER the test step — never before it,
      // so the release path is unreachable while lint or test is red.
      if (publish !== -1) {
        expect(publish).toBeGreaterThan(test);
      }
    });

    it('never adds a real (non-dry-run) publish step', () => {
      const { steps } = ciJob();
      const realPublish = steps.find(
        (s) => /npm\s+publish/i.test(s.run ?? '') && !/--dry-run/i.test(s.run ?? ''),
      );
      expect(realPublish).toBeUndefined();
    });
  });
});
