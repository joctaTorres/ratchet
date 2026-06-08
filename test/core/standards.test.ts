import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadStandards, getStandardsDir } from '../../src/core/standards.js';

describe('standards', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchet-standards-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function writeStandard(name: string, content: string): void {
    const dir = getStandardsDir(tempDir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }

  describe('getStandardsDir', () => {
    it('resolves to .ratchet/standards under the project root', () => {
      expect(getStandardsDir(tempDir)).toBe(
        path.join(tempDir, '.ratchet', 'standards')
      );
    });
  });

  describe('loadStandards', () => {
    it('returns an empty array when the directory is missing', () => {
      expect(loadStandards(tempDir)).toEqual([]);
    });

    it('returns an empty array when the directory is empty', () => {
      fs.mkdirSync(getStandardsDir(tempDir), { recursive: true });
      expect(loadStandards(tempDir)).toEqual([]);
    });

    it('loads each markdown file as a standard', () => {
      writeStandard('testing.md', '# Testing\n\nEvery change has tests.');
      writeStandard('security.md', '# Security\n\nValidate all input.');

      const standards = loadStandards(tempDir);

      expect(standards).toHaveLength(2);
      const names = standards.map((s) => s.name);
      expect(names).toContain('testing');
      expect(names).toContain('security');

      const testing = standards.find((s) => s.name === 'testing');
      expect(testing?.fileName).toBe('testing.md');
      expect(testing?.content).toContain('Every change has tests.');
    });

    it('sorts standards by file name for stable ordering', () => {
      writeStandard('security.md', '# Security');
      writeStandard('architecture.md', '# Architecture');
      writeStandard('testing.md', '# Testing');

      const names = loadStandards(tempDir).map((s) => s.name);
      expect(names).toEqual(['architecture', 'security', 'testing']);
    });

    it('ignores non-markdown files', () => {
      writeStandard('testing.md', '# Testing');
      const dir = getStandardsDir(tempDir);
      fs.writeFileSync(path.join(dir, 'notes.txt'), 'not a standard');
      fs.writeFileSync(path.join(dir, 'README'), 'no extension');

      const names = loadStandards(tempDir).map((s) => s.name);
      expect(names).toEqual(['testing']);
    });

    it('uses the explicit tag from frontmatter', () => {
      writeStandard(
        'security.md',
        '---\ntag: appsec\n---\n\n# Security\n\nValidate all input.\n'
      );

      const [standard] = loadStandards(tempDir);
      expect(standard.name).toBe('security');
      expect(standard.tag).toBe('appsec');
    });

    it('falls back to the file-name stem when no tag is declared', () => {
      writeStandard('testing.md', '# Testing\n\nEvery change has tests.\n');

      const [standard] = loadStandards(tempDir);
      expect(standard.tag).toBe('testing');
    });

    it('falls back to the file name when frontmatter has no tag field', () => {
      writeStandard(
        'testing.md',
        '---\nconcern: testing\n---\n\n# Testing\n'
      );

      const [standard] = loadStandards(tempDir);
      expect(standard.tag).toBe('testing');
    });

    it('returns content without the frontmatter block', () => {
      writeStandard(
        'security.md',
        '---\ntag: security\n---\n\n# Security\n\nValidate all input.\n'
      );

      const [standard] = loadStandards(tempDir);
      expect(standard.content).not.toContain('tag: security');
      expect(standard.content).not.toMatch(/^---/);
      expect(standard.content).toContain('# Security');
      expect(standard.content).toContain('Validate all input.');
    });

    it('keeps the full content when there is no frontmatter', () => {
      writeStandard('testing.md', '# Testing\n\nEvery change has tests.');

      const [standard] = loadStandards(tempDir);
      expect(standard.content).toBe('# Testing\n\nEvery change has tests.');
    });
  });
});
