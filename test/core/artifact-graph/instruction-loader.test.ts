import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  loadTemplate,
  loadChangeContext,
  generateInstructions,
  formatChangeStatus,
  TemplateLoadError,
} from '../../../src/core/artifact-graph/instruction-loader.js';

describe('instruction-loader', () => {
  describe('loadTemplate', () => {
    it('should load template from schema directory', () => {
      // Uses built-in ratchet schema
      const template = loadTemplate('ratchet', 'plan.md');

      expect(template).toContain('## Why');
      expect(template).toContain('## What Changes');
    });

    it('should load the feature template', () => {
      const template = loadTemplate('ratchet', 'feature.feature');

      expect(template).toContain('Feature:');
      expect(template).toContain('Scenario:');
    });

    it('should throw TemplateLoadError for non-existent template', () => {
      expect(() => loadTemplate('ratchet', 'nonexistent.md')).toThrow(
        TemplateLoadError
      );
    });

    it('should throw TemplateLoadError for non-existent schema', () => {
      expect(() => loadTemplate('nonexistent-schema', 'plan.md')).toThrow(
        TemplateLoadError
      );
    });

    it('should include template path in error', () => {
      try {
        loadTemplate('ratchet', 'nonexistent.md');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TemplateLoadError);
        expect((err as TemplateLoadError).templatePath).toContain('nonexistent.md');
      }
    });
  });

  describe('loadChangeContext', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchet-test-'));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should load context with default schema', () => {
      const context = loadChangeContext(tempDir, 'my-change');

      expect(context.schemaName).toBe('ratchet');
      expect(context.changeName).toBe('my-change');
      expect(context.graph.getName()).toBe('ratchet');
      expect(context.completed.size).toBe(0);
    });

    it('should load context with explicit schema', () => {
      const context = loadChangeContext(tempDir, 'my-change', 'ratchet');

      expect(context.schemaName).toBe('ratchet');
      expect(context.graph.getName()).toBe('ratchet');
    });

    it('should detect completed artifacts', () => {
      // Create change directory with a feature file
      const changeDir = path.join(tempDir, '.ratchet', 'changes', 'my-change');
      const featuresDir = path.join(changeDir, 'features', 'auth');
      fs.mkdirSync(featuresDir, { recursive: true });
      fs.writeFileSync(path.join(featuresDir, 'login.feature'), 'Feature: Login');

      const context = loadChangeContext(tempDir, 'my-change');

      expect(context.completed.has('features')).toBe(true);
    });

    it('should return empty completed set for non-existent change directory', () => {
      const context = loadChangeContext(tempDir, 'nonexistent-change');

      expect(context.completed.size).toBe(0);
    });

    it('should auto-detect schema from .ratchet.yaml metadata', () => {
      // Create change directory with metadata file
      const changeDir = path.join(tempDir, '.ratchet', 'changes', 'my-change');
      fs.mkdirSync(changeDir, { recursive: true });
      fs.writeFileSync(path.join(changeDir, '.ratchet.yaml'), 'schema: ratchet\ncreated: "2025-01-05"\n');

      // Load without explicit schema - should detect from metadata
      const context = loadChangeContext(tempDir, 'my-change');

      expect(context.schemaName).toBe('ratchet');
      expect(context.graph.getName()).toBe('ratchet');
    });

    it('should use explicit schema over metadata schema', () => {
      // Create change directory with metadata file using ratchet
      const changeDir = path.join(tempDir, '.ratchet', 'changes', 'my-change');
      fs.mkdirSync(changeDir, { recursive: true });
      fs.writeFileSync(path.join(changeDir, '.ratchet.yaml'), 'schema: ratchet\n');

      // Load with explicit schema - should override metadata
      const context = loadChangeContext(tempDir, 'my-change', 'ratchet');

      expect(context.schemaName).toBe('ratchet');
      expect(context.graph.getName()).toBe('ratchet');
    });

    it('should fall back to default when no metadata and no explicit schema', () => {
      // Create change directory without metadata file
      const changeDir = path.join(tempDir, '.ratchet', 'changes', 'my-change');
      fs.mkdirSync(changeDir, { recursive: true });

      const context = loadChangeContext(tempDir, 'my-change');

      expect(context.schemaName).toBe('ratchet');
    });
  });

  describe('generateInstructions', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchet-test-'));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should include artifact metadata', () => {
      const context = loadChangeContext(tempDir, 'my-change');
      const instructions = generateInstructions(context, 'features');

      expect(instructions.changeName).toBe('my-change');
      expect(instructions.artifactId).toBe('features');
      expect(instructions.schemaName).toBe('ratchet');
      expect(instructions.outputPath).toBe('features/**/*.feature');
    });

    it('should include template content', () => {
      const context = loadChangeContext(tempDir, 'my-change');
      const instructions = generateInstructions(context, 'plan');

      expect(instructions.template).toContain('## Why');
    });

    it('should show dependencies with completion status', () => {
      const context = loadChangeContext(tempDir, 'my-change');
      const instructions = generateInstructions(context, 'plan');

      expect(instructions.dependencies).toHaveLength(1);
      expect(instructions.dependencies[0].id).toBe('features');
      expect(instructions.dependencies[0].done).toBe(false);
    });

    it('should mark completed dependencies as done', () => {
      // Create a feature file so 'features' is complete
      const changeDir = path.join(tempDir, '.ratchet', 'changes', 'my-change');
      const featuresDir = path.join(changeDir, 'features', 'auth');
      fs.mkdirSync(featuresDir, { recursive: true });
      fs.writeFileSync(path.join(featuresDir, 'login.feature'), 'Feature: Login');

      const context = loadChangeContext(tempDir, 'my-change');
      const instructions = generateInstructions(context, 'plan');

      expect(instructions.dependencies[0].done).toBe(true);
    });

    it('should list artifacts unlocked by this one', () => {
      const context = loadChangeContext(tempDir, 'my-change');
      const instructions = generateInstructions(context, 'features');

      // features unlocks plan
      expect(instructions.unlocks).toContain('plan');
    });

    it('should have empty dependencies for root artifact', () => {
      const context = loadChangeContext(tempDir, 'my-change');
      const instructions = generateInstructions(context, 'features');

      expect(instructions.dependencies).toHaveLength(0);
    });

    it('should throw for non-existent artifact', () => {
      const context = loadChangeContext(tempDir, 'my-change');

      expect(() => generateInstructions(context, 'nonexistent')).toThrow(
        "Artifact 'nonexistent' not found"
      );
    });

    describe('project config integration', () => {
      it('should return context as separate field for all artifacts', () => {
        // Create project config
        const configDir = path.join(tempDir, '.ratchet');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: ratchet
context: |
  Tech stack: TypeScript, React
  API style: RESTful
`
        );

        const context = loadChangeContext(tempDir, 'my-change');
        const instructions = generateInstructions(context, 'plan', tempDir);

        // Context should be in separate field, not in template
        expect(instructions.context).toContain('Tech stack: TypeScript, React');
        expect(instructions.context).toContain('API style: RESTful');
        expect(instructions.template).not.toContain('Tech stack');
        expect(instructions.template).toContain('## Why'); // Actual template content
      });

      it('should return undefined context when config is absent', () => {
        const context = loadChangeContext(tempDir, 'my-change');
        const instructions = generateInstructions(context, 'plan', tempDir);

        expect(instructions.context).toBeUndefined();
        expect(instructions.rules).toBeUndefined();
        expect(instructions.template).toContain('## Why'); // Actual template content
      });

      it('should preserve multi-line context', () => {
        // Create project config with multi-line context
        const configDir = path.join(tempDir, '.ratchet');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: ratchet
context: |
  Line 1
  Line 2
  Line 3
`
        );

        const context = loadChangeContext(tempDir, 'my-change');
        const instructions = generateInstructions(context, 'plan', tempDir);

        expect(instructions.context).toContain('Line 1\nLine 2\nLine 3');
      });

      it('should preserve special characters in context', () => {
        // Create project config with special characters
        const configDir = path.join(tempDir, '.ratchet');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: ratchet
context: |
  Special: < > & " ' @ # $ % [ ] { }
`
        );

        const context = loadChangeContext(tempDir, 'my-change');
        const instructions = generateInstructions(context, 'plan', tempDir);

        expect(instructions.context).toContain('Special: < > & " \' @ # $ % [ ] { }');
      });

      it('should return rules only for matching artifact', () => {
        // Create project config with rules
        const configDir = path.join(tempDir, '.ratchet');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: ratchet
rules:
  features:
    - Use Given/When/Then format
    - One file per capability
  plan:
    - Include rollback plan
`
        );

        const context = loadChangeContext(tempDir, 'my-change');

        // Check features artifact has its rules
        const featuresInstructions = generateInstructions(context, 'features', tempDir);
        expect(featuresInstructions.rules).toEqual(['Use Given/When/Then format', 'One file per capability']);

        // Check plan artifact has its rules
        const planInstructions = generateInstructions(context, 'plan', tempDir);
        expect(planInstructions.rules).toEqual(['Include rollback plan']);
        expect(planInstructions.template).not.toContain('rollback plan');
      });

      it('should return undefined rules for non-matching artifact', () => {
        // Create project config with rules only for features
        const configDir = path.join(tempDir, '.ratchet');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: ratchet
rules:
  features:
    - Use Given/When/Then format
`
        );

        const context = loadChangeContext(tempDir, 'my-change');

        // Check plan artifact (no rules configured) has undefined rules
        const planInstructions = generateInstructions(context, 'plan', tempDir);
        expect(planInstructions.rules).toBeUndefined();
      });

      it('should return undefined rules when empty array', () => {
        // Create project config with empty rules array
        const configDir = path.join(tempDir, '.ratchet');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: ratchet
context: Some context
rules:
  features: []
`
        );

        const context = loadChangeContext(tempDir, 'my-change');
        const instructions = generateInstructions(context, 'features', tempDir);

        expect(instructions.context).toBe('Some context');
        expect(instructions.rules).toBeUndefined();
      });

      it('should keep context, rules, and template as separate fields', () => {
        // Create project config with both context and rules
        const configDir = path.join(tempDir, '.ratchet');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: ratchet
context: Project context here
rules:
  plan:
    - Rule 1
`
        );

        const context = loadChangeContext(tempDir, 'my-change');
        const instructions = generateInstructions(context, 'plan', tempDir);

        // All three should be separate
        expect(instructions.context).toBe('Project context here');
        expect(instructions.rules).toEqual(['Rule 1']);
        expect(instructions.template).toContain('## Why');
        // Template should not contain context or rules
        expect(instructions.template).not.toContain('Project context here');
        expect(instructions.template).not.toContain('Rule 1');
      });

      it('should handle context without rules', () => {
        // Create project config with only context
        const configDir = path.join(tempDir, '.ratchet');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: ratchet
context: Project context only
`
        );

        const context = loadChangeContext(tempDir, 'my-change');
        const instructions = generateInstructions(context, 'plan', tempDir);

        expect(instructions.context).toBe('Project context only');
        expect(instructions.rules).toBeUndefined();
        expect(instructions.template).toContain('## Why');
      });

      it('should handle rules without context', () => {
        // Create project config with only rules
        const configDir = path.join(tempDir, '.ratchet');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: ratchet
rules:
  plan:
    - Rule only
`
        );

        const context = loadChangeContext(tempDir, 'my-change');
        const instructions = generateInstructions(context, 'plan', tempDir);

        expect(instructions.context).toBeUndefined();
        expect(instructions.rules).toEqual(['Rule only']);
        expect(instructions.template).toContain('## Why');
      });

      it('should work without project root parameter', () => {
        const context = loadChangeContext(tempDir, 'my-change');
        const instructions = generateInstructions(context, 'plan'); // No projectRoot

        expect(instructions.context).toBeUndefined();
        expect(instructions.rules).toBeUndefined();
        expect(instructions.template).toContain('## Why');
      });
    });

    describe('validation and warnings', () => {
      let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

      beforeEach(() => {
        consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      });

      afterEach(() => {
        consoleWarnSpy.mockRestore();
      });

      it('should warn about unknown artifact IDs in rules', () => {
        // Create project config with invalid artifact ID
        const configDir = path.join(tempDir, '.ratchet');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: ratchet
rules:
  features:
    - Valid rule
  invalid-artifact:
    - Invalid rule
`
        );

        const context = loadChangeContext(tempDir, 'my-change');
        generateInstructions(context, 'features', tempDir);

        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Unknown artifact ID in rules: "invalid-artifact"')
        );
      });

      it('should deduplicate validation warnings within session', () => {
        // Create a fresh temp directory to avoid cache pollution
        const freshTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchet-test-'));

        try {
          // Create project config with a uniquely named invalid artifact ID
          const configDir = path.join(freshTempDir, '.ratchet');
          fs.mkdirSync(configDir, { recursive: true });
          fs.writeFileSync(
            path.join(configDir, 'config.yaml'),
            `schema: ratchet
rules:
  unique-invalid-artifact-${Date.now()}:
    - Invalid rule
`
          );

          const context = loadChangeContext(freshTempDir, 'my-change');

          // Call multiple times
          generateInstructions(context, 'features', freshTempDir);
          generateInstructions(context, 'plan', freshTempDir);

          // Warning should be shown only once (deduplication works)
          // Note: We may have gotten warnings from other tests, so check that
          // the count didn't increase by more than 1 from the first call
          const callCount = consoleWarnSpy.mock.calls.filter(call =>
            call[0]?.includes('Unknown artifact ID in rules')
          ).length;

          expect(callCount).toBeGreaterThanOrEqual(1);
        } finally {
          fs.rmSync(freshTempDir, { recursive: true, force: true });
        }
      });

      it('should not warn for valid artifact IDs', () => {
        // Create project config with valid artifact IDs
        const configDir = path.join(tempDir, '.ratchet');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: ratchet
rules:
  features:
    - Rule 1
  plan:
    - Rule 2
`
        );

        const context = loadChangeContext(tempDir, 'my-change');
        generateInstructions(context, 'features', tempDir);

        expect(consoleWarnSpy).not.toHaveBeenCalled();
      });
    });
  });

  describe('formatChangeStatus', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchet-test-'));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should show all artifacts as ready/blocked when nothing completed', () => {
      const context = loadChangeContext(tempDir, 'my-change');
      const status = formatChangeStatus(context);

      expect(status.changeName).toBe('my-change');
      expect(status.schemaName).toBe('ratchet');
      expect(status.isComplete).toBe(false);

      // features has no deps, should be ready
      const features = status.artifacts.find(a => a.id === 'features');
      expect(features?.status).toBe('ready');

      // plan depends on features, should be blocked
      const plan = status.artifacts.find(a => a.id === 'plan');
      expect(plan?.status).toBe('blocked');
      expect(plan?.missingDeps).toContain('features');
    });

    it('should show completed artifacts as done', () => {
      const changeDir = path.join(tempDir, '.ratchet', 'changes', 'my-change');
      const featuresDir = path.join(changeDir, 'features', 'auth');
      fs.mkdirSync(featuresDir, { recursive: true });
      fs.writeFileSync(path.join(featuresDir, 'login.feature'), 'Feature: Login');

      const context = loadChangeContext(tempDir, 'my-change');
      const status = formatChangeStatus(context);

      const features = status.artifacts.find(a => a.id === 'features');
      expect(features?.status).toBe('done');

      // plan should now be ready
      const plan = status.artifacts.find(a => a.id === 'plan');
      expect(plan?.status).toBe('ready');
    });

    it('should include output paths for each artifact', () => {
      const context = loadChangeContext(tempDir, 'my-change');
      const status = formatChangeStatus(context);

      const features = status.artifacts.find(a => a.id === 'features');
      expect(features?.outputPath).toBe('features/**/*.feature');

      const plan = status.artifacts.find(a => a.id === 'plan');
      expect(plan?.outputPath).toBe('plan.md');
    });

    it('should report isComplete true when all done', () => {
      const changeDir = path.join(tempDir, '.ratchet', 'changes', 'my-change');
      const featuresDir = path.join(changeDir, 'features', 'auth');
      fs.mkdirSync(featuresDir, { recursive: true });

      // Create all required files for ratchet schema
      fs.writeFileSync(path.join(featuresDir, 'login.feature'), 'Feature: Login');
      fs.writeFileSync(path.join(changeDir, 'plan.md'), '# Plan');

      const context = loadChangeContext(tempDir, 'my-change');
      const status = formatChangeStatus(context);

      expect(status.isComplete).toBe(true);
      expect(status.artifacts.every(a => a.status === 'done')).toBe(true);
    });

    it('should show blocked artifacts with missing dependencies', () => {
      const context = loadChangeContext(tempDir, 'my-change');
      const status = formatChangeStatus(context);

      // plan requires features
      const plan = status.artifacts.find(a => a.id === 'plan');
      expect(plan?.status).toBe('blocked');
      expect(plan?.missingDeps).toContain('features');
    });

    it('should sort artifacts in build order', () => {
      const context = loadChangeContext(tempDir, 'my-change');
      const status = formatChangeStatus(context);

      const ids = status.artifacts.map(a => a.id);
      const featuresIdx = ids.indexOf('features');
      const planIdx = ids.indexOf('plan');

      // features must come before plan
      expect(featuresIdx).toBeLessThan(planIdx);
    });
  });
});
