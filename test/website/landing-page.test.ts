// Unit test for the Docusaurus landing page (`website/src/pages/index.tsx`).
//
// The landing page is a React component tree that depends on packages scoped to
// the website (react / react-dom) plus Docusaurus aliases (`@docusaurus/*`,
// `@theme/*`) that are resolved by Docusaurus' bundler, not by Node. None of
// those are installed in the root test workspace, so a full DOM render
// (react-dom / @testing-library) is unavailable here.
//
// Instead, the React element factory and the Docusaurus/theme imports are mocked
// with lightweight stubs, and a tiny recursive renderer walks the element tree —
// invoking every function component (Home → Hero, Features) so their bodies, the
// `revealStyle` helper, and the `FEATURES` map all execute. The test then asserts
// the page's user-visible contract: the site title/tagline, the call-to-action
// links, the install command, and the three capability cards.

import { describe, it, expect, vi } from 'vitest';

// --- Element shape -----------------------------------------------------------
// Both the classic (`React.createElement`) and automatic (`react/jsx-runtime`)
// JSX runtimes are stubbed so the test is robust to however esbuild transforms
// the `.tsx`. Every factory produces the same `{ type, props }` node.
type Node = { type: unknown; props: Record<string, any> } | string | number | null | undefined | boolean | Node[];

function makeElement(type: unknown, props: Record<string, any> | null, ...children: unknown[]): Node {
  const merged: Record<string, any> = { ...(props ?? {}) };
  if (children.length > 0) {
    merged.children = children.length === 1 ? children[0] : children;
  }
  return { type, props: merged };
}

const FRAGMENT = Symbol('Fragment');

vi.mock('react', () => ({
  default: { createElement: makeElement, Fragment: FRAGMENT },
  createElement: makeElement,
  Fragment: FRAGMENT,
}));

// esbuild transforms the page's JSX with the classic runtime, which emits bare
// `React.createElement(...)` calls. The page imports named hooks only (never the
// React default), so `React` must be supplied on the global scope for renders.
(globalThis as Record<string, any>).React = { createElement: makeElement, Fragment: FRAGMENT };

vi.mock('react/jsx-runtime', () => ({
  jsx: (type: unknown, props: Record<string, any>) => ({ type, props: props ?? {} }),
  jsxs: (type: unknown, props: Record<string, any>) => ({ type, props: props ?? {} }),
  Fragment: FRAGMENT,
}));

// clsx joins truthy class fragments; the page only passes strings/undefined.
vi.mock('clsx', () => ({
  default: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

// Docusaurus aliases: Link / Layout pass their children straight through so the
// recursive renderer descends into them; the hooks return a deterministic
// siteConfig and echo back any base-url path.
vi.mock('@docusaurus/Link', () => ({
  default: (props: Record<string, any>) => props.children,
}));
vi.mock('@theme/Layout', () => ({
  default: (props: Record<string, any>) => props.children,
}));
vi.mock('@docusaurus/useDocusaurusContext', () => ({
  default: () => ({
    siteConfig: {
      title: 'ratchet',
      tagline: 'AI-native system for BDD-flavored spec-driven development',
    },
  }),
}));
vi.mock('@docusaurus/useBaseUrl', () => ({
  default: (path: string) => `/${path}`,
}));

import Home from '../../website/src/pages/index.tsx';

// Minimal renderer: resolves function components by calling them, and flattens
// the tree into the visible text it produces.
function renderToText(node: Node): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(renderToText).join('');

  const { type, props } = node;
  if (typeof type === 'function') {
    return renderToText((type as (p: Record<string, any>) => Node)(props));
  }
  return renderToText(props?.children);
}

// Collects every element node (both function components and host elements) in
// render order so structural props (href/src/style) can be asserted wherever
// they live — e.g. `href` sits on the `@docusaurus/Link` component, not a host.
function collectElements(node: Node, acc: Array<{ type: unknown; props: Record<string, any> }> = []) {
  if (node == null || typeof node !== 'object') return acc;
  if (Array.isArray(node)) {
    node.forEach((child) => collectElements(child, acc));
    return acc;
  }
  const { type, props } = node;
  acc.push({ type, props: props ?? {} });
  if (typeof type === 'function') {
    collectElements((type as (p: Record<string, any>) => Node)(props ?? {}), acc);
  } else {
    collectElements(props?.children, acc);
  }
  return acc;
}

describe('website/src/pages/index.tsx', () => {
  it('exports the Home page as a function component', () => {
    expect(Home).toBeTypeOf('function');
  });

  it('renders the hero with the site title, tagline, CTAs and install command', () => {
    const text = renderToText(Home({}));
    expect(text).toContain('ratchet');
    expect(text).toContain('AI-native system for BDD-flavored spec-driven development');
    expect(text).toContain('Read the docs');
    expect(text).toContain('GitHub');
    expect(text).toContain('npx ratchet-ai@beta init');
  });

  it('renders all three capability cards from the FEATURES list', () => {
    const text = renderToText(Home({}));
    expect(text).toContain('Spec-driven');
    expect(text).toContain('BDD / Gherkin');
    expect(text).toContain('Batch orchestration');
    // Card tags are rendered alongside titles.
    expect(text).toContain('// spec');
    expect(text).toContain('// bdd');
    expect(text).toContain('// batch');
  });

  it('points the GitHub CTA at the project repository', () => {
    const elements = collectElements(Home({}));
    const anchorHrefs = elements
      .map((el) => el.props.href)
      .filter((href): href is string => typeof href === 'string');
    expect(anchorHrefs).toContain('https://github.com/joctaTorres/ratchet');

    // The logo resolves through useBaseUrl and the reveal helper sets the
    // `--rct-delay` custom property on staggered elements.
    const img = elements.find((el) => el.type === 'img');
    expect(img?.props.src).toBe('/img/ratchet.png');
    const delayed = elements.find((el) => el.props.style && '--rct-delay' in el.props.style);
    expect(delayed?.props.style['--rct-delay']).toMatch(/ms$/);
  });
});
