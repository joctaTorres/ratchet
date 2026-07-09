// Feature: approval-gate-matrix/per-gate-parking.feature
// Pure unit tests for the gate×transition parksForApproval matrix (no fs/spawn).

import { describe, it, expect } from 'vitest';
import { parksForApproval } from '../../src/core/batch/engine/approval-gate.js';
import type { StepKind } from '../../src/core/batch/engine/contract.js';

const CHANGE_TRANSITIONS: StepKind[] = ['propose', 'apply', 'verify'];
const NON_CHANGE_TRANSITIONS: StepKind[] = ['decompose', 'pr'];
const GATES = ['voluntary', 'after-propose', 'every-phase', 'autonomous'] as const;

describe('parksForApproval gate×transition matrix', () => {
  describe('voluntary gate never parks a completed transition', () => {
    for (const t of [...CHANGE_TRANSITIONS, ...NON_CHANGE_TRANSITIONS]) {
      it(`voluntary + ${t} → false`, () => {
        expect(parksForApproval('voluntary', t)).toBe(false);
      });
    }
  });

  describe('autonomous gate never parks a completed transition', () => {
    for (const t of [...CHANGE_TRANSITIONS, ...NON_CHANGE_TRANSITIONS]) {
      it(`autonomous + ${t} → false`, () => {
        expect(parksForApproval('autonomous', t)).toBe(false);
      });
    }
  });

  describe('after-propose gate parks a completed propose only', () => {
    it('after-propose + propose → true', () => {
      expect(parksForApproval('after-propose', 'propose')).toBe(true);
    });
    it('after-propose + apply → false', () => {
      expect(parksForApproval('after-propose', 'apply')).toBe(false);
    });
    it('after-propose + verify → false', () => {
      expect(parksForApproval('after-propose', 'verify')).toBe(false);
    });
    it('after-propose + decompose → false', () => {
      expect(parksForApproval('after-propose', 'decompose')).toBe(false);
    });
    it('after-propose + pr → false', () => {
      expect(parksForApproval('after-propose', 'pr')).toBe(false);
    });
  });

  describe('every-phase gate parks every completed change transition', () => {
    for (const t of CHANGE_TRANSITIONS) {
      it(`every-phase + ${t} → true`, () => {
        expect(parksForApproval('every-phase', t)).toBe(true);
      });
    }
    it('every-phase + decompose → false (decomposition steps never park)', () => {
      expect(parksForApproval('every-phase', 'decompose')).toBe(false);
    });
    it('every-phase + pr → false (PR-open steps never park)', () => {
      expect(parksForApproval('every-phase', 'pr')).toBe(false);
    });
  });

  describe('undefined gate defaults to voluntary (parks nothing)', () => {
    for (const t of [...CHANGE_TRANSITIONS, ...NON_CHANGE_TRANSITIONS]) {
      it(`undefined + ${t} → false`, () => {
        expect(parksForApproval(undefined, t)).toBe(false);
      });
    }
  });

  it('is a total function over gates × transitions', () => {
    const all: StepKind[] = [...CHANGE_TRANSITIONS, ...NON_CHANGE_TRANSITIONS];
    for (const gate of GATES) {
      for (const t of all) {
        expect(typeof parksForApproval(gate, t)).toBe('boolean');
      }
    }
  });
});
