import { describe, it, expect, afterEach } from 'vitest';
import {
  loadBatchEngine,
  registerBatchEngine,
  clearRegisteredBatchEngine,
  ENGINE_CONTRACT_VERSION,
  ENGINE_ABSENT_MESSAGE,
  type BatchEngine,
  type StepResult,
} from '../../../src/core/batch/engine.js';

function fakeEngine(contractVersion: number): BatchEngine {
  return {
    contractVersion,
    name: 'fake',
    async runStep(): Promise<StepResult> {
      return { state: 'advanced', change: 'c', transition: 'propose' };
    },
  };
}

afterEach(() => {
  clearRegisteredBatchEngine();
});

describe('loadBatchEngine', () => {
  it('reports engine-absent as a first-class state, not a crash', () => {
    const resolution = loadBatchEngine();
    expect(resolution.status).toBe('absent');
  });

  it('exposes an install/activate message for the absent state', () => {
    expect(ENGINE_ABSENT_MESSAGE.toLowerCase()).toContain('engine');
    expect(ENGINE_ABSENT_MESSAGE.toLowerCase()).toContain('install');
    expect(ENGINE_ABSENT_MESSAGE.toLowerCase()).toContain('activate');
  });

  it('returns the engine when contract versions match', () => {
    registerBatchEngine(fakeEngine(ENGINE_CONTRACT_VERSION));
    const resolution = loadBatchEngine();
    expect(resolution.status).toBe('ok');
    if (resolution.status === 'ok') {
      expect(resolution.engine.name).toBe('fake');
    }
  });

  it('refuses to run on a contract-version mismatch', () => {
    registerBatchEngine(fakeEngine(ENGINE_CONTRACT_VERSION + 1));
    const resolution = loadBatchEngine();
    expect(resolution.status).toBe('version-mismatch');
    if (resolution.status === 'version-mismatch') {
      expect(resolution.engineVersion).toBe(ENGINE_CONTRACT_VERSION + 1);
      expect(resolution.cliVersion).toBe(ENGINE_CONTRACT_VERSION);
    }
  });
});
