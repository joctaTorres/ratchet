import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import {
  writeChangeMetadata,
  readChangeMetadata,
  readDeclaredStandardTags,
  resolveSchemaForChange,
  validateSchemaName,
  ensureChangeMetadata,
  ChangeMetadataError,
} from '../../src/utils/change-metadata.js';
import { ChangeMetadataSchema } from '../../src/core/change-metadata/index.js';

// Controllable seam so we can force readProjectConfig to throw (its real
// implementation swallows all read errors and returns null, leaving the
// fall-back-on-throw catch in resolveSchemaForChange otherwise unreachable).
const { projectConfigShouldThrow } = vi.hoisted(() => ({
  projectConfigShouldThrow: { value: false },
}));

vi.mock('../../src/core/project-config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/project-config.js')>();
  return {
    ...actual,
    readProjectConfig: (projectRoot: string) => {
      if (projectConfigShouldThrow.value) {
        throw new Error('boom: project config read failed');
      }
      return actual.readProjectConfig(projectRoot);
    },
  };
});

describe('ChangeMetadataSchema', () => {
  describe('valid metadata', () => {
    it('should accept valid schema with created date', () => {
      const result = ChangeMetadataSchema.safeParse({
        schema: 'ratchet',
        created: '2025-01-05',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.schema).toBe('ratchet');
        expect(result.data.created).toBe('2025-01-05');
      }
    });

    it('should accept valid schema without created date', () => {
      const result = ChangeMetadataSchema.safeParse({
        schema: 'custom-schema',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.schema).toBe('custom-schema');
        expect(result.data.created).toBeUndefined();
      }
    });

    it('should accept a standards list of tags', () => {
      const result = ChangeMetadataSchema.safeParse({
        schema: 'ratchet',
        standards: ['security', 'testing'],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.standards).toEqual(['security', 'testing']);
      }
    });

    it('should treat standards as optional', () => {
      const result = ChangeMetadataSchema.safeParse({ schema: 'ratchet' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.standards).toBeUndefined();
      }
    });

  });

  describe('invalid metadata', () => {
    it('should reject empty schema', () => {
      const result = ChangeMetadataSchema.safeParse({
        schema: '',
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing schema', () => {
      const result = ChangeMetadataSchema.safeParse({
        created: '2025-01-05',
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid date format', () => {
      const result = ChangeMetadataSchema.safeParse({
        schema: 'ratchet',
        created: '01/05/2025', // Wrong format
      });
      expect(result.success).toBe(false);
    });

    it('should reject non-ISO date format', () => {
      const result = ChangeMetadataSchema.safeParse({
        schema: 'ratchet',
        created: '2025-1-5', // Missing leading zeros
      });
      expect(result.success).toBe(false);
    });

  });
});

describe('writeChangeMetadata', () => {
  let testDir: string;
  let changeDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `ratchet-test-${randomUUID()}`);
    changeDir = path.join(testDir, '.ratchet', 'changes', 'test-change');
    await fs.mkdir(changeDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should write valid YAML metadata file', async () => {
    writeChangeMetadata(changeDir, {
      schema: 'ratchet',
      created: '2025-01-05',
    });

    const metaPath = path.join(changeDir, '.ratchet.yaml');
    const content = await fs.readFile(metaPath, 'utf-8');

    expect(content).toContain('schema: ratchet');
    expect(content).toContain('created: 2025-01-05');
  });

  it('should throw error for unknown schema', () => {
    expect(() =>
      writeChangeMetadata(changeDir, {
        schema: 'unknown-schema',
        created: '2025-01-05',
      })
    ).toThrow(/Unknown schema 'unknown-schema'/);
  });

  it('should round-trip a standards list through write and read', () => {
    writeChangeMetadata(changeDir, {
      schema: 'ratchet',
      standards: ['security', 'testing'],
    });

    const result = readChangeMetadata(changeDir);
    expect(result?.standards).toEqual(['security', 'testing']);
  });

  it('throws ChangeMetadataError when metadata fails Zod validation (schema passes, shape invalid)', async () => {
    // `created` in a non-ISO form passes the schema-name gate (schema 'ratchet'
    // is valid) but fails the Zod ChangeMetadataSchema parse, exercising the
    // safeParse failure branch in writeChangeMetadata.
    expect(() =>
      writeChangeMetadata(changeDir, {
        schema: 'ratchet',
        created: 'not-a-real-date',
      } as any)
    ).toThrow(ChangeMetadataError);

    try {
      writeChangeMetadata(changeDir, { schema: 'ratchet', created: '01/05/2025' } as any);
      throw new Error('expected writeChangeMetadata to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ChangeMetadataError);
      expect((err as ChangeMetadataError).message).toMatch(/Invalid metadata/);
      expect((err as ChangeMetadataError).metadataPath).toBe(
        path.join(changeDir, '.ratchet.yaml')
      );
    }
    // Nothing should have been written.
    await expect(fs.access(path.join(changeDir, '.ratchet.yaml'))).rejects.toThrow();
  });

  it('wraps a write failure in ChangeMetadataError carrying the cause', async () => {
    // Make the target `.ratchet.yaml` a DIRECTORY so the underlying writeFileSync
    // fails with EISDIR — exercises the write-failure catch without spying on the
    // (non-configurable in ESM) node:fs namespace.
    await fs.mkdir(path.join(changeDir, '.ratchet.yaml'), { recursive: true });

    try {
      writeChangeMetadata(changeDir, { schema: 'ratchet', created: '2025-01-05' });
      throw new Error('expected writeChangeMetadata to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ChangeMetadataError);
      expect((err as ChangeMetadataError).message).toMatch(/Failed to write metadata/);
      expect((err as ChangeMetadataError).cause).toBeInstanceOf(Error);
      expect((err as ChangeMetadataError).metadataPath).toBe(
        path.join(changeDir, '.ratchet.yaml')
      );
    }
  });
});

describe('readChangeMetadata', () => {
  let testDir: string;
  let changeDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `ratchet-test-${randomUUID()}`);
    changeDir = path.join(testDir, '.ratchet', 'changes', 'test-change');
    await fs.mkdir(changeDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should return null when no metadata file exists', () => {
    const result = readChangeMetadata(changeDir);
    expect(result).toBeNull();
  });

  it('should read valid metadata', async () => {
    const metaPath = path.join(changeDir, '.ratchet.yaml');
    await fs.writeFile(
      metaPath,
      'schema: ratchet\ncreated: "2025-01-05"\n',
      'utf-8'
    );

    const result = readChangeMetadata(changeDir);
    expect(result).toEqual({
      schema: 'ratchet',
      created: '2025-01-05',
    });
  });

  it('should read schema and created metadata', async () => {
    const metaPath = path.join(changeDir, '.ratchet.yaml');
    await fs.writeFile(
      metaPath,
      [
        'schema: ratchet',
        'created: 2025-01-05',
        '',
      ].join('\n'),
      'utf-8'
    );

    const result = readChangeMetadata(changeDir);
    expect(result?.schema).toBe('ratchet');
    expect(result?.created).toBe('2025-01-05');
  });

  it('should throw ChangeMetadataError for invalid YAML', async () => {
    const metaPath = path.join(changeDir, '.ratchet.yaml');
    await fs.writeFile(metaPath, '{ invalid yaml', 'utf-8');

    expect(() => readChangeMetadata(changeDir)).toThrow(ChangeMetadataError);
  });

  it('should throw ChangeMetadataError for missing schema field', async () => {
    const metaPath = path.join(changeDir, '.ratchet.yaml');
    await fs.writeFile(metaPath, 'created: "2025-01-05"\n', 'utf-8');

    expect(() => readChangeMetadata(changeDir)).toThrow(ChangeMetadataError);
  });

  it('should throw ChangeMetadataError for unknown schema', async () => {
    const metaPath = path.join(changeDir, '.ratchet.yaml');
    await fs.writeFile(metaPath, 'schema: unknown-schema\n', 'utf-8');

    expect(() => readChangeMetadata(changeDir)).toThrow(/Unknown schema/);
  });

  it('wraps a read failure in ChangeMetadataError carrying the cause', async () => {
    // Make `.ratchet.yaml` a DIRECTORY: existsSync(metaPath) is true (so we get
    // past the null check) but readFileSync fails with EISDIR — exercising the
    // read-failure catch branch.
    await fs.mkdir(path.join(changeDir, '.ratchet.yaml'), { recursive: true });

    try {
      readChangeMetadata(changeDir);
      throw new Error('expected readChangeMetadata to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ChangeMetadataError);
      expect((err as ChangeMetadataError).message).toMatch(/Failed to read metadata/);
      expect((err as ChangeMetadataError).cause).toBeInstanceOf(Error);
    }
  });
});

describe('resolveSchemaForChange', () => {
  let testDir: string;
  let changeDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `ratchet-test-${randomUUID()}`);
    changeDir = path.join(testDir, '.ratchet', 'changes', 'test-change');
    await fs.mkdir(changeDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should return explicit schema when provided', async () => {
    // Even with metadata file, explicit schema wins
    const metaPath = path.join(changeDir, '.ratchet.yaml');
    await fs.writeFile(metaPath, 'schema: ratchet\n', 'utf-8');

    const result = resolveSchemaForChange(changeDir, 'custom-schema');
    expect(result).toBe('custom-schema');
  });

  it('should return schema from metadata when no explicit schema', async () => {
    const metaPath = path.join(changeDir, '.ratchet.yaml');
    await fs.writeFile(metaPath, 'schema: ratchet\n', 'utf-8');

    const result = resolveSchemaForChange(changeDir);
    expect(result).toBe('ratchet');
  });

  it('should return default when no metadata and no explicit schema', () => {
    const result = resolveSchemaForChange(changeDir);
    expect(result).toBe('ratchet');
  });

  it('should fail when metadata exists but cannot be read', async () => {
    // Create an invalid metadata file
    const metaPath = path.join(changeDir, '.ratchet.yaml');
    await fs.writeFile(metaPath, '{ invalid yaml', 'utf-8');

    expect(() => resolveSchemaForChange(changeDir)).toThrow(ChangeMetadataError);
  });

  it('falls back to default when reading project config throws', async () => {
    // No metadata file present, so resolution reaches the project-config branch.
    // Force readProjectConfig to throw, exercising the try/catch that swallows
    // config-read failures and falls through to the default schema.
    projectConfigShouldThrow.value = true;
    try {
      const result = resolveSchemaForChange(changeDir);
      expect(result).toBe('ratchet'); // default, because config read threw
    } finally {
      projectConfigShouldThrow.value = false;
    }
  });

  it('should use project config schema when no metadata exists', async () => {
    // Create project config
    const configDir = path.join(testDir, '.ratchet');
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, 'config.yaml'),
      'schema: custom-schema\n',
      'utf-8'
    );

    const result = resolveSchemaForChange(changeDir);
    expect(result).toBe('custom-schema');
  });

  it('should prefer change metadata over project config', async () => {
    // Create project config
    const configDir = path.join(testDir, '.ratchet');
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, 'config.yaml'),
      'schema: custom-schema\n',
      'utf-8'
    );

    // Create change metadata with different schema
    const metaPath = path.join(changeDir, '.ratchet.yaml');
    await fs.writeFile(metaPath, 'schema: ratchet\n', 'utf-8');

    const result = resolveSchemaForChange(changeDir);
    expect(result).toBe('ratchet'); // Change metadata wins
  });

  it('should prefer explicit schema over all config sources', async () => {
    // Create project config
    const configDir = path.join(testDir, '.ratchet');
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, 'config.yaml'),
      'schema: custom-schema\n',
      'utf-8'
    );

    // Create change metadata
    const metaPath = path.join(changeDir, '.ratchet.yaml');
    await fs.writeFile(metaPath, 'schema: ratchet\n', 'utf-8');

    // Explicit schema should win
    const result = resolveSchemaForChange(changeDir, 'custom-schema');
    expect(result).toBe('custom-schema');
  });

  it('should test full precedence order: CLI > metadata > config > default', async () => {
    // Setup all levels
    const configDir = path.join(testDir, '.ratchet');
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, 'config.yaml'),
      'schema: custom-schema\n',
      'utf-8'
    );

    const metaPath = path.join(changeDir, '.ratchet.yaml');
    await fs.writeFile(metaPath, 'schema: ratchet\n', 'utf-8');

    // Test each level
    expect(resolveSchemaForChange(changeDir, 'custom-schema')).toBe('custom-schema'); // CLI wins
    expect(resolveSchemaForChange(changeDir)).toBe('ratchet'); // Metadata wins when no CLI

    // Remove metadata, config should win
    await fs.unlink(metaPath);
    expect(resolveSchemaForChange(changeDir)).toBe('custom-schema'); // Config wins

    // Remove config, default should win
    await fs.unlink(path.join(configDir, 'config.yaml'));
    expect(resolveSchemaForChange(changeDir)).toBe('ratchet'); // Default wins
  });
});

describe('ensureChangeMetadata', () => {
  let testDir: string;
  let changeDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `ratchet-ensure-${randomUUID()}`);
    // Mirror the real layout (projectRoot/.ratchet/changes/<name>) so the derived
    // project root and schema resolution behave like production.
    changeDir = path.join(testDir, '.ratchet', 'changes', 'test-change');
    await fs.mkdir(changeDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('returns false (no-op) when the change directory does not exist', () => {
    const missing = path.join(testDir, '.ratchet', 'changes', 'nope');
    expect(ensureChangeMetadata(missing, testDir)).toBe(false);
  });

  it('writes a stamp and returns true when none exists yet', async () => {
    const created = ensureChangeMetadata(changeDir, testDir);
    expect(created).toBe(true);

    const meta = readChangeMetadata(changeDir, testDir);
    expect(meta?.schema).toBe('ratchet'); // resolved default schema
    // A created date (YYYY-MM-DD) was stamped.
    expect(meta?.created).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns false (no-op) when a metadata file already exists', async () => {
    await fs.writeFile(
      path.join(changeDir, '.ratchet.yaml'),
      'schema: ratchet\ncreated: "2025-01-05"\n',
      'utf-8'
    );

    expect(ensureChangeMetadata(changeDir, testDir)).toBe(false);
    // Existing stamp left untouched.
    const meta = readChangeMetadata(changeDir, testDir);
    expect(meta?.created).toBe('2025-01-05');
  });

  it('derives the project root from changeDir when none is provided', () => {
    // changeDir is projectRoot/.ratchet/changes/<name>; without an explicit root
    // it resolves three levels up. The stamp still gets a default schema.
    const created = ensureChangeMetadata(changeDir);
    expect(created).toBe(true);
    const meta = readChangeMetadata(changeDir);
    expect(meta?.schema).toBe('ratchet');
  });
});

describe('validateSchemaName', () => {
  it('should accept valid schema name', () => {
    expect(() => validateSchemaName('ratchet')).not.toThrow();
  });

  it('should throw for unknown schema', () => {
    expect(() => validateSchemaName('unknown-schema')).toThrow(
      /Unknown schema 'unknown-schema'/
    );
  });
});

describe('readDeclaredStandardTags', () => {
  let changeDir: string;

  beforeEach(async () => {
    changeDir = path.join(os.tmpdir(), `ratchet-stdtags-${randomUUID()}`);
    await fs.mkdir(changeDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(changeDir, { recursive: true, force: true });
  });

  async function writeMeta(content: string): Promise<void> {
    await fs.writeFile(path.join(changeDir, '.ratchet.yaml'), content, 'utf-8');
  }

  it('returns the declared tags', async () => {
    await writeMeta('schema: ratchet\nstandards:\n  - security\n  - testing\n');
    expect(readDeclaredStandardTags(changeDir)).toEqual(['security', 'testing']);
  });

  it('returns the tags even when the schema is unknown (does not validate schema)', async () => {
    // Regression: the archive reader previously went through readChangeMetadata,
    // which throws on an unknown schema and silently dropped the declared tags —
    // so links never materialized. This reader must surface the tags regardless.
    await writeMeta('schema: not-a-real-schema\nstandards:\n  - security\n');
    expect(() => readChangeMetadata(changeDir)).toThrow(); // the divergent reader throws
    expect(readDeclaredStandardTags(changeDir)).toEqual(['security']); // this one does not
  });

  it('returns [] when no standards are declared', async () => {
    await writeMeta('schema: ratchet\n');
    expect(readDeclaredStandardTags(changeDir)).toEqual([]);
  });

  it('returns [] when the metadata file is absent', () => {
    expect(readDeclaredStandardTags(changeDir)).toEqual([]);
  });

  it('returns [] for malformed YAML rather than throwing', async () => {
    await writeMeta('schema: ratchet\nstandards: [unterminated\n');
    expect(readDeclaredStandardTags(changeDir)).toEqual([]);
  });

  it('ignores non-string entries in the standards list', async () => {
    await writeMeta('schema: ratchet\nstandards:\n  - security\n  - 42\n  - ""\n');
    expect(readDeclaredStandardTags(changeDir)).toEqual(['security']);
  });
});
