// Feature: config-isolation-per-locus.feature
// Proves describeLocusIsolation states the REAL isolation per locus: local is
// advisory (no filesystem/network isolation, env allowlist), docker is container
// isolation with the resolved #85 contract (uid/memory/pids/network + writable
// repo mount), and remote is the server's boundary. Pure over BatchSettings.

import { describe, it, expect } from 'vitest';
import {
  describeLocusIsolation,
  resolveDockerContract,
} from '../../src/core/batch/runtime/isolation.js';
import {
  DEFAULT_DOCKER_MEMORY,
  DEFAULT_DOCKER_NETWORK,
  DEFAULT_DOCKER_PIDS_LIMIT,
} from '../../src/core/batch/config.js';
import type { BatchSettings } from '../../src/core/batch/config.js';

function base(over: Partial<BatchSettings> = {}): BatchSettings {
  return {
    gate: 'voluntary',
    strategy: 'vertical-slice',
    proofOfWork: 'hard-gate',
    locus: 'local',
    prGrouping: 'off',
    ...over,
  };
}

describe('describeLocusIsolation — local locus', () => {
  it('states the local locus is advisory with no filesystem or network isolation', () => {
    const iso = describeLocusIsolation(base({ locus: 'local' }));
    expect(iso.locus).toBe('local');
    expect(iso.description).toContain('Advisory');
    expect(iso.description).toContain('no filesystem or network isolation');
  });

  it('states the agent environment is scoped to the env allowlist', () => {
    const iso = describeLocusIsolation(base({ locus: 'local' }));
    expect(iso.description).toContain('env allowlist');
  });
});

describe('describeLocusIsolation — docker locus', () => {
  it('states the docker locus provides container isolation with its contract', () => {
    const iso = describeLocusIsolation(base({ locus: 'docker' }));
    expect(iso.locus).toBe('docker');
    expect(iso.description).toContain('Container isolation');
    expect(iso.description).toContain('uid');
    expect(iso.description).toContain('memory');
    expect(iso.description).toContain('pids');
    expect(iso.description).toContain('network');
  });

  it('states the repository mount stays writable by design', () => {
    const iso = describeLocusIsolation(base({ locus: 'docker' }));
    expect(iso.description).toContain('Repository mount stays writable by design');
  });

  it('applies the runtime defaults for an unset uid/memory/pids/network', () => {
    const c = resolveDockerContract(base({ locus: 'docker' }));
    expect(c.user).toBe('host uid:gid');
    expect(c.memory).toBe(DEFAULT_DOCKER_MEMORY);
    expect(c.pids).toBe(String(DEFAULT_DOCKER_PIDS_LIMIT));
    expect(c.network).toBe(DEFAULT_DOCKER_NETWORK);
    expect(c.cpus).toBeUndefined();
  });

  it('uses the configured knobs when set, including cpus', () => {
    const iso = describeLocusIsolation(
      base({
        locus: 'docker',
        dockerUser: '1000:1000',
        dockerMemory: '4g',
        dockerPidsLimit: 1024,
        dockerCpus: 1.5,
        network: 'none',
      })
    );
    expect(iso.description).toContain('uid 1000:1000');
    expect(iso.description).toContain('memory 4g');
    expect(iso.description).toContain('pids 1024');
    expect(iso.description).toContain('network none');
    expect(iso.description).toContain('cpus 1.5');
  });

  it('omits the cpus clause when cpus is unset', () => {
    const iso = describeLocusIsolation(base({ locus: 'docker' }));
    expect(iso.description).not.toContain('cpus');
  });

  it('network none is reflected (full isolation contract)', () => {
    const iso = describeLocusIsolation(base({ locus: 'docker', network: 'none' }));
    expect(iso.description).toContain('network none');
  });
});

describe('describeLocusIsolation — remote locus', () => {
  it('states isolation is the remote server boundary, not one ratchet enforces', () => {
    const iso = describeLocusIsolation(base({ locus: 'remote', host: 'h', port: 1, authToken: 'x' }));
    expect(iso.locus).toBe('remote');
    expect(iso.description).toContain("remote server's boundary");
    expect(iso.description).toContain('not one ratchet enforces');
  });
});

describe('describeLocusIsolation — pure over settings (no I/O)', () => {
  it('does not read the filesystem or process to resolve docker defaults', () => {
    // No dockerUser set: the descriptor states the documented "host uid:gid"
    // fallback rather than reading process.getuid, so it is deterministic.
    const iso = describeLocusIsolation(base({ locus: 'docker' }));
    expect(iso.description).toContain('uid host uid:gid');
  });
});
