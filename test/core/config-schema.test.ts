/**
 * Unit tests for the pure helpers in src/core/config-schema.ts.
 *
 * Implements features/core-util-tests/config-schema.feature: key-path
 * validation, nested get/set/delete, value coercion, YAML formatting and
 * schema validation. These are deterministic functions over in-memory inputs —
 * the tests touch no filesystem and spawn no process.
 */
import { describe, it, expect } from 'vitest';
import {
  validateConfig,
  validateConfigKeyPath,
  getNestedValue,
  setNestedValue,
  deleteNestedValue,
  coerceValue,
  formatValueYaml,
} from '../../src/core/config-schema.js';

describe('config-schema', () => {
  describe('validateConfig', () => {
    it('passes a config with known fields and unknown passthrough fields', () => {
      const result = validateConfig({
        featureFlags: { someFlag: true },
        profile: 'custom',
        delivery: 'skills',
        workflows: ['propose'],
        unknownPassthrough: 'kept',
      });

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('fails with a path-qualified message when an enum field is invalid', () => {
      const result = validateConfig({ profile: 'not-a-real-profile' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('profile');
    });
  });

  describe('validateConfigKeyPath', () => {
    it('accepts a known top-level key', () => {
      expect(validateConfigKeyPath('delivery')).toEqual({ valid: true });
    });

    it('rejects an unknown top-level key, naming it in the reason', () => {
      const result = validateConfigKeyPath('totallyUnknown');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('totallyUnknown');
    });

    it('rejects a key path with an empty segment', () => {
      const result = validateConfigKeyPath('featureFlags..flag');

      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/empty/i);
    });

    it('accepts featureFlags one level deep but not two', () => {
      expect(validateConfigKeyPath('featureFlags.someFlag')).toEqual({ valid: true });

      const tooDeep = validateConfigKeyPath('featureFlags.a.b');
      expect(tooDeep.valid).toBe(false);
      expect(tooDeep.reason).toMatch(/nested/i);
    });

    it('rejects nested paths on a non-featureFlags key', () => {
      const result = validateConfigKeyPath('delivery.nested');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('does not support nested keys');
    });
  });

  describe('getNestedValue', () => {
    it('resolves an existing dot path and misses a non-existent one', () => {
      const obj = { featureFlags: { enabled: true } };

      expect(getNestedValue(obj, 'featureFlags.enabled')).toBe(true);
      expect(getNestedValue(obj, 'featureFlags.missing')).toBeUndefined();
    });

    it('returns undefined when traversal hits a non-object', () => {
      const obj = { profile: 'core' };

      expect(getNestedValue(obj, 'profile.nope')).toBeUndefined();
    });
  });

  describe('setNestedValue', () => {
    it('creates intermediate objects when writing a deep path', () => {
      const obj: Record<string, unknown> = {};

      setNestedValue(obj, 'featureFlags.enabled', true);

      expect(obj).toEqual({ featureFlags: { enabled: true } });
    });

    it('overwrites a non-object intermediate with an object', () => {
      const obj: Record<string, unknown> = { featureFlags: 'scalar' };

      setNestedValue(obj, 'featureFlags.enabled', false);

      expect(obj).toEqual({ featureFlags: { enabled: false } });
    });
  });

  describe('deleteNestedValue', () => {
    it('removes an existing leaf and returns true', () => {
      const obj: Record<string, unknown> = { featureFlags: { enabled: true } };

      expect(deleteNestedValue(obj, 'featureFlags.enabled')).toBe(true);
      expect(obj).toEqual({ featureFlags: {} });
    });

    it('returns false for a missing path without mutating the object', () => {
      const obj: Record<string, unknown> = { featureFlags: { enabled: true } };

      expect(deleteNestedValue(obj, 'featureFlags.missing')).toBe(false);
      expect(deleteNestedValue(obj, 'missingRoot.leaf')).toBe(false);
      expect(obj).toEqual({ featureFlags: { enabled: true } });
    });
  });

  describe('coerceValue', () => {
    it('maps "true"/"false" to booleans, numeric strings to numbers, and leaves the rest as strings', () => {
      expect(coerceValue('true')).toBe(true);
      expect(coerceValue('false')).toBe(false);
      expect(coerceValue('42')).toBe(42);
      expect(coerceValue('3.14')).toBe(3.14);
      expect(coerceValue('abc')).toBe('abc');
      expect(coerceValue(' ')).toBe(' ');
    });

    it('returns the raw string for any input when forceString is set', () => {
      expect(coerceValue('true', true)).toBe('true');
      expect(coerceValue('42', true)).toBe('42');
    });
  });

  describe('formatValueYaml', () => {
    it('renders scalars and strings inline', () => {
      expect(formatValueYaml(true)).toBe('true');
      expect(formatValueYaml(42)).toBe('42');
      expect(formatValueYaml('hello')).toBe('hello');
      expect(formatValueYaml(null)).toBe('null');
      expect(formatValueYaml(undefined)).toBe('null');
    });

    it('renders empty collections as [] and {}', () => {
      expect(formatValueYaml([])).toBe('[]');
      expect(formatValueYaml({})).toBe('{}');
    });

    it('renders lists and nested objects indented across lines', () => {
      const list = formatValueYaml(['a', 'b']);
      expect(list).toContain('- a');
      expect(list).toContain('- b');
      expect(list.split('\n')).toHaveLength(2);

      const nested = formatValueYaml({ outer: { inner: 'leaf' } });
      expect(nested).toContain('outer:');
      expect(nested).toContain('inner: leaf');
      expect(nested).toContain('\n');
    });
  });
});
