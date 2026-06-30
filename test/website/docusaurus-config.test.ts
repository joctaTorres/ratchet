// Unit test for the Docusaurus site config (`website/docusaurus.config.ts`).
//
// The config module is a pure object literal whose only runtime import is
// `prism-react-renderer` (used for the Prism light/dark themes). That package is
// a website-scoped dependency that is not installed in the root test workspace,
// so it is mocked with a minimal stub; every other import in the module is
// type-only and erased at transform time. Importing the default export and
// asserting on its key fields exercises the module's lines and guards the
// site's published identity (title, URL, presets, navbar/footer, Prism config).

import { describe, it, expect, vi } from 'vitest';

// `prism-react-renderer` is only consumed for `themes.github` / `themes.dracula`.
// A stub with those keys lets the config module evaluate without the (uninstalled)
// website dependency.
vi.mock('prism-react-renderer', () => ({
  themes: {
    github: { plain: {}, styles: [] },
    dracula: { plain: {}, styles: [] },
  },
}));

import config from '../../website/docusaurus.config.ts';

describe('website/docusaurus.config.ts', () => {
  it('publishes the ratchet site identity', () => {
    expect(config.title).toBe('ratchet');
    expect(config.tagline).toBe('AI-native system for BDD-flavored spec-driven development');
    expect(config.url).toBe('https://ratchet.pages.dev');
    expect(config.baseUrl).toBe('/');
    expect(config.favicon).toBe('img/ratchet.png');
  });

  it('derives GitHub coordinates from organization/project name', () => {
    expect(config.organizationName).toBe('joctaTorres');
    expect(config.projectName).toBe('ratchet');
  });

  it('fails the build on broken internal and markdown links', () => {
    expect(config.onBrokenLinks).toBe('throw');
    expect(config.onBrokenMarkdownLinks).toBe('throw');
  });

  it('enables English-only i18n at the site root', () => {
    expect(config.i18n).toMatchObject({ defaultLocale: 'en', locales: ['en'] });
  });

  it('wires the classic preset to serve repo-root docs under /docs', () => {
    expect(Array.isArray(config.presets)).toBe(true);
    const [classicPreset] = config.presets as Array<[string, Record<string, any>]>;
    expect(classicPreset[0]).toBe('classic');

    const presetOptions = classicPreset[1];
    expect(presetOptions.docs).toMatchObject({
      path: '../docs',
      routeBasePath: 'docs',
      sidebarPath: './sidebars.ts',
    });
    // The documentation site carries no blog.
    expect(presetOptions.blog).toBe(false);
    expect(presetOptions.theme.customCss).toBe('./src/css/custom.css');
  });

  it('configures a dark-first theme with navbar, footer and Prism', () => {
    const themeConfig = config.themeConfig as Record<string, any>;
    expect(themeConfig.colorMode).toMatchObject({
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    });

    expect(themeConfig.navbar.title).toBe('ratchet');
    const navItems = themeConfig.navbar.items as Array<Record<string, any>>;
    expect(navItems.some((item) => item.to === '/docs/intro')).toBe(true);
    expect(navItems.some((item) => item.label === 'GitHub')).toBe(true);

    expect(themeConfig.footer.style).toBe('dark');
    expect(themeConfig.footer.copyright).toContain('MIT License');

    expect(themeConfig.prism.additionalLanguages).toEqual(['bash', 'gherkin', 'yaml']);
    expect(themeConfig.prism.theme).toBeDefined();
    expect(themeConfig.prism.darkTheme).toBeDefined();
  });
});
