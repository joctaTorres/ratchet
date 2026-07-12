import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  shquote,
  buildEnvExports,
  buildAgentRunCommand,
  surrogateEscapeByteLength,
  MAX_PARTIAL_BYTES,
} from '../../src/core/batch/engine/runtime/spawn-command.js';
import type { AgentSpawnRequest } from '../../src/core/batch/engine/agent.js';

/**
 * Unit tests for the shared env-serialization helper used by BOTH rex runtimes.
 *
 * Implements `features/rex-env-threading/env-serialization-safety.feature`.
 * No filesystem, no spawn — pure serialization assertions over in-memory inputs
 * (the testing standard's unit layer). Shell-execution proof that a built command
 * actually observes the value lives in the runtime tests (`rex-sidecar-runtime`
 * and `rex-remote-runtime`), which run the built command through `sh -c`.
 */

const VECTORS_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'src',
  'core',
  'batch',
  'engine',
  'runtime',
  'shquote-vectors.json'
);

const CURSOR_VECTORS_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'src',
  'core',
  'batch',
  'engine',
  'runtime',
  'cursor-vectors.json'
);

function makeRequest(over: Partial<AgentSpawnRequest> = {}): AgentSpawnRequest {
  return {
    command: 'agent',
    args: ['-p', '--flag'],
    instructions: '',
    cwd: '',
    env: {},
    ...over,
  };
}

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

/**
 * Unit tests for the shared agent run-command builder used by BOTH rex runtimes.
 *
 * Implements `features/rex-command-builder/shared-run-command.feature`.
 * The existing `rex-sidecar-runtime` and `rex-remote-runtime` suites double as
 * the behavior-preservation proof (they assert on the delegated outputs); these
 * tests pin the builder's own shape: cwd prefix, env exports, quoting, and the
 * no-cwd remote shape.
 */
describe('buildAgentRunCommand', () => {
  it('builds the cd prefix from opts.cwd, single-quoted', () => {
    const out = buildAgentRunCommand('/p/prompt.txt', makeRequest(), { cwd: '/work/dir' });
    expect(out.startsWith("cd '/work/dir'; ")).toBe(true);
  });

  it('omits the cd prefix when cwd is not supplied (remote shape)', () => {
    const out = buildAgentRunCommand('/p/prompt.txt', makeRequest());
    expect(out.startsWith('cd ')).toBe(false);
    expect(out.startsWith('export ')).toBe(false);
  });

  it('emits env exports between the cwd prefix and the cat pipeline', () => {
    const out = buildAgentRunCommand('/p/prompt.txt', makeRequest({ env: { FOO: 'bar' } }), {
      cwd: '/w',
    });
    expect(out).toBe("cd '/w'; export FOO='bar'; cat '/p/prompt.txt' | 'agent' '-p' '--flag'");
  });

  it('quotes the prompt path and the argv tokens via shquote', () => {
    const out = buildAgentRunCommand("/p/with space.txt", makeRequest({ command: "a'b", args: [] }));
    expect(out).toBe(`cat ${shquote("/p/with space.txt")} | ${shquote("a'b")}`);
  });

  it('produces a byte-identical output to the legacy sidecar construction', () => {
    // The pre-dedup buildRunCommand shape: `cd <cwd>; <exports>cat <pf> | <argv>`.
    const req = makeRequest({ env: { A: '1', B: '2' } });
    const out = buildAgentRunCommand('/p.txt', req, { cwd: '/w' });
    const argv = [req.command, ...req.args].map(shquote).join(' ');
    const expected = `cd '/w'; export A='1'; export B='2'; cat '/p.txt' | ${argv}`;
    expect(out).toBe(expected);
  });
});

/**
 * Cross-language shquote contract test (TS side).
 *
 * Implements `features/shquote-contract/cross-language-vectors.feature`.
 * Both this vitest case and the Python `ShquoteContractTests` in
 * `test_sidecar.py` load the SAME `shquote-vectors.json` (next to the
 * implementations under `src/core/batch/engine/runtime/`), so a change to
 * either `shquote` (TS) or `_shquote` (Python) that breaks parity fails a test
 * in its own language. Neither test embeds a private copy of the vectors.
 */
describe('shquote contract (cross-language vectors)', () => {
  const vectors: { input: string; quoted: string }[] = JSON.parse(
    readFileSync(VECTORS_PATH, 'utf-8')
  );

  it('covers spaces, single/double quotes, $, backticks, newlines, and the empty string', () => {
    const inputs = new Set(vectors.map((v) => v.input));
    expect(inputs.has('')).toBe(true);
    expect(inputs.has('with spaces')).toBe(true);
    expect([...inputs].some((s) => s.includes("'"))).toBe(true);
    expect([...inputs].some((s) => s.includes('"'))).toBe(true);
    expect([...inputs].some((s) => s.includes('$'))).toBe(true);
    expect([...inputs].some((s) => s.includes('`'))).toBe(true);
    expect([...inputs].some((s) => s.includes('\n'))).toBe(true);
  });

  it.each(vectors)('shquote($input) === expected vector', ({ input, quoted }) => {
    expect(shquote(input)).toBe(quoted);
  });
});

/**
 * Unit tests for the shared surrogateescape byte-length arithmetic and the
 * partial-buffer cap constant used by BOTH rex runtimes' bounded-partial and
 * cursor-alignment paths.
 *
 * Implements `features/cursor-alignment/surrogateescape-byte-cursor.feature` and
 * `features/bounded-partials/flush-oversized-partial.feature` (the shared
 * primitives; the per-channel behavior is proven in the runtime suites).
 */
describe('surrogateEscapeByteLength', () => {
  it('counts an ASCII string by its byte length', () => {
    expect(surrogateEscapeByteLength('plain ascii')).toBe(11);
    expect(surrogateEscapeByteLength('')).toBe(0);
  });

  it('counts ordinary multibyte code points at their standard UTF-8 length', () => {
    expect(surrogateEscapeByteLength('café')).toBe(5); // é = 2 bytes
    expect(surrogateEscapeByteLength('über')).toBe(5); // ü = 2 bytes
    expect(surrogateEscapeByteLength('日本語')).toBe(9); // 3 × 3 bytes
    expect(surrogateEscapeByteLength('😀')).toBe(4); // astral pair → 4 bytes
  });

  it('counts a surrogateescape lone surrogate (U+DC80–U+DCFF) as exactly one byte', () => {
    expect(surrogateEscapeByteLength('\udc80')).toBe(1);
    expect(surrogateEscapeByteLength('\udcff')).toBe(1);
    // Mixed content: 'a' (1) + lone surrogate (1) + 'b' (1) = 3.
    expect(surrogateEscapeByteLength('a\udc80b')).toBe(3);
    // A split multibyte tail surfaces its lead byte as a lone surrogate (1 byte).
    expect(surrogateEscapeByteLength('a\udcc3')).toBe(2);
  });

  it('disagrees with Buffer.byteLength on lone surrogates (the bug this fixes)', () => {
    // Buffer.byteLength encodes a lone surrogate as the 3-byte replacement char,
    // which is exactly the remote cursor drift #90 fixes; ours counts it as 1.
    expect(Buffer.byteLength('\udcff', 'utf-8')).toBe(3);
    expect(surrogateEscapeByteLength('\udcff')).toBe(1);
  });
});

describe('MAX_PARTIAL_BYTES', () => {
  it('is the shared 1 MiB partial-buffer cap', () => {
    expect(MAX_PARTIAL_BYTES).toBe(1024 * 1024);
  });
});

/**
 * Cross-language cursor-arithmetic contract test (TS side).
 *
 * Implements `features/cursor-alignment/surrogateescape-byte-cursor.feature`.
 * Both this vitest case and the Python `CursorContractTests` in `test_sidecar.py`
 * load the SAME `cursor-vectors.json` (next to the implementations under
 * `src/core/batch/engine/runtime/`), so a change to either the TS
 * `surrogateEscapeByteLength` or the sidecar's `encode("utf-8","surrogateescape")`
 * arithmetic that breaks parity fails a test in its own language. Neither test
 * embeds a private copy of the vectors.
 */
describe('cursor arithmetic contract (cross-language vectors)', () => {
  const vectors: { text: string; bytes: number }[] = JSON.parse(
    readFileSync(CURSOR_VECTORS_PATH, 'utf-8')
  );

  it('covers ASCII, multibyte, lone surrogates, mixed, split tails, and the empty string', () => {
    const texts = vectors.map((v) => v.text);
    expect(texts).toContain('');
    expect(texts.some((s) => /^[\x00-\x7f]+$/.test(s) && s.length > 0)).toBe(true); // pure ASCII
    expect(texts.some((s) => /[-߿ࠀ-￿]/.test(s))).toBe(true); // multibyte
    expect(texts.some((s) => [...s].some((c) => c.codePointAt(0)! > 0xffff))).toBe(true); // astral
    expect(
      texts.some((s) => [...s].some((c) => c.codePointAt(0)! >= 0xdc80 && c.codePointAt(0)! <= 0xdcff))
    ).toBe(true); // lone surrogate
  });

  it.each(vectors)('surrogateEscapeByteLength($text) === $bytes', ({ text, bytes }) => {
    expect(surrogateEscapeByteLength(text)).toBe(bytes);
  });
});
