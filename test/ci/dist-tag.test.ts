import { describe, it, expect } from 'vitest';
import { resolveDistTag, LATEST } from '../../src/core/ci/dist-tag.js';

/**
 * The dist-tag resolver is a pure mapping from a semver string to the npm
 * dist-tag it should publish under. The load-bearing guarantee is that a
 * prerelease must NEVER resolve to `latest` (else a plain `npm install` would
 * hand every user a beta); it resolves to its leading prerelease identifier
 * instead, and only stable versions map to `latest`. These tests pin that
 * mapping across the beta/rc channels, stable releases, and edge cases — no I/O.
 */
describe('resolveDistTag', () => {
  describe('prerelease versions resolve to their leading identifier (never "latest")', () => {
    it('maps a beta prerelease to "beta" (0.1.0-beta.0 -> beta)', () => {
      expect(resolveDistTag('0.1.0-beta.0')).toBe('beta');
    });

    it('maps an rc prerelease to "rc" (1.2.3-rc.2 -> rc)', () => {
      expect(resolveDistTag('1.2.3-rc.2')).toBe('rc');
    });

    it('maps an alpha prerelease with no counter to "alpha" (2.0.0-alpha -> alpha)', () => {
      expect(resolveDistTag('2.0.0-alpha')).toBe('alpha');
    });

    it('drops the numeric counter, keeping only the leading identifier', () => {
      expect(resolveDistTag('3.4.5-next.10')).toBe('next');
    });

    it('never resolves a prerelease to "latest"', () => {
      expect(resolveDistTag('0.1.0-beta.0')).not.toBe(LATEST);
      expect(resolveDistTag('1.0.0-rc.1')).not.toBe(LATEST);
    });
  });

  describe('stable versions resolve to "latest"', () => {
    it('maps a plain stable version to "latest" (1.2.3 -> latest)', () => {
      expect(resolveDistTag('1.2.3')).toBe(LATEST);
    });

    it('maps a zero-major stable version to "latest" (0.1.0 -> latest)', () => {
      expect(resolveDistTag('0.1.0')).toBe(LATEST);
    });

    it('treats build metadata alone (no prerelease) as stable -> "latest"', () => {
      expect(resolveDistTag('1.2.3+build.7')).toBe(LATEST);
    });
  });

  describe('edge cases fall back to "latest" rather than an empty tag', () => {
    it('ignores build metadata after a prerelease (keeps the prerelease channel)', () => {
      expect(resolveDistTag('1.2.3-beta.1+build.9')).toBe('beta');
    });

    it('falls back to "latest" for a trailing-dash version with an empty prerelease', () => {
      expect(resolveDistTag('1.2.3-')).toBe(LATEST);
    });

    it('tolerates surrounding whitespace', () => {
      expect(resolveDistTag('  0.1.0-beta.0  ')).toBe('beta');
    });
  });
});
