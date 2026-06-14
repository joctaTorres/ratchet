import { describe, it, expect } from 'vitest';
import { makeStreamJsonRenderer } from '../../src/core/batch/engine/runtime/stream-json-renderer.js';

/**
 * Renderer unit tests over CANNED NDJSON fixtures (no real claude). A fake
 * `LinePrinter` collects the formatted output; assertions are on substrings so
 * they are robust to chalk color codes (which strip to plain in a non-TTY).
 * Event shapes mirror a real `claude --output-format stream-json` capture.
 */

function harness() {
  const printed: string[] = [];
  const renderer = makeStreamJsonRenderer((line) => printed.push(line));
  // Feed a whole NDJSON line (with trailing newline, as the engine does).
  const feed = (obj: unknown) => renderer.handleLine(JSON.stringify(obj) + '\n');
  const all = () => printed.join('\n');
  return { printed, renderer, feed, all };
}

describe('stream-json renderer — assistant text', () => {
  it('renders a full assistant text message as prose without raw JSON braces', () => {
    const { feed, all, printed } = harness();
    feed({ type: 'assistant', message: { content: [{ type: 'text', text: 'I will add a guard clause.' }] } });
    expect(all()).toContain('I will add a guard clause.');
    expect(printed.some((l) => l.includes('{') || l.includes('"type"'))).toBe(false);
  });

  it('streams partial text deltas incrementally and emits the joined text once closed', () => {
    const { renderer, printed, all } = harness();
    const delta = (text: string) =>
      renderer.handleLine(
        JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } }) + '\n'
      );
    delta('I will ');
    delta('add ');
    delta('a guard clause.');
    // Deltas accumulate; the closing assistant message flushes the streamed text
    // exactly once (no double-print of the same prose).
    renderer.handleLine(
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'I will add a guard clause.' }] } }) + '\n'
    );
    expect(all()).toContain('I will add a guard clause.');
    const proseLines = printed.filter((l) => l.includes('guard clause'));
    expect(proseLines).toHaveLength(1);
  });
});

describe('stream-json renderer — tool calls', () => {
  it('renders an Edit tool_use with its file target', () => {
    const { feed, all } = harness();
    feed({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'src/foo.ts' } }] } });
    expect(all()).toContain('Edit');
    expect(all()).toContain('src/foo.ts');
  });

  it('renders a Bash tool_use with its command target', () => {
    const { feed, all } = harness();
    feed({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'pnpm test' } }] } });
    expect(all()).toContain('Bash');
    expect(all()).toContain('pnpm test');
  });

  it('renders a Grep tool_use with its pattern target', () => {
    const { feed, all } = harness();
    feed({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Grep', input: { pattern: 'TODO' } }] } });
    expect(all()).toContain('Grep');
    expect(all()).toContain('TODO');
  });

  it('renders an unfamiliar tool with a generic line and best-effort target (no crash)', () => {
    const { feed, all } = harness();
    expect(() =>
      feed({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'SomeFutureTool', input: { thing: 'widget' } }] } })
    ).not.toThrow();
    expect(all()).toContain('SomeFutureTool');
    expect(all()).toContain('widget'); // first string-valued input field
  });
});

describe('stream-json renderer — tool results', () => {
  it('renders a short tool_result on a result line', () => {
    const { feed, all } = harness();
    feed({ type: 'user', message: { content: [{ type: 'tool_result', content: '2 files changed' }] } });
    expect(all()).toContain('2 files changed');
  });

  it('truncates a long tool_result and signals the truncation', () => {
    const { feed, all } = harness();
    const longContent = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
    feed({ type: 'user', message: { content: [{ type: 'tool_result', content: longContent }] } });
    const out = all();
    // Bounded length and an explicit "+N more" / ellipsis marker.
    expect(out.length).toBeLessThan(400);
    expect(/…|\+\d+ more/.test(out)).toBe(true);
  });

  it('marks an error tool_result as an error and includes the content', () => {
    const { feed, all } = harness();
    feed({ type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: 'command failed' }] } });
    expect(all().toLowerCase()).toContain('error');
    expect(all()).toContain('command failed');
  });
});

describe('stream-json renderer — final summary', () => {
  it('renders a success summary with the result text and a usage/cost figure', () => {
    const { feed, all } = harness();
    feed({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'Added guard clause',
      total_cost_usd: 0.0521,
      usage: { input_tokens: 3295, output_tokens: 4 },
    });
    const out = all();
    expect(out).toContain('Added guard clause');
    expect(out.toLowerCase()).toContain('success');
    expect(/\$0\.05|tok/.test(out)).toBe(true); // a concise usage or cost figure
  });

  it('renders an error summary indicating failure with the result text', () => {
    const { feed, all } = harness();
    feed({ type: 'result', subtype: 'error', is_error: true, result: 'tool limit exceeded' });
    expect(all()).toContain('tool limit exceeded');
    expect(/error|✘/.test(all())).toBe(true);
  });

  it('still renders the result summary when an earlier line was malformed', () => {
    const { renderer, all } = harness();
    renderer.handleLine('this is not json {\n');
    renderer.handleLine(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'done' }) + '\n');
    expect(all()).toContain('this is not json {'); // malformed → raw
    expect(all()).toContain('done'); // summary still rendered
  });
});

describe('stream-json renderer — graceful degradation', () => {
  it('prints a non-JSON line raw and does not throw', () => {
    const { renderer, printed } = harness();
    expect(() => renderer.handleLine('this is not json {\n')).not.toThrow();
    expect(printed).toContain('this is not json {');
  });

  it('prints an unknown-type event raw and does not throw', () => {
    const { renderer, printed } = harness();
    const line = JSON.stringify({ type: 'totally_new_event_kind', foo: 1 });
    expect(() => renderer.handleLine(line + '\n')).not.toThrow();
    expect(printed).toContain(line);
  });

  it('prints a JSON object missing a type field raw and does not throw', () => {
    const { renderer, printed } = harness();
    const line = JSON.stringify({ foo: 'bar' });
    expect(() => renderer.handleLine(line + '\n')).not.toThrow();
    expect(printed).toContain(line);
  });

  it('flushes a buffered partial line (no trailing newline) on stream end', () => {
    const { renderer, printed } = harness();
    // A final chunk that ends mid-line without a trailing newline.
    renderer.handleLine('partial-without-newline');
    expect(printed).toHaveLength(0); // held in the buffer, not yet emitted
    renderer.flush();
    expect(printed).toContain('partial-without-newline'); // emitted on flush
  });

  it('recognizes benign control events (system/rate_limit) without dumping raw JSON', () => {
    const { renderer, printed } = harness();
    renderer.handleLine(JSON.stringify({ type: 'system', subtype: 'init', model: 'x' }) + '\n');
    renderer.handleLine(JSON.stringify({ type: 'system', subtype: 'status', status: 'busy' }) + '\n');
    renderer.handleLine(JSON.stringify({ type: 'rate_limit_event' }) + '\n');
    expect(printed).toHaveLength(0); // recognized control noise, silently ignored
  });
});
