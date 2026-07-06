import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  readProjectConfig,
  validateConfigRules,
  suggestSchemas,
} from '../../src/core/project-config.js';

describe('project-config', () => {
  let tempDir: string;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchet-test-config-'));
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    consoleWarnSpy.mockRestore();
  });

  describe('readProjectConfig', () => {
    describe('resilient parsing', () => {
      it('should parse complete valid config', () => {
        const configDir = path.join(tempDir, '.ratchet');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: ratchet
context: |
  Tech stack: TypeScript, React
  API style: RESTful
rules:
  proposal:
    - Include rollback plan
    - Identify affected teams
  specs:
    - Use Given/When/Then format
`
        );

        const config = readProjectConfig(tempDir);

        expect(config).toEqual({
          schema: 'ratchet',
          context: 'Tech stack: TypeScript, React\nAPI style: RESTful\n',
          rules: {
            proposal: ['Include rollback plan', 'Identify affected teams'],
            specs: ['Use Given/When/Then format'],
          },
        });
        expect(consoleWarnSpy).not.toHaveBeenCalled();
      });

      it('should parse minimal config with schema only', () => {
        const configDir = path.join(tempDir, '.ratchet');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(path.join(configDir, 'config.yaml'), 'schema: ratchet\n');

        const config = readProjectConfig(tempDir);

        expect(config).toEqual({
          schema: 'ratchet',
        });
        expect(consoleWarnSpy).not.toHaveBeenCalled();
      });

      it('should return partial config when schema is invalid', () => {
        const configDir = path.join(tempDir, '.ratchet');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: ""
context: Valid context here
rules:
  proposal:
    - Valid rule
`
        );

        const config = readProjectConfig(tempDir);

        expect(config).toEqual({
          context: 'Valid context here',
          rules: {
            proposal: ['Valid rule'],
          },
        });
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining("Invalid 'schema' field")
        );
      });

      it('should return partial config when context is invalid', () => {
        const configDir = path.join(tempDir, '.ratchet');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: ratchet
context: 123
rules:
  proposal:
    - Valid rule
`
        );

        const config = readProjectConfig(tempDir);

        expect(config).toEqual({
          schema: 'ratchet',
          rules: {
            proposal: ['Valid rule'],
          },
        });
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining("Invalid 'context' field")
        );
      });

      it('should return partial config when rules is not an object', () => {
        const configDir = path.join(tempDir, '.ratchet');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: ratchet
context: Valid context
rules: ["not", "an", "object"]
`
        );

        const config = readProjectConfig(tempDir);

        expect(config).toEqual({
          schema: 'ratchet',
          context: 'Valid context',
        });
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining("Invalid 'rules' field")
        );
      });

      it('should handle rules: null without aborting config parsing', () => {
        // YAML `rules:` with no value parses to null
        const configDir = path.join(tempDir, '.ratchet');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: ratchet
context: Valid context
rules:
`
        );

        const config = readProjectConfig(tempDir);

        // Should still parse schema and context despite null rules
        expect(config).toEqual({
          schema: 'ratchet',
          context: 'Valid context',
        });
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining("Invalid 'rules' field")
        );
      });

      it('should filter out invalid rules for specific artifact', () => {
        const configDir = path.join(tempDir, '.ratchet');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: ratchet
rules:
  proposal:
    - Valid rule
  specs: "not an array"
  design:
    - Another valid rule
`
        );

        const config = readProjectConfig(tempDir);

        expect(config).toEqual({
          schema: 'ratchet',
          rules: {
            proposal: ['Valid rule'],
            design: ['Another valid rule'],
          },
        });
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining("Rules for 'specs' must be an array of strings")
        );
      });

      it('should filter out empty string rules', () => {
        const configDir = path.join(tempDir, '.ratchet');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: ratchet
rules:
  proposal:
    - Valid rule
    - ""
    - Another valid rule
    - ""
`
        );

        const config = readProjectConfig(tempDir);

        expect(config).toEqual({
          schema: 'ratchet',
          rules: {
            proposal: ['Valid rule', 'Another valid rule'],
          },
        });
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining("Some rules for 'proposal' are empty strings")
        );
      });

      it('should skip artifact if all rules are empty strings', () => {
        const configDir = path.join(tempDir, '.ratchet');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: ratchet
rules:
  proposal:
    - ""
    - ""
  specs:
    - Valid rule
`
        );

        const config = readProjectConfig(tempDir);

        expect(config).toEqual({
          schema: 'ratchet',
          rules: {
            specs: ['Valid rule'],
          },
        });
      });

      it('should handle completely invalid YAML gracefully', () => {
        const configDir = path.join(tempDir, '.ratchet');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(path.join(configDir, 'config.yaml'), 'schema: [unclosed');

        const config = readProjectConfig(tempDir);

        expect(config).toBeNull();
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Failed to parse .ratchet/config.yaml'),
          expect.anything()
        );
      });

      it('should warn when config is not a YAML object', () => {
        const configDir = path.join(tempDir, '.ratchet');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(path.join(configDir, 'config.yaml'), '"just a string"');

        const config = readProjectConfig(tempDir);

        expect(config).toBeNull();
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('not a valid YAML object')
        );
      });

      it('should handle empty config file', () => {
        const configDir = path.join(tempDir, '.ratchet');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(path.join(configDir, 'config.yaml'), '');

        const config = readProjectConfig(tempDir);

        expect(config).toBeNull();
      });
    });

    describe('context size limit enforcement', () => {
      it('should accept context under 50KB limit', () => {
        const configDir = path.join(tempDir, '.ratchet');
        fs.mkdirSync(configDir, { recursive: true });
        const smallContext = 'a'.repeat(1000); // 1KB
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: ratchet\ncontext: "${smallContext}"\n`
        );

        const config = readProjectConfig(tempDir);

        expect(config?.context).toBe(smallContext);
        expect(consoleWarnSpy).not.toHaveBeenCalledWith(
          expect.stringContaining('Context too large')
        );
      });

      it('should reject context over 50KB limit', () => {
        const configDir = path.join(tempDir, '.ratchet');
        fs.mkdirSync(configDir, { recursive: true });
        const largeContext = 'a'.repeat(51 * 1024); // 51KB
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: ratchet\ncontext: "${largeContext}"\n`
        );

        const config = readProjectConfig(tempDir);

        expect(config).toEqual({ schema: 'ratchet' });
        expect(config?.context).toBeUndefined();
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Context too large (51.0KB, limit: 50KB)')
        );
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Ignoring context field')
        );
      });

      it('should handle context exactly at 50KB limit', () => {
        const configDir = path.join(tempDir, '.ratchet');
        fs.mkdirSync(configDir, { recursive: true });
        const exactContext = 'a'.repeat(50 * 1024); // Exactly 50KB
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: ratchet\ncontext: "${exactContext}"\n`
        );

        const config = readProjectConfig(tempDir);

        expect(config?.context).toBe(exactContext);
        expect(consoleWarnSpy).not.toHaveBeenCalledWith(
          expect.stringContaining('Context too large')
        );
      });

      it('should handle multi-byte UTF-8 characters in size calculation', () => {
        const configDir = path.join(tempDir, '.ratchet');
        fs.mkdirSync(configDir, { recursive: true });
        // Unicode snowman is 3 bytes in UTF-8
        const contextWithUnicode = '☃'.repeat(18000); // ~54KB in UTF-8 (18000 * 3 bytes)
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: ratchet
context: |
  ${contextWithUnicode}
`
        );

        const config = readProjectConfig(tempDir);

        expect(config?.context).toBeUndefined();
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Context too large')
        );
      });
    });

    // Implements features/eval-contributor-gate/gate-selection.feature — the
    // `eval.gate` contributor record is parsed field-by-field via the resilient
    // `eval` branch: a valid map is kept, an invalid map is warned-and-dropped.
    describe('eval.gate contributor record', () => {
      it('keeps a valid eval.gate map of contributor id → boolean', () => {
        const configDir = path.join(tempDir, '.ratchet');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          'schema: ratchet\neval:\n  gate:\n    llm-judge: false\n    deterministic: true\n'
        );

        const config = readProjectConfig(tempDir);

        expect(config?.eval?.gate).toEqual({ 'llm-judge': false, deterministic: true });
        expect(consoleWarnSpy).not.toHaveBeenCalled();
      });

      it('warns and drops the eval section when a gate key is not a contributor id', () => {
        const configDir = path.join(tempDir, '.ratchet');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          'schema: ratchet\neval:\n  gate:\n    not-a-contributor: false\n'
        );

        const config = readProjectConfig(tempDir);

        expect(config?.eval).toBeUndefined();
        expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid 'eval' field"));
      });

      it('warns and drops the eval section when a gate value is not a boolean', () => {
        const configDir = path.join(tempDir, '.ratchet');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          'schema: ratchet\neval:\n  gate:\n    deterministic: maybe\n'
        );

        const config = readProjectConfig(tempDir);

        expect(config?.eval).toBeUndefined();
        expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid 'eval' field"));
      });
    });

    // Implements features/eval-judge/jury-quorum-resolution.feature — the
    // project-level `eval.jury` default is parsed field-by-field via the same
    // resilient `eval` branch as `eval.gate`: a valid jury map is kept, an
    // invalid one is warned-and-dropped.
    describe('eval.jury default', () => {
      it('keeps a valid eval.jury map of votes and quorum', () => {
        const configDir = path.join(tempDir, '.ratchet');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          'schema: ratchet\neval:\n  jury:\n    votes: 3\n    quorum: unanimous\n'
        );

        const config = readProjectConfig(tempDir);

        expect(config?.eval?.jury).toEqual({ votes: 3, quorum: 'unanimous' });
        expect(consoleWarnSpy).not.toHaveBeenCalled();
      });

      it('warns and drops the eval section when the quorum value is not majority|unanimous', () => {
        const configDir = path.join(tempDir, '.ratchet');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          'schema: ratchet\neval:\n  jury:\n    quorum: sometimes\n'
        );

        const config = readProjectConfig(tempDir);

        expect(config?.eval).toBeUndefined();
        expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid 'eval' field"));
      });
    });

    describe('.yml/.yaml precedence', () => {
      it('should prefer .yaml when both exist', () => {
        const configDir = path.join(tempDir, '.ratchet');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          'schema: ratchet\ncontext: from yaml\n'
        );
        fs.writeFileSync(
          path.join(configDir, 'config.yml'),
          'schema: custom-schema\ncontext: from yml\n'
        );

        const config = readProjectConfig(tempDir);

        expect(config?.schema).toBe('ratchet');
        expect(config?.context).toBe('from yaml');
      });

      it('should use .yml when .yaml does not exist', () => {
        const configDir = path.join(tempDir, '.ratchet');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yml'),
          'schema: custom-schema\ncontext: from yml\n'
        );

        const config = readProjectConfig(tempDir);

        expect(config?.schema).toBe('custom-schema');
        expect(config?.context).toBe('from yml');
      });

      it('should return null when neither .yaml nor .yml exist', () => {
        const configDir = path.join(tempDir, '.ratchet');
        fs.mkdirSync(configDir, { recursive: true });

        const config = readProjectConfig(tempDir);

        expect(config).toBeNull();
        expect(consoleWarnSpy).not.toHaveBeenCalled();
      });

      it('should return null when ratchet directory does not exist', () => {
        const config = readProjectConfig(tempDir);

        expect(config).toBeNull();
        expect(consoleWarnSpy).not.toHaveBeenCalled();
      });
    });

    // -------------------------------------------------------------------------
    // Per-key `batch:` section load (load-path-warning.feature): an invalid
    // batch key is warned naming the key path and offending value (NOT the
    // generic `check gate/strategy/proofOfWork values` text), and valid sibling
    // settings are preserved instead of being silently reverted to defaults.
    // Replaces the prior whole-section drop.
    // -------------------------------------------------------------------------
    describe('per-key batch load (resilient)', () => {
      function writeYaml(body: string): void {
        const configDir = path.join(tempDir, '.ratchet');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(path.join(configDir, 'config.yaml'), `schema: ratchet\n${body}`);
      }

      it('warns naming agent and "claude:" (not the generic text) and preserves valid siblings', () => {
        writeYaml('batch:\n  gate: after-propose\n  locus: docker\n  agent: "claude:"\n');

        const config = readProjectConfig(tempDir);

        // The warning names `agent` and the offending value.
        const warned = consoleWarnSpy.mock.calls
          .map((c) => String(c[0]))
          .filter((s) => s.includes('batch.agent'));
        expect(warned.some((s) => s.includes('claude:'))).toBe(true);
        // It does NOT use the generic gate/strategy/proofOfWork text.
        expect(warned.every((s) => !s.includes('gate/strategy/proofOfWork'))).toBe(true);

        // Valid siblings are preserved; only agent is dropped.
        expect(config?.batch?.gate).toBe('after-propose');
        expect(config?.batch?.locus).toBe('docker');
        expect(config?.batch?.agent).toBeUndefined();
      });

      it('warns naming agent.apply and the value for a malformed per-stage map entry', () => {
        writeYaml(
          'batch:\n  gate: after-propose\n  agent:\n    apply: "claude :m"\n'
        );

        const config = readProjectConfig(tempDir);

        const warned = consoleWarnSpy.mock.calls
          .map((c) => String(c[0]))
          .filter((s) => s.includes('batch.agent.apply'));
        expect(warned.some((s) => s.includes('claude :m'))).toBe(true);
        // The valid sibling survives; the malformed agent key is dropped.
        expect(config?.batch?.gate).toBe('after-propose');
      });

      it('warns naming gate and "bogus" beside a valid agent and preserves the agent', () => {
        writeYaml('batch:\n  gate: bogus\n  agent: claude:fable\n');

        const config = readProjectConfig(tempDir);

        const warned = consoleWarnSpy.mock.calls
          .map((c) => String(c[0]))
          .filter((s) => s.includes('batch.gate'));
        expect(warned.some((s) => s.includes('bogus'))).toBe(true);

        expect(config?.batch?.gate).toBeUndefined();
        expect(config?.batch?.agent).toBe('claude:fable');
      });

      it('loads a fully valid batch section warning-free and value-identical', () => {
        writeYaml(
          'batch:\n  gate: after-propose\n  locus: docker\n  agent: claude:fable\n'
        );

        const config = readProjectConfig(tempDir);

        expect(config?.batch).toEqual({
          gate: 'after-propose',
          locus: 'docker',
          agent: 'claude:fable',
        });
        expect(consoleWarnSpy).not.toHaveBeenCalledWith(
          expect.stringContaining('batch')
        );
      });

      it('never echoes the authToken value on failure (names the key only)', () => {
        writeYaml('batch:\n  authToken: 123\n');

        readProjectConfig(tempDir);

        const warned = consoleWarnSpy.mock.calls
          .map((c) => String(c[0]))
          .filter((s) => s.includes('batch.authToken'));
        expect(warned.length).toBeGreaterThan(0);
        // The value is never echoed.
        expect(warned.every((s) => !s.includes('123'))).toBe(true);
      });

      it('ignores prototype-chain key names without nuking the whole config', () => {
        // `constructor`/`toString` live on Object.prototype, so a naive
        // `key in shape` check would treat them as known keys and then call
        // `.safeParse` on the inherited value, throwing and reverting the
        // entire config to null. They must be ignored like any unknown key.
        writeYaml('batch:\n  constructor: nope\n  toString: nope\n  gate: after-propose\n');

        const config = readProjectConfig(tempDir);

        // Config still parses; the valid sibling survives and the
        // prototype-chain keys are silently ignored (partial schema).
        expect(config).not.toBeNull();
        expect(config?.batch?.gate).toBe('after-propose');
        // The prototype-chain names never become own keys of the parsed batch.
        expect(Object.hasOwn(config!.batch!, 'constructor')).toBe(false);
        expect(Object.hasOwn(config!.batch!, 'toString')).toBe(false);
      });
    });

    describe('multi-line and special characters', () => {
      it('should preserve multi-line context', () => {
        const configDir = path.join(tempDir, '.ratchet');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: ratchet
context: |
  Line 1: Tech stack
  Line 2: API conventions
  Line 3: Testing approach
`
        );

        const config = readProjectConfig(tempDir);

        expect(config?.context).toBe(
          'Line 1: Tech stack\nLine 2: API conventions\nLine 3: Testing approach\n'
        );
      });

      it('should preserve special YAML characters in context', () => {
        const configDir = path.join(tempDir, '.ratchet');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: ratchet
context: |
  Special chars: : @ # $ % & * [ ] { }
  Quotes: "double" 'single'
  Symbols: < > | \\ /
`
        );

        const config = readProjectConfig(tempDir);

        expect(config?.context).toContain('Special chars: : @ # $ % & * [ ] { }');
        expect(config?.context).toContain('"double"');
        expect(config?.context).toContain("'single'");
        expect(config?.context).toContain('Symbols: < > | \\ /');
      });

      it('should preserve special characters in rule strings', () => {
        const configDir = path.join(tempDir, '.ratchet');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: ratchet
rules:
  proposal:
    - "Use <template> tags in docs"
    - "Reference @mentions and #channels"
    - "Follow {variable} naming"
`
        );

        const config = readProjectConfig(tempDir);

        expect(config?.rules?.proposal).toEqual([
          'Use <template> tags in docs',
          'Reference @mentions and #channels',
          'Follow {variable} naming',
        ]);
      });
    });
  });

  describe('validateConfigRules', () => {
    it('should return no warnings for valid artifact IDs', () => {
      const rules = {
        proposal: ['Rule 1'],
        specs: ['Rule 2'],
        design: ['Rule 3'],
      };
      const validIds = new Set(['proposal', 'specs', 'design', 'tasks']);

      const warnings = validateConfigRules(rules, validIds, 'ratchet');

      expect(warnings).toEqual([]);
    });

    it('should warn about unknown artifact IDs', () => {
      const rules = {
        proposal: ['Rule 1'],
        testplan: ['Rule 2'], // Invalid
        documentation: ['Rule 3'], // Invalid
      };
      const validIds = new Set(['proposal', 'specs', 'design', 'tasks']);

      const warnings = validateConfigRules(rules, validIds, 'ratchet');

      expect(warnings).toHaveLength(2);
      expect(warnings[0]).toContain('Unknown artifact ID in rules: "testplan"');
      expect(warnings[0]).toContain('Valid IDs for schema "ratchet": design, proposal, specs, tasks');
      expect(warnings[1]).toContain('Unknown artifact ID in rules: "documentation"');
    });

    it('should return warnings for all unknown artifact IDs', () => {
      const rules = {
        invalid1: ['Rule 1'],
        invalid2: ['Rule 2'],
        invalid3: ['Rule 3'],
      };
      const validIds = new Set(['proposal', 'specs']);

      const warnings = validateConfigRules(rules, validIds, 'ratchet');

      expect(warnings).toHaveLength(3);
    });

    it('should handle empty rules object', () => {
      const rules = {};
      const validIds = new Set(['proposal', 'specs']);

      const warnings = validateConfigRules(rules, validIds, 'ratchet');

      expect(warnings).toEqual([]);
    });
  });

  describe('suggestSchemas', () => {
    const availableSchemas = [
      { name: 'ratchet', isBuiltIn: true },
      { name: 'custom-workflow', isBuiltIn: false },
      { name: 'team-process', isBuiltIn: false },
    ];

    it('should suggest close matches using fuzzy matching', () => {
      const message = suggestSchemas('ratcht', availableSchemas); // Missing 'e'

      expect(message).toContain("Schema 'ratcht' not found");
      expect(message).toContain('Did you mean one of these?');
      expect(message).toContain('ratchet (built-in)');
    });

    it('should suggest custom-workflow for workflow typo', () => {
      const message = suggestSchemas('custom-workflo', availableSchemas);

      expect(message).toContain('Did you mean one of these?');
      expect(message).toContain('custom-workflow');
    });

    it('should list all available schemas', () => {
      const message = suggestSchemas('nonexistent', availableSchemas);

      expect(message).toContain('Available schemas:');
      expect(message).toContain('Built-in: ratchet');
      expect(message).toContain('Project-local: custom-workflow, team-process');
    });

    it('should handle case when no project-local schemas exist', () => {
      const builtInOnly = [
        { name: 'ratchet', isBuiltIn: true },
      ];
      const message = suggestSchemas('invalid', builtInOnly);

      expect(message).toContain('Built-in: ratchet');
      expect(message).toContain('Project-local: (none found)');
    });

    it('should include fix instruction', () => {
      const message = suggestSchemas('wrong-schema', availableSchemas);

      expect(message).toContain(
        "Fix: Edit .ratchet/config.yaml and change 'schema: wrong-schema' to a valid schema name"
      );
    });

    it('should limit suggestions to top 3 matches', () => {
      const manySchemas = [
        { name: 'test-a', isBuiltIn: true },
        { name: 'test-b', isBuiltIn: true },
        { name: 'test-c', isBuiltIn: true },
        { name: 'test-d', isBuiltIn: true },
        { name: 'test-e', isBuiltIn: true },
      ];
      const message = suggestSchemas('test', manySchemas);

      // Should suggest at most 3
      const suggestionCount = (message.match(/test-/g) || []).length;
      expect(suggestionCount).toBeGreaterThanOrEqual(3);
      expect(suggestionCount).toBeLessThanOrEqual(3 + 5); // 3 in suggestions + 5 in "Available" list
    });

    it('should not suggest schemas with distance > 3', () => {
      const message = suggestSchemas('abcdefghijk', availableSchemas);

      // 'abcdefghijk' has large Levenshtein distance from all schemas
      expect(message).not.toContain('Did you mean');
      expect(message).toContain('Available schemas:');
    });
  });
});
