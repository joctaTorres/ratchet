import type {ReactNode, CSSProperties} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import useBaseUrl from '@docusaurus/useBaseUrl';
import Layout from '@theme/Layout';

import styles from './index.module.css';

const GITHUB_URL = 'https://github.com/joctaTorres/ratchet';

// Capability cards. Copy is adapted from the project README so the landing page
// stays accurate to what ratchet actually does.
const FEATURES: {tag: string; title: string; body: string}[] = [
  {
    tag: '// spec',
    title: 'Spec-driven',
    body: 'A change is a plan plus features: the propose → apply loop turns intent into executable artifacts before any code is written.',
  },
  {
    tag: '// bdd',
    title: 'BDD / Gherkin',
    body: 'Behavior is captured as executable Gherkin features — Given/When/Then scenarios are the contract the implementation must satisfy.',
  },
  {
    tag: '// batch',
    title: 'Batch orchestration',
    body: 'Larger efforts are sliced into ordered, vertical-slice phases with per-phase proofs of work — anti-waterfall by construction.',
  },
];

// Small helper so each revealed element can carry its own stagger delay. The
// `--rct-delay` custom property is not part of the typed CSSProperties keys, so
// the object is cast once rather than reaching for a per-key escape hatch.
function revealStyle(delayMs: number): CSSProperties {
  return {'--rct-delay': `${delayMs}ms`} as CSSProperties;
}

function Hero(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  const logoUrl = useBaseUrl('img/ratchet.png');

  return (
    <header className={styles.hero}>
      <div className={styles.heroInner}>
        <img
          src={logoUrl}
          alt="ratchet logo"
          className={clsx(styles.logo, styles.reveal)}
          style={revealStyle(0)}
        />
        <h1 className={clsx(styles.title, styles.reveal)} style={revealStyle(80)}>
          {siteConfig.title}
        </h1>
        <div className={clsx(styles.rule, styles.reveal)} style={revealStyle(160)} />
        <p
          className={clsx(styles.tagline, styles.reveal)}
          style={revealStyle(220)}>
          {siteConfig.tagline}
        </p>
        <div className={clsx(styles.ctas, styles.reveal)} style={revealStyle(300)}>
          <Link
            className={clsx('button button--primary button--lg', styles.ctaPrimary)}
            to="/docs/intro">
            Read the docs →
          </Link>
          <Link
            className={clsx('button button--secondary button--lg', styles.ctaSecondary)}
            href={GITHUB_URL}>
            GitHub ↗
          </Link>
        </div>
        {/*
          Install command. Kept agent-neutral: `npx ratchet-ai@beta init` with no
          `--tools` value (the flag is optional; init prompts without it), so the
          public landing page never special-cases a single coding agent.
        */}
        <pre className={clsx(styles.install, styles.reveal)} style={revealStyle(360)}>
          <span className={styles.installPrompt}>$ </span>
          <code>npx ratchet-ai@beta init</code>
        </pre>
      </div>
    </header>
  );
}

function Features(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className={styles.cardGrid}>
          {FEATURES.map((feature, i) => (
            <div
              key={feature.title}
              className={clsx(styles.card, styles.reveal)}
              style={revealStyle(380 + i * 90)}>
              <span className={styles.cardTag}>{feature.tag}</span>
              <h2 className={styles.cardTitle}>{feature.title}</h2>
              <p className={styles.cardBody}>{feature.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={siteConfig.title}
      description={siteConfig.tagline}>
      <main>
        <Hero />
        <Features />
      </main>
    </Layout>
  );
}
