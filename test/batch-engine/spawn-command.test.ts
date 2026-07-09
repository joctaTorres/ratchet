import { describe, it, expect } from 'vitest';
import { shquote, buildEnvExports } from '../../src/core/batch/engine/runtime/spawn-command.js';

/**
 * Unit tests for the shared env-serialization helper used by BOTH rex runtimes.
 *
 * Implements `features/rex-env-threading/env-serialization-safety.feature`.
 * No filesystem, no spawn — pure serialization assertions over in-memory inputs
 * (the testing standard's unit layer). Shell-execution proof that a built command
 * actually observes the value lives in the runtime tests (`rex-sidecar-runtime`
 * and `rex-remote-runtime`), which run the built command through `sh -c`.
 */

describe('shquote', () => {
  it('single-quotes a plain token', () => {
    expect(shquote('plain')).toBe("'plain'");
  });

  it('escapes embedded single quotes with the canonical close/escape/reopen idiom', () => {
    // `it's` → 'it'\''s' : close quote, escaped quote (\''), reopen quote.
    expect(shquote("it's")).toBe("'it'\\''s'");
  });

  it('wraps an empty string in a single-quote pair (preserves emptiness)', () => {
    expect(shquote('')).toBe("''");
  });
});

describe('buildEnvExports', () => {
  it('emits an export statement per valid-identifier entry, in insertion order', () => {
    const out = buildEnvExports({ RATCHET_STEP_VAR: 'from-engine', FOO: 'bar' });
    expect(out).toBe("export RATCHET_STEP_VAR='from-engine'; export FOO='bar'; ");
  });

  it('yields an empty prefix for an empty env', () => {
    expect(buildEnvExports({})).toBe('');
  });

  it('yields an empty prefix for an absent env (undefined)', () => {
    expect(buildEnvExports(undefined)).toBe('');
  });

  it('skips entries whose value is undefined', () => {
    const out = buildEnvExports({ KEEP: 'yes', DROP: undefined });
    expect(out).toBe("export KEEP='yes'; ");
  });

  it('skips entries whose name is not a valid shell identifier', () => {
    // Invalid names are unreachable in shell and would break `export`.
    const out = buildEnvExports({
      VALID_VAR: 'kept',
      '1leading-digit': 'dropped',
      'has-dash': 'dropped',
      'has space': 'dropped',
      'has.dot': 'dropped',
      'has$dollar': 'dropped',
    });
    expect(out).toBe("export VALID_VAR='kept'; ");
  });

  it('keeps entries whose name starts with an underscore or letter', () => {
    const out = buildEnvExports({ _UNDER: 'u', A: 'a', Z9: 'z' });
    expect(out).toBe("export _UNDER='u'; export A='a'; export Z9='z'; ");
  });

  it('quotes a value with a single quote using shquote (no injection)', () => {
    const val = "it's a 'test'";
    const out = buildEnvExports({ Q: val });
    // The serialized form is exactly one export statement quoting the whole value.
    expect(out).toBe(`export Q=${shquote(val)}; `);
    // And it is inert: there is no trailing command after the export that the
    // embedded quote could splice into (the value is fully wrapped in single quotes).
    expect(out).toMatch(/^export Q='.*'; $/);
    expect(out.endsWith("'; ")).toBe(true);
  });

  it('quotes a value containing $ so the serialized form cannot be expanded', () => {
    const val = '$HOME/${UNSET:-x} $(id)';
    const out = buildEnvExports({ DOLLAR: val });
    // Single-quoted: the $ never reaches the shell, so it is a literal.
    expect(out).toBe(`export DOLLAR='${val}'; `);
  });

  it('quotes a value with spaces, newlines, and semicolons as one inert token', () => {
    const val = 'a b\nc; rm -rf /; & | > <';
    const out = buildEnvExports({ METACHAR: val });
    // A newline inside single quotes is preserved byte-for-byte (no command split).
    expect(out).toBe(`export METACHAR=${shquote(val)}; `);
    expect(out).toContain("'a b\nc; rm -rf /; & | > <'");
  });

  it('coerces non-string defined values to string before quoting', () => {
    // NodeJS.ProcessEnv values are string|undefined, but be defensive: a numeric
    // or boolean coerces so the export never emits an unquoted token.
    const out = buildEnvExports({ NUM: 42 as unknown as string, FLAG: true as unknown as string });
    expect(out).toBe("export NUM='42'; export FLAG='true'; ");
  });

  it('produces no output for a request env whose every entry is dropped', () => {
    expect(buildEnvExports({ 'bad-name': 'x', DROP: undefined })).toBe('');
  });

  /**
   * Implements: features/agent-env-scoping/sidecar-bootstrap-env.feature
   * Scenario: The per-step request env overlays the scoped base in the agent
   * command — exports RATCHET_BATCH_NAME and exports no var absent from the
   * request env.
   */
  it('exports RATCHET_BATCH_NAME from the request env and never a var absent from it', () => {
    const out = buildEnvExports({ RATCHET_BATCH_NAME: 'demo' });
    expect(out).toBe("export RATCHET_BATCH_NAME='demo'; ");
    // A host secret that was dropped by scoping is NOT in the request env, so
    // it is never exported into the agent command.
    expect(out).not.toContain('SUPER_SECRET_TOKEN');
  });
});
