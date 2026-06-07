import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { ArchiveCommand } from '../../src/core/archive.js';
import { materializeStandardLinks } from '../../src/core/features-apply.js';
import { RATCHET_DIR_NAME } from '../../src/core/config.js';

/**
 * End-to-end tests for materializing standard links into the feature store on
 * archive. Mirrors features/standard-links/materialize-links-on-archive.feature.
 */

async function writeFile(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, 'utf-8');
}

const FEATURE = (name: string) =>
  `Feature: ${name}\n  Scenario: works\n    Given a thing\n    When it happens\n    Then it works\n`;

const PLAN = (name: string) =>
  `# ${name}\n\n## Why\nWe need this capability so that the product works as intended for users.\n\n## What Changes\nAdd the ${name} behavior.\n\n## Design\nStraightforward implementation.\n\n## Tasks\n- [x] 1.1 Implement ${name}\n`;

describe('standard links on archive', () => {
  let root: string;
  let cwd: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ratchet-stdlinks-'));
    cwd = process.cwd();
    process.chdir(root);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    process.chdir(cwd);
    logSpy.mockRestore();
    await fs.rm(root, { recursive: true, force: true });
  });

  const standardPath = (file: string) =>
    path.join(root, RATCHET_DIR_NAME, 'standards', file);
  const sidecarPath = (capability: string) =>
    path.join(root, RATCHET_DIR_NAME, 'features', capability, '.ratchet.yaml');

  async function writeStandard(file: string, tag: string): Promise<void> {
    await writeFile(
      standardPath(file),
      `---\ntag: ${tag}\n---\n\n# ${tag}\n\n## Guidelines\n\n- Be ${tag}.\n`
    );
  }

  /** Scaffold an active change with one or more features + optional standards/tombstone. */
  async function scaffoldChange(
    name: string,
    opts: { features: string[]; standards?: string[]; deleted?: string[] }
  ): Promise<void> {
    const changeDir = path.join(root, RATCHET_DIR_NAME, 'changes', name);
    const meta =
      opts.standards && opts.standards.length > 0
        ? `schema: ratchet\nstandards:\n${opts.standards.map((s) => `  - ${s}`).join('\n')}\n`
        : 'schema: ratchet\n';
    await writeFile(path.join(changeDir, '.ratchet.yaml'), meta);
    await writeFile(path.join(changeDir, 'plan.md'), PLAN(name));
    for (const rel of opts.features) {
      await writeFile(path.join(changeDir, 'features', rel), FEATURE(rel));
    }
    if (opts.deleted && opts.deleted.length > 0) {
      await writeFile(
        path.join(changeDir, 'features', '.deleted'),
        opts.deleted.join('\n') + '\n'
      );
    }
  }

  async function readYaml(file: string): Promise<any> {
    const yaml = await import('yaml');
    return yaml.parse(await fs.readFile(file, 'utf-8'));
  }

  it('carries the forward link into the per-capability sidecar', async () => {
    await writeStandard('security.md', 'security');
    await scaffoldChange('add-auth', {
      features: ['auth/login.feature', 'auth/logout.feature'],
      standards: ['security'],
    });

    await new ArchiveCommand().execute('add-auth', { yes: true });

    const sidecar = await readYaml(sidecarPath('auth'));
    expect(sidecar.features['login.feature']).toEqual(['security']);
    expect(sidecar.features['logout.feature']).toEqual(['security']);
  });

  it('materializes the generated reverse block on the standard', async () => {
    await writeStandard('security.md', 'security');
    await scaffoldChange('add-auth', {
      features: ['auth/login.feature', 'auth/logout.feature'],
      standards: ['security'],
    });

    await new ArchiveCommand().execute('add-auth', { yes: true });

    const standard = await fs.readFile(standardPath('security.md'), 'utf-8');
    expect(standard).toContain('## Implemented by');
    expect(standard).toContain('ratchet:implemented-by');
    expect(standard).toContain('- auth/login.feature');
    expect(standard).toContain('- auth/logout.feature');
  });

  it('regenerates the reverse block rather than appending: a tombstone drops an entry', async () => {
    await writeStandard('security.md', 'security');

    // First change establishes login + logout under security.
    await scaffoldChange('add-auth', {
      features: ['auth/login.feature', 'auth/logout.feature'],
      standards: ['security'],
    });
    await new ArchiveCommand().execute('add-auth', { yes: true });

    let standard = await fs.readFile(standardPath('security.md'), 'utf-8');
    expect(standard).toContain('- auth/login.feature');

    // Second change tombstones login.feature.
    await scaffoldChange('drop-login', {
      features: ['auth/logout.feature'],
      standards: ['security'],
      deleted: ['auth/login.feature'],
    });
    await new ArchiveCommand().execute('drop-login', { yes: true });

    standard = await fs.readFile(standardPath('security.md'), 'utf-8');
    expect(standard).not.toContain('- auth/login.feature');
    expect(standard).toContain('- auth/logout.feature');

    const sidecar = await readYaml(sidecarPath('auth'));
    expect(sidecar.features['login.feature']).toBeUndefined();
  });

  it('a second change extends the standard implementing-features list', async () => {
    await writeStandard('security.md', 'security');

    await scaffoldChange('add-auth', {
      features: ['auth/login.feature'],
      standards: ['security'],
    });
    await new ArchiveCommand().execute('add-auth', { yes: true });

    await scaffoldChange('add-billing', {
      features: ['billing/charge.feature'],
      standards: ['security'],
    });
    await new ArchiveCommand().execute('add-billing', { yes: true });

    const standard = await fs.readFile(standardPath('security.md'), 'utf-8');
    expect(standard).toContain('- auth/login.feature');
    expect(standard).toContain('- billing/charge.feature');
  });

  it('is a no-op when the change declares no standards', async () => {
    await writeStandard('security.md', 'security');
    const before = await fs.readFile(standardPath('security.md'), 'utf-8');

    await scaffoldChange('add-docs', {
      features: ['docs/intro.feature'],
      // no standards
    });
    await new ArchiveCommand().execute('add-docs', { yes: true });

    // No sidecar written for the change's capability.
    await expect(fs.access(sidecarPath('docs'))).rejects.toThrow();
    // Standard untouched.
    const after = await fs.readFile(standardPath('security.md'), 'utf-8');
    expect(after).toBe(before);
  });

  it('materializeStandardLinks is idempotent for identical inputs', async () => {
    await writeStandard('security.md', 'security');
    await scaffoldChange('add-auth', {
      features: ['auth/login.feature'],
      standards: ['security'],
    });
    // Apply the feature into the store first (so source/target exist).
    const { applyFeatures } = await import('../../src/core/features-apply.js');
    await applyFeatures('.', 'add-auth', {});

    await materializeStandardLinks('.', 'add-auth', ['security']);
    const first = await fs.readFile(standardPath('security.md'), 'utf-8');
    await materializeStandardLinks('.', 'add-auth', ['security']);
    const second = await fs.readFile(standardPath('security.md'), 'utf-8');

    expect(second).toBe(first);
  });
});
