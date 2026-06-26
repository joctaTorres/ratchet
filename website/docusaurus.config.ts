import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// The documentation site is a standalone Docusaurus app that renders the
// repository-root `docs/` directory. Reference content lives one level up, in
// `../docs`; this app only provides the site shell, theme, and landing page.
const config: Config = {
  title: 'ratchet',
  tagline: 'AI-native system for BDD-flavored spec-driven development',
  favicon: 'img/ratchet.png',

  // Cloudflare Pages serves the site at the project root.
  url: 'https://ratchet.pages.dev',
  baseUrl: '/',

  organizationName: 'joctaTorres',
  projectName: 'ratchet',

  // Ship no broken links: a bad internal link fails the (Cloudflare) build
  // instead of producing a site with a dead link.
  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

  // Distinctive typefaces for the "machined" aesthetic: JetBrains Mono for the
  // mechanical/monospaced display headline and labels, Work Sans (a humanist
  // sans — deliberately not Inter/Roboto) for body text.
  stylesheets: [
    'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;700;800&family=Work+Sans:wght@400;500;600&display=swap',
  ],

  // i18n infrastructure is enabled with English as the only locale. The default
  // locale builds at the site root (no `/en/` path prefix) and no locale
  // switcher is shown while a single locale exists. See website/README.md for
  // how to add a language without restructuring the site.
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          // Source reference content from the repository-root docs/ directory.
          path: '../docs',
          // Serve reference docs under /docs, leaving / free for the landing page.
          routeBasePath: 'docs',
          sidebarPath: './sidebars.ts',
        },
        // No blog: the documentation site carries reference docs only.
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/ratchet.png',
    colorMode: {
      // Machined dark-first aesthetic: default to dark, respect the OS choice.
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'ratchet',
      logo: {
        alt: 'ratchet logo',
        src: 'img/ratchet.png',
      },
      items: [
        {
          to: '/docs/intro',
          label: 'Docs',
          position: 'left',
        },
        {
          href: 'https://github.com/joctaTorres/ratchet',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [{label: 'Introduction', to: '/docs/intro'}],
        },
        {
          title: 'More',
          items: [
            {label: 'GitHub', href: 'https://github.com/joctaTorres/ratchet'},
          ],
        },
      ],
      copyright: 'ratchet · MIT License',
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'gherkin', 'yaml'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
