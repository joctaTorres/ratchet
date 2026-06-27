import { describe, it, expect } from 'vitest';

import {
  CORE_WORKFLOWS,
  ALL_WORKFLOWS,
  getProfileWorkflows,
  normalizeWorkflowId,
  normalizeWorkflowIds,
} from '../../src/core/profiles.js';

describe('profiles', () => {
  describe('CORE_WORKFLOWS', () => {
    it('should contain the default core workflows', () => {
      expect(CORE_WORKFLOWS).toEqual(['propose', 'apply', 'verify', 'archive', 'propose-standard', 'apply-batch', 'archive-batch', 'propose-batch', 'brainstorm']);
    });

    it('should be a subset of ALL_WORKFLOWS', () => {
      for (const workflow of CORE_WORKFLOWS) {
        expect(ALL_WORKFLOWS).toContain(workflow);
      }
    });

    it('should include the batch workflows by default', () => {
      expect(CORE_WORKFLOWS).toContain('apply-batch');
      expect(CORE_WORKFLOWS).toContain('archive-batch');
      expect(CORE_WORKFLOWS).toContain('propose-batch');
    });

    it('should keep eval opt-in (not in core)', () => {
      expect(CORE_WORKFLOWS).not.toContain('eval');
    });
  });

  describe('ALL_WORKFLOWS', () => {
    it('should contain all workflows', () => {
      expect(ALL_WORKFLOWS).toHaveLength(10);
    });

    it('should contain expected workflow IDs', () => {
      const expected = ['propose', 'apply', 'verify', 'archive', 'propose-standard', 'apply-batch', 'archive-batch', 'eval', 'propose-batch', 'brainstorm'];
      expect([...ALL_WORKFLOWS]).toEqual(expected);
    });
  });

  describe('getProfileWorkflows', () => {
    it('should return core workflows for core profile', () => {
      const result = getProfileWorkflows('core');
      expect(result).toEqual(CORE_WORKFLOWS);
    });

    it('should return core workflows for core profile even if customWorkflows provided', () => {
      const result = getProfileWorkflows('core', ['new', 'apply']);
      expect(result).toEqual(CORE_WORKFLOWS);
    });

    it('should return custom workflows for custom profile', () => {
      const customWorkflows = ['explore', 'new', 'apply', 'ff'];
      const result = getProfileWorkflows('custom', customWorkflows);
      expect(result).toEqual(customWorkflows);
    });

    it('should return empty array for custom profile with no customWorkflows', () => {
      const result = getProfileWorkflows('custom');
      expect(result).toEqual([]);
    });

    it('should return empty array for custom profile with empty customWorkflows', () => {
      const result = getProfileWorkflows('custom', []);
      expect(result).toEqual([]);
    });

    it('should migrate a stale "batch" id to "apply-batch" in custom workflows', () => {
      const result = getProfileWorkflows('custom', ['propose', 'apply', 'batch']);
      expect(result).toEqual(['propose', 'apply', 'apply-batch']);
      expect(result).not.toContain('batch');
    });

    it('should not duplicate when both "batch" and "apply-batch" are listed', () => {
      const result = getProfileWorkflows('custom', ['batch', 'apply-batch']);
      expect(result).toEqual(['apply-batch']);
    });
  });

  describe('workflow-id migration alias', () => {
    it('normalizeWorkflowId maps "batch" -> "apply-batch"', () => {
      expect(normalizeWorkflowId('batch')).toBe('apply-batch');
    });

    it('normalizeWorkflowId passes unknown/current ids through unchanged', () => {
      expect(normalizeWorkflowId('apply-batch')).toBe('apply-batch');
      expect(normalizeWorkflowId('propose')).toBe('propose');
      expect(normalizeWorkflowId('eval')).toBe('eval');
    });

    it('normalizeWorkflowIds migrates and de-duplicates while preserving order', () => {
      expect(normalizeWorkflowIds(['propose', 'batch', 'apply-batch', 'eval'])).toEqual([
        'propose',
        'apply-batch',
        'eval',
      ]);
    });
  });
});
