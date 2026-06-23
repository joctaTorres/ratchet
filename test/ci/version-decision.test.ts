import { describe, it, expect } from 'vitest';
import {
  decidePublishVersion,
  PUBLISH,
  SKIP,
} from '../../src/core/ci/version-decision.js';

/**
 * The version-decision module is the pure idempotency spine: given the local
 * version and the set already on the registry, it decides PUBLISH (new) vs SKIP
 * (already published). These tests pin that classification exhaustively — no
 * I/O, no registry — so the idempotency guarantee is proven in one place. The
 * runner that gathers the inputs is exercised separately in version-guard.test.ts.
 */

describe('decidePublishVersion', () => {
  it('PUBLISHes a version absent from a populated set, with no reasons', () => {
    const decision = decidePublishVersion({
      version: '1.2.0',
      publishedVersions: ['1.0.0', '1.1.0'],
    });

    expect(decision.shouldPublish).toBe(true);
    expect(decision.outcome).toBe(PUBLISH);
    expect(decision.reasons).toEqual([]);
  });

  it('PUBLISHes against an empty published set (nothing has shipped yet)', () => {
    const decision = decidePublishVersion({
      version: '0.1.0',
      publishedVersions: [],
    });

    expect(decision.shouldPublish).toBe(true);
    expect(decision.outcome).toBe(PUBLISH);
    expect(decision.reasons).toEqual([]);
  });

  it('SKIPs a version already published (the only entry), with an explanatory reason', () => {
    const decision = decidePublishVersion({
      version: '0.1.0',
      publishedVersions: ['0.1.0'],
    });

    expect(decision.shouldPublish).toBe(false);
    expect(decision.outcome).toBe(SKIP);
    expect(decision.reasons).toHaveLength(1);
    expect(decision.reasons[0]).toContain('0.1.0');
    expect(decision.reasons[0]).toContain('already published');
  });

  it('SKIPs a version present among several already-published versions', () => {
    const decision = decidePublishVersion({
      version: '1.1.0',
      publishedVersions: ['1.0.0', '1.1.0', '1.2.0'],
    });

    expect(decision.shouldPublish).toBe(false);
    expect(decision.outcome).toBe(SKIP);
    expect(decision.reasons[0]).toContain('1.1.0');
  });
});
