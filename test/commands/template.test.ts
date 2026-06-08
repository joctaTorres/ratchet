import { describe, it, expect, vi } from 'vitest';
import { templateCommand } from '../../src/commands/template.js';
import { loadTemplate } from '../../src/core/artifact-graph/index.js';

function captureStdout(): { chunks: string[]; restore: () => void } {
  const chunks: string[] = [];
  const spy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: unknown): boolean => {
      chunks.push(String(chunk));
      return true;
    });
  return { chunks, restore: () => spy.mockRestore() };
}

describe('template command', () => {
  it('prints the canonical standard template (single source of truth)', async () => {
    const { chunks, restore } = captureStdout();
    try {
      await templateCommand('standard', {});
    } finally {
      restore();
    }

    const out = chunks.join('');
    expect(out).toContain('tag:');
    expect(out).toContain('## Guidelines');

    // The printed template is exactly the schema's canonical file — so propose-standard
    // following this output can never drift from schemas/ratchet/templates/standard.md.
    const canonical = loadTemplate('ratchet', 'standard.md');
    expect(out.trimEnd()).toBe(canonical.trimEnd());
  });

  it('resolves a bare name with a known extension', async () => {
    const { chunks, restore } = captureStdout();
    try {
      await templateCommand('plan', {});
    } finally {
      restore();
    }
    expect(chunks.join('')).toContain('## Why');
  });

  it('throws for an unknown template name', async () => {
    await expect(templateCommand('does-not-exist', {})).rejects.toThrow();
  });
});
