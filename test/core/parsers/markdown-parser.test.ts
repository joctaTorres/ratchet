// Implements: .ratchet/changes/core-remainder-tests/features/core-remainder-tests/markdown-parser.feature
//
// Unit tests for the code-fence masking and section logic of
// src/core/parsers/markdown-parser.ts. These are pure-logic unit tests: the
// parser is constructed over an in-memory markdown string and the tests touch
// no filesystem and spawn no process.
//
// parseSections / getContentUntilNextHeader / findSection and the static
// buildCodeFenceMask / normalizeContent are `protected` on MarkdownParser. A
// test-only subclass exposes them here without changing source visibility.

import { describe, it, expect } from 'vitest';
import { MarkdownParser, type Section } from '../../../src/core/parsers/markdown-parser.js';

class TestParser extends MarkdownParser {
  sections(): Section[] {
    return this.parseSections();
  }

  find(title: string): Section | undefined {
    return this.findSection(this.parseSections(), title);
  }

  static mask(lines: string[]): boolean[] {
    return MarkdownParser.buildCodeFenceMask(lines);
  }

  static normalize(content: string): string {
    return MarkdownParser.normalizeContent(content);
  }
}

describe('MarkdownParser code-fence handling', () => {
  it('does not parse a "# heading" inside a triple-backtick fence as a header', () => {
    const md = ['# Real Title', '', '```', '# fenced heading', '```', ''].join(
      '\n'
    );
    const sections = new TestParser(md).sections();

    expect(sections.map(s => s.title)).toEqual(['Real Title']);
    expect(new TestParser(md).find('fenced heading')).toBeUndefined();
  });

  it('recognizes a tilde (~~~) fence the same way as a backtick fence', () => {
    const md = ['# Real Title', '', '~~~', '# fenced heading', '~~~', ''].join(
      '\n'
    );
    const sections = new TestParser(md).sections();

    expect(sections.map(s => s.title)).toEqual(['Real Title']);
    // The fenced lines (open/content/close) are masked.
    const lines = TestParser.normalize(md).split('\n');
    const mask = TestParser.mask(lines);
    expect(mask[2]).toBe(true); // ~~~
    expect(mask[3]).toBe(true); // # fenced heading
    expect(mask[4]).toBe(true); // ~~~
  });

  it('does not close a 4-backtick fence with a 3-backtick line', () => {
    const md = [
      '# Real Title',
      '',
      '````',
      '```',
      '# still fenced',
      '````',
      '# After Fence',
      '',
    ].join('\n');
    const sections = new TestParser(md).sections();

    // The 3-backtick line did not close the block, so "# still fenced" stays
    // masked; only the real titles outside the block become sections.
    expect(sections.map(s => s.title)).toEqual(['Real Title', 'After Fence']);
    expect(new TestParser(md).find('still fenced')).toBeUndefined();
  });

  it('masks the rest of the document when a fence is never closed', () => {
    const md = [
      '# Real Title',
      '',
      '```',
      '# never a section',
      '',
      '# also masked',
      '',
    ].join('\n');
    const sections = new TestParser(md).sections();

    expect(sections.map(s => s.title)).toEqual(['Real Title']);
    expect(new TestParser(md).find('never a section')).toBeUndefined();
    expect(new TestParser(md).find('also masked')).toBeUndefined();
  });

  it('builds a parent-child tree for nested headers (h1, h2 child, sibling h1)', () => {
    const md = [
      '# First',
      'first body',
      '',
      '## Child',
      'child body',
      '',
      '# Second',
      'second body',
      '',
    ].join('\n');
    const sections = new TestParser(md).sections();

    // Two top-level (h1) sections; the second h1 is a sibling, not a child.
    expect(sections.map(s => s.title)).toEqual(['First', 'Second']);
    expect(sections[0].level).toBe(1);
    expect(sections[1].level).toBe(1);

    // The h2 is a child of the first h1.
    expect(sections[0].children.map(c => c.title)).toEqual(['Child']);
    expect(sections[0].children[0].level).toBe(2);

    // The sibling h1 has no children.
    expect(sections[1].children).toHaveLength(0);
  });

  it('normalizes CRLF content so headers are detected as with LF', () => {
    const crlf = '# Title\r\nbody line\r\n\r\n## Sub\r\nsub body\r\n';

    // normalizeContent strips the CR.
    expect(TestParser.normalize(crlf)).toBe(
      '# Title\nbody line\n\n## Sub\nsub body\n'
    );

    const sections = new TestParser(crlf).sections();
    expect(sections.map(s => s.title)).toEqual(['Title']);
    expect(sections[0].children.map(c => c.title)).toEqual(['Sub']);
  });
});
