import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { resolveSchema } from '../../../src/core/artifact-graph/resolver.js';
import { ArtifactGraph } from '../../../src/core/artifact-graph/graph.js';
import { detectCompleted } from '../../../src/core/artifact-graph/state.js';
import type { BlockedArtifacts } from '../../../src/core/artifact-graph/types.js';

/**
 * Normalize BlockedArtifacts for comparison by sorting dependency arrays.
 * The order of unmet dependencies is not guaranteed, so we sort for stable assertions.
 */
function normalizeBlocked(blocked: BlockedArtifacts): BlockedArtifacts {
  const normalized: BlockedArtifacts = {};
  for (const [key, deps] of Object.entries(blocked)) {
    normalized[key] = [...deps].sort();
  }
  return normalized;
}

describe('artifact-graph workflow integration', () => {
  let tempDir: string;

  beforeEach(() => {
    // Use a unique temp directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchet-workflow-test-'));
  });

  afterEach(() => {
    // Clean up temp directory after each test
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('ratchet workflow', () => {
    it('should progress through complete workflow', () => {
      // 1. Resolve the real built-in schema
      const schema = resolveSchema('ratchet');
      const graph = ArtifactGraph.fromSchema(schema);

      // Verify schema structure (2 artifacts: features -> plan)
      expect(graph.getName()).toBe('ratchet');
      expect(graph.getAllArtifacts()).toHaveLength(2);

      // 2. Initial state - nothing complete, only features is ready
      let completed = detectCompleted(graph, tempDir);
      expect(completed.size).toBe(0);
      expect(graph.getNextArtifacts(completed)).toEqual(['features']);
      expect(graph.isComplete(completed)).toBe(false);
      expect(normalizeBlocked(graph.getBlocked(completed))).toEqual({
        plan: ['features'],
      });

      // 3. Create a feature file - now plan becomes ready
      const featuresDir = path.join(tempDir, 'features', 'auth');
      fs.mkdirSync(featuresDir, { recursive: true });
      fs.writeFileSync(path.join(featuresDir, 'login.feature'), 'Feature: Login');
      completed = detectCompleted(graph, tempDir);
      expect(completed).toEqual(new Set(['features']));
      expect(graph.getNextArtifacts(completed)).toEqual(['plan']);
      expect(graph.getBlocked(completed)).toEqual({});

      // 4. Create plan.md - workflow complete
      fs.writeFileSync(path.join(tempDir, 'plan.md'), '# Plan\n\n- [ ] 1.1 Implement feature');
      completed = detectCompleted(graph, tempDir);
      expect(completed).toEqual(new Set(['features', 'plan']));
      expect(graph.getNextArtifacts(completed)).toEqual([]);
      expect(graph.isComplete(completed)).toBe(true);
      expect(graph.getBlocked(completed)).toEqual({});
    });

    it('should handle out-of-order file creation', () => {
      const schema = resolveSchema('ratchet');
      const graph = ArtifactGraph.fromSchema(schema);

      // Create files in wrong order - plan before features
      fs.writeFileSync(path.join(tempDir, 'plan.md'), '# Plan');

      let completed = detectCompleted(graph, tempDir);
      // plan file exists so it's marked complete (filesystem-based)
      expect(completed).toEqual(new Set(['plan']));
      // features is still the only "ready" artifact since it has no deps
      expect(graph.getNextArtifacts(completed)).toEqual(['features']);

      // Now create a feature file
      const featuresDir = path.join(tempDir, 'features', 'auth');
      fs.mkdirSync(featuresDir, { recursive: true });
      fs.writeFileSync(path.join(featuresDir, 'login.feature'), 'Feature: Login');
      completed = detectCompleted(graph, tempDir);
      expect(completed).toEqual(new Set(['features', 'plan']));
      // everything done
      expect(graph.getNextArtifacts(completed)).toEqual([]);
    });

    it('should handle multiple feature files in glob pattern', () => {
      const schema = resolveSchema('ratchet');
      const graph = ArtifactGraph.fromSchema(schema);

      // Create features directory with multiple files across capabilities
      const featuresDir = path.join(tempDir, 'features');
      fs.mkdirSync(path.join(featuresDir, 'auth'), { recursive: true });
      fs.mkdirSync(path.join(featuresDir, 'api'), { recursive: true });
      fs.writeFileSync(path.join(featuresDir, 'auth', 'login.feature'), 'Feature: Login');
      fs.writeFileSync(path.join(featuresDir, 'api', 'list.feature'), 'Feature: List');
      fs.writeFileSync(path.join(featuresDir, 'api', 'create.feature'), 'Feature: Create');

      const completed = detectCompleted(graph, tempDir);
      expect(completed.has('features')).toBe(true);
    });
  });

  describe('build order consistency', () => {
    it('should return consistent build order across multiple calls', () => {
      const schema = resolveSchema('ratchet');
      const graph = ArtifactGraph.fromSchema(schema);

      const order1 = graph.getBuildOrder();
      const order2 = graph.getBuildOrder();
      const order3 = graph.getBuildOrder();

      expect(order1).toEqual(order2);
      expect(order2).toEqual(order3);
    });
  });

  describe('empty and edge cases', () => {
    it('should handle empty change directory gracefully', () => {
      const schema = resolveSchema('ratchet');
      const graph = ArtifactGraph.fromSchema(schema);

      // Directory exists but is empty
      const completed = detectCompleted(graph, tempDir);
      expect(completed.size).toBe(0);
      expect(graph.getNextArtifacts(completed)).toEqual(['features']);
    });

    it('should handle non-existent change directory', () => {
      const schema = resolveSchema('ratchet');
      const graph = ArtifactGraph.fromSchema(schema);

      const nonExistentDir = path.join(tempDir, 'does-not-exist');
      const completed = detectCompleted(graph, nonExistentDir);
      expect(completed.size).toBe(0);
    });

    it('should not count non-matching files in glob directories', () => {
      const schema = resolveSchema('ratchet');
      const graph = ArtifactGraph.fromSchema(schema);

      // Create features directory with wrong file types
      const featuresDir = path.join(tempDir, 'features');
      fs.mkdirSync(featuresDir, { recursive: true });
      fs.writeFileSync(path.join(featuresDir, 'notes.txt'), 'not a feature file');
      fs.writeFileSync(path.join(featuresDir, 'data.json'), '{}');

      const completed = detectCompleted(graph, tempDir);
      expect(completed.has('features')).toBe(false);
    });
  });
});
