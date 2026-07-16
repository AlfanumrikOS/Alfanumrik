import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';

/**
 * Tests for the 5 marketing pages rebuilt on the landing-v3 design system
 * (landing-v3 makeover, 2026-07-16): /for-parents, /for-teachers,
 * /for-schools, /product, /about.
 *
 * Source: apps/host/src/app/{for-parents,for-teachers,for-schools,product,
 * about}/page.tsx on the shared V3 marketing primitives
 * (packages/ui/src/landing/v3/marketing/ — MarketingShell, PageHeroV3,
 * FeatureGridV3, CtaBandV3, QuoteBandV3, StepStripV3, CrossLinkStripV3).
 *
 * Pins per page:
 *   - renders the per-page shell testid (never "welcome-root" — that id is
 *     unique to /welcome)
 *   - exactly ONE <h1>
 *   - Breadcrumbs present with the legacy trail preserved VERBATIM in the
 *     BreadcrumbList JSON-LD (e2e/landing-seo.spec.ts pins the /about and
 *     /for-parents trails; intermediates like "Solutions" carry no item URL)
 *   - CtaBandV3 primary CTA href (data-testid="cta-band-primary")
 *   - /for-schools renders SCHOOL_PER_SEAT_MARKETING_LABEL from the pricing
 *     SoT next to /student/mo (REG-65 family / REG-154 — no hardcoded rupee
 *     literal in the assertion)
 *
 * Conventions follow landing-v3/PricingV3.test.tsx (hermetic
 * next/navigation mock; matchMedia stub; localStorage reset).
 * Owning agent: testing.
 */

// ── Hermetic mocks ────────────────────────────────────────────────────────────
// Breadcrumbs calls usePathname() (Next app-router hook — unavailable in JSDOM).
vi.mock('next/navigation', () => ({
  usePathname: () => '/marketing-page-under-test',
}));

import ForParentsPage from '@/app/for-parents/page';
import ForTeachersPage from '@/app/for-teachers/page';
import ForSchoolsPage from '@/app/for-schools/page';
import ProductPage from '@/app/product/page';
import AboutPage from '@/app/about/page';
import { SCHOOL_PER_SEAT_MARKETING_LABEL } from '@alfanumrik/lib/pricing';

function stubMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

/** Parse every BreadcrumbList JSON-LD script currently in the document. */
function readBreadcrumbJsonLd(): {
  itemListElement: { position: number; name: string; item?: string }[];
} {
  const schemas = Array.from(
    document.querySelectorAll('script[type="application/ld+json"]'),
  )
    .map((s) => JSON.parse(s.textContent || 'null'))
    .filter(Boolean);
  const breadcrumb = schemas.find((s) => s['@type'] === 'BreadcrumbList');
  expect(breadcrumb, 'BreadcrumbList JSON-LD should be emitted').toBeTruthy();
  return breadcrumb;
}

interface PageCase {
  route: string;
  Page: React.ComponentType;
  testId: string;
  /** Ordered breadcrumb labels; `href: undefined` = no item URL in JSON-LD. */
  trail: { name: string; item?: string }[];
  /** Expected CtaBandV3 primary CTA destination. */
  ctaHref: string;
  /** A copy fragment pinned by e2e/public-pages.spec.ts mustContain. */
  bodyPin: string;
}

const PAGES: PageCase[] = [
  {
    route: '/for-parents',
    Page: ForParentsPage,
    testId: 'for-parents-root',
    trail: [
      { name: 'Home', item: 'https://alfanumrik.com/welcome' },
      { name: 'Solutions' },
      { name: 'For Parents' },
    ],
    ctaHref: '/login',
    bodyPin: 'Parent',
  },
  {
    route: '/for-teachers',
    Page: ForTeachersPage,
    testId: 'for-teachers-root',
    trail: [
      { name: 'Home', item: 'https://alfanumrik.com/welcome' },
      { name: 'Solutions' },
      { name: 'For Teachers' },
    ],
    ctaHref: '/login?role=teacher',
    bodyPin: 'Teacher',
  },
  {
    route: '/for-schools',
    Page: ForSchoolsPage,
    testId: 'for-schools-root',
    trail: [
      { name: 'Home', item: 'https://alfanumrik.com/welcome' },
      { name: 'Solutions' },
      { name: 'For Schools' },
    ],
    ctaHref: '/demo',
    bodyPin: 'School',
  },
  {
    route: '/product',
    Page: ProductPage,
    testId: 'product-root',
    trail: [
      { name: 'Home', item: 'https://alfanumrik.com/welcome' },
      { name: 'Product' },
    ],
    ctaHref: '/demo',
    bodyPin: 'Product',
  },
  {
    route: '/about',
    Page: AboutPage,
    testId: 'about-root',
    trail: [
      { name: 'Home', item: 'https://alfanumrik.com/welcome' },
      { name: 'About' },
    ],
    ctaHref: '/login',
    bodyPin: 'About',
  },
];

describe.each(PAGES)(
  'Marketing V3 page $route',
  ({ Page, testId, trail, ctaHref, bodyPin }) => {
    beforeEach(() => {
      stubMatchMedia(false);
      localStorage.clear();
    });
    afterEach(() => cleanup());

    it('renders the V3 shell with its own testid (not welcome-root)', () => {
      render(<Page />);
      expect(screen.getByTestId(testId)).toBeInTheDocument();
      expect(screen.queryByTestId('welcome-root')).toBeNull();
    });

    it('renders exactly one <h1>', () => {
      render(<Page />);
      expect(document.querySelectorAll('h1')).toHaveLength(1);
    });

    it('mounts Breadcrumbs with the legacy trail preserved verbatim (JSON-LD)', () => {
      render(<Page />);
      // Visible breadcrumb nav.
      expect(
        screen.getByRole('navigation', { name: 'Breadcrumb' }),
      ).toBeInTheDocument();
      // JSON-LD trail — the SEO surface pinned by e2e/landing-seo.spec.ts.
      const schema = readBreadcrumbJsonLd();
      expect(schema.itemListElement).toHaveLength(trail.length);
      trail.forEach((crumb, i) => {
        expect(schema.itemListElement[i].position).toBe(i + 1);
        expect(schema.itemListElement[i].name).toBe(crumb.name);
        if (crumb.item) {
          expect(schema.itemListElement[i].item).toBe(crumb.item);
        } else {
          // Intermediates ("Solutions") and the current page carry no URL.
          expect(schema.itemListElement[i].item).toBeUndefined();
        }
      });
    });

    it(`CtaBand primary CTA points at ${ctaHref}`, () => {
      render(<Page />);
      const cta = screen.getByTestId('cta-band-primary');
      expect(cta).toHaveAttribute('href', ctaHref);
    });

    it(`body contains the e2e content pin "${bodyPin}"`, () => {
      render(<Page />);
      expect(document.body.textContent).toContain(bodyPin);
    });
  },
);

describe('Marketing V3 — /for-schools per-seat price from the pricing SoT', () => {
  beforeEach(() => {
    stubMatchMedia(false);
    localStorage.clear();
  });
  afterEach(() => cleanup());

  it('renders SCHOOL_PER_SEAT_MARKETING_LABEL next to /student/mo (SchoolsBandV3 reuse)', () => {
    render(<ForSchoolsPage />);
    const band = document
      .querySelector('#schools-band-title')
      ?.closest('section') as HTMLElement;
    expect(band, 'SchoolsBandV3 should render on /for-schools').toBeTruthy();
    expect(band.textContent).toContain(SCHOOL_PER_SEAT_MARKETING_LABEL);
    expect(band.textContent).toContain('/student/mo');
    // Both B2B CTAs present, matching the legacy page's targets.
    expect(band.querySelector('a[href="/contact"]')).not.toBeNull();
    expect(band.querySelector('a[href="/demo"]')).not.toBeNull();
  });
});
