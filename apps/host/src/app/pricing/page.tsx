import PricingV3 from '@alfanumrik/ui/landing/v3/PricingV3';

/**
 * /pricing — landing-v3 makeover (same CEO-approved Tailark system as
 * /welcome V3; design source of truth:
 * design-previews/marketing-page-ultra.html).
 *
 * SEO metadata (title contains "Pricing" + canonical — pinned by
 * e2e/public-pages.spec.ts and e2e/landing-seo.spec.ts) lives in
 * ./layout.tsx and is unchanged. All page chrome, copy, plan cards,
 * schools band, and FAQ live in the shared V3 package component.
 */
export default function PricingPage() {
  return <PricingV3 />;
}
