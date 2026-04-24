/**
 * Landing-page accessibility & performance gate.
 *
 * Runs in the existing vitest + jsdom setup so it works in CI without
 * spinning up a real browser. Acts as a build-failing regression net for
 * two specific guarantees we made for the landing tiles:
 *
 *   1. Every <img> has an `alt` attribute (decorative imgs use alt="").
 *   2. Every non-decorative <img> opts into native lazy loading
 *      (`loading="lazy"`) AND async decoding (`decoding="async"`).
 *   3. axe-core finds zero violations of the `image-alt` rule.
 *
 * If any of these regress — e.g. someone drops `loading="lazy"` from a
 * tile background, or forgets the `alt` attribute on a new image — this
 * test fails and the CI build is blocked.
 *
 * Sections covered: HeroSection, WhyQurtubaSection, ValueDifferentiationSection.
 * (These are the only landing sections that render <img> elements; the
 * rest are icon/SVG-only.)
 */
import { describe, it, expect } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import axe from 'axe-core';
import i18n from '@/i18n/config';
import HeroSection from '@/components/landing/HeroSection';
import WhyQurtubaSection from '@/components/landing/WhyQurtubaSection';
import ValueDifferentiationSection from '@/components/landing/ValueDifferentiationSection';

type SectionEntry = {
  name: string;
  Component: React.ComponentType;
  /** Hero is above-the-fold; LCP image is intentionally eager-loaded. */
  allowEager?: boolean;
};

const sections: SectionEntry[] = [
  { name: 'HeroSection',                  Component: HeroSection, allowEager: true },
  { name: 'WhyQurtubaSection',            Component: WhyQurtubaSection },
  { name: 'ValueDifferentiationSection',  Component: ValueDifferentiationSection },
];

/** Render a section inside the providers it needs to mount. */
function renderSection(Component: React.ComponentType) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <Component />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('landing page image accessibility & lazy-loading gate', () => {
  for (const { name, Component, allowEager } of sections) {
    describe(name, () => {
      it('every <img> has an alt attribute', () => {
        const { container } = renderSection(Component);
        const imgs = Array.from(container.querySelectorAll('img'));
        expect(imgs.length, `${name} should render at least one image`).toBeGreaterThan(0);

        const missingAlt = imgs.filter((img) => !img.hasAttribute('alt'));
        expect(
          missingAlt,
          `Images missing alt in ${name}:\n` +
            missingAlt.map((i) => `  - src="${i.getAttribute('src')}"`).join('\n'),
        ).toHaveLength(0);
        cleanup();
      });

      it('every non-decorative <img> uses loading="lazy" + decoding="async"', () => {
        const { container } = renderSection(Component);
        const imgs = Array.from(container.querySelectorAll('img')).filter((img) => {
          // Skip decorative blur-up placeholders — they're aria-hidden and
          // intentionally render eagerly so the fade-in works on first paint.
          if (img.getAttribute('aria-hidden') === 'true') return false;
          // Skip the explicit LCP image in the hero (allowEager === true).
          if (allowEager && img.getAttribute('fetchpriority') === 'high') return false;
          return true;
        });

        const offenders = imgs.filter(
          (img) =>
            img.getAttribute('loading') !== 'lazy' ||
            img.getAttribute('decoding') !== 'async',
        );

        expect(
          offenders,
          `Images missing perf attrs in ${name}:\n` +
            offenders
              .map(
                (i) =>
                  `  - src="${i.getAttribute('src')}" ` +
                  `loading="${i.getAttribute('loading')}" ` +
                  `decoding="${i.getAttribute('decoding')}"`,
              )
              .join('\n'),
        ).toHaveLength(0);
        cleanup();
      });

      it('passes axe-core image-alt rule (no violations)', async () => {
        const { container } = renderSection(Component);
        const results = await axe.run(container, {
          // Scope to image-related rules — this gate is specifically about
          // image accessibility, not the full WCAG suite (other rules can
          // produce false positives in jsdom for color-contrast etc).
          runOnly: { type: 'rule', values: ['image-alt', 'role-img-alt'] },
        });

        expect(
          results.violations,
          `axe violations in ${name}:\n` +
            JSON.stringify(results.violations, null, 2),
        ).toHaveLength(0);
        cleanup();
      });
    });
  }
});
