import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { Validator } from '../../src/core/validation/validator.js';
import { RATCHET_DIR_NAME } from '../../src/core/config.js';

async function writeFile(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, 'utf-8');
}

describe('Validator.validateStandards', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ratchet-validate-std-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const standardsDir = () => path.join(root, RATCHET_DIR_NAME, 'standards');
  const changeDir = (name: string) =>
    path.join(root, RATCHET_DIR_NAME, 'changes', name);

  async function writeStandard(file: string, tag?: string): Promise<void> {
    const body = tag
      ? `---\ntag: ${tag}\n---\n\n# ${tag}\n`
      : `# ${file.replace(/\.md$/, '')}\n`;
    await writeFile(path.join(standardsDir(), file), body);
  }

  async function writeChange(name: string, standards?: string[]): Promise<string> {
    const dir = changeDir(name);
    const meta =
      standards && standards.length > 0
        ? `schema: ratchet\nstandards:\n${standards.map((s) => `  - ${s}`).join('\n')}\n`
        : 'schema: ratchet\n';
    await writeFile(path.join(dir, '.ratchet.yaml'), meta);
    return dir;
  }

  it('passes when tags are unique and references resolve', async () => {
    await writeStandard('security.md', 'security');
    await writeStandard('testing.md', 'testing');
    const dir = await writeChange('my-change', ['security']);

    const report = new Validator().validateStandards(dir, root);
    expect(report.valid).toBe(true);
    expect(report.summary.errors).toBe(0);
  });

  it('reports a duplicate standard tag', async () => {
    await writeStandard('security.md', 'security');
    await writeStandard('appsec.md', 'security');
    const dir = await writeChange('my-change');

    const report = new Validator().validateStandards(dir, root);
    expect(report.valid).toBe(false);
    expect(
      report.issues.some(
        (i) => i.level === 'ERROR' && /Duplicate standard tag "security"/.test(i.message)
      )
    ).toBe(true);
  });

  it('reports a duplicate tag only once', async () => {
    await writeStandard('a.md', 'dup');
    await writeStandard('b.md', 'dup');
    await writeStandard('c.md', 'dup');
    const dir = await writeChange('my-change');

    const report = new Validator().validateStandards(dir, root);
    const dupes = report.issues.filter((i) => /Duplicate standard tag "dup"/.test(i.message));
    expect(dupes).toHaveLength(1);
  });

  it('reports an unknown standard tag referenced by a change', async () => {
    await writeStandard('security.md', 'security');
    const dir = await writeChange('my-change', ['nonexistent']);

    const report = new Validator().validateStandards(dir, root);
    expect(report.valid).toBe(false);
    expect(
      report.issues.some(
        (i) => i.level === 'ERROR' && /Unknown standard tag "nonexistent"/.test(i.message)
      )
    ).toBe(true);
  });

  it('resolves file-name fallback tags', async () => {
    await writeStandard('testing.md'); // no explicit tag -> tag "testing"
    const dir = await writeChange('my-change', ['testing']);

    const report = new Validator().validateStandards(dir, root);
    expect(report.valid).toBe(true);
  });

  it('treats a change with no standards list as valid', async () => {
    await writeStandard('security.md', 'security');
    const dir = await writeChange('my-change');

    const report = new Validator().validateStandards(dir, root);
    expect(report.valid).toBe(true);
  });

  it('validates a module change tag against the layered (inherited) set', async () => {
    // Root defines "testing"; the module declares it without redefining it.
    await writeStandard('testing.md', 'testing');
    await fs.mkdir(path.join(root, RATCHET_DIR_NAME, 'changes'), { recursive: true });

    const moduleRoot = path.join(root, 'packages', 'api');
    await fs.mkdir(path.join(moduleRoot, RATCHET_DIR_NAME, 'changes'), { recursive: true });
    const moduleChangeDir = path.join(moduleRoot, RATCHET_DIR_NAME, 'changes', 'add-auth');
    await writeFile(
      path.join(moduleChangeDir, '.ratchet.yaml'),
      'schema: ratchet\nstandards:\n  - testing\n'
    );

    // Resolve projectRoot from the module change dir (../../.. = module root).
    const report = new Validator().validateStandards(moduleChangeDir);
    expect(report.valid).toBe(true);
    expect(
      report.issues.some((i) => /Unknown standard tag "testing"/.test(i.message))
    ).toBe(false);
  });
});
