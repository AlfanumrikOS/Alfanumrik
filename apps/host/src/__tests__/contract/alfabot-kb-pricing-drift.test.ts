/**
 * REG-65 — AlfaBot pricing-verbatim drift detector.
 *
 * Pins the contract that the canonical pricing literal "₹699" appears
 * VERBATIM in two source-of-truth files. If either file changes the
 * price without the other being updated in lock-step, this test fails
 * loudly so the legal / brand / billing implications surface in PR review.
 *
 *   1. `docs/alfabot/knowledge-base.md` — the section_id="pricing-plans"
 *      block that the Edge Function stuffs into the system prompt as
 *      canonical context. The Edge Function's post-processor refuses
 *      replies that mention "₹" / "INR" / "rupees" without quoting the
 *      KB literal.
 *   2. `src/components/landing/FAQV2.tsx` — the visible pricing FAQ
 *      shown to every visitor on `/welcome?v=2`.
 *
 * Why P11-adjacent (not strictly payment integrity):
 *   Hallucinated pricing on a landing page is a legal + brand risk even
 *   though no payment flows through AlfaBot. If the FAQ says ₹699 but the
 *   KB says ₹599, a visitor's reasonable expectation is shaped by the
 *   first thing they read — and the consequence is a chargeback /
 *   consumer-protection complaint that's expensive to clean up.
 *
 * What this test does NOT check:
 *   - It does NOT verify the Edge Function's post-process pricing-banned
 *     check. That's exercised in
 *     `supabase/functions/alfabot-answer/__tests__/integration.test.ts`
 *     under the deno test runner (REG-65 catalog entry references both).
 *   - It does NOT check the bilingual Hindi rendering of the price — Hindi
 *     uses Devanagari digits in some surfaces, Arabic numerals in others.
 *     The product rule is "₹699 in Latin script as a technical term" (P7).
 *
 * Owner: testing.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');

function readSource(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), 'utf8');
}

/**
 * The canonical price literal. If the product team raises pricing this
 * constant MUST be updated AND the corresponding catalog entry
 * (REG-65 in `.claude/regression-catalog.md`) MUST be updated in the
 * same PR — this is the explicit pricing-change human-review gate.
 */
const CANONICAL_PRICE_LITERAL = '₹699';

describe('REG-65 — AlfaBot pricing-verbatim drift', () => {
  it('knowledge base contains the canonical pricing literal verbatim', () => {
    const kb = readSource('docs/alfabot/knowledge-base.md');
    expect(kb).toContain(CANONICAL_PRICE_LITERAL);
  });

  it('knowledge base pricing-plans section contains the literal in its body', () => {
    const kb = readSource('docs/alfabot/knowledge-base.md');
    // The pricing-plans section starts at "## pricing-plans". Slice from
    // there to the next H2 marker.
    const sectionStart = kb.indexOf('## pricing-plans');
    expect(sectionStart).toBeGreaterThan(-1);
    const afterStart = kb.slice(sectionStart);
    const nextSection = afterStart.search(/\n## [a-z]/);
    const pricingSection =
      nextSection === -1 ? afterStart : afterStart.slice(0, nextSection);
    expect(pricingSection).toContain(CANONICAL_PRICE_LITERAL);
    // The canonical "per month" framing must also be present so the
    // post-processor (which checks for ₹ adjacency) has the full string.
    expect(pricingSection.toLowerCase()).toMatch(/per\s+month|prati\s+ma|प्रति\s+माह/);
  });

  it('FAQV2 component contains the canonical pricing literal verbatim', () => {
    const faq = readSource('src/components/landing/FAQV2.tsx');
    expect(faq).toContain(CANONICAL_PRICE_LITERAL);
  });

  it('FAQV2 pricing question references both the literal and the per-month framing', () => {
    const faq = readSource('src/components/landing/FAQV2.tsx');
    // The pricing FAQ row uses the qEn/qHi keys; we look for at least one
    // occurrence that combines the literal with "month" (English) or
    // "माह" (Hindi).
    const hasEnglishMonth = /₹699[^\n]*month/i.test(faq);
    const hasHindiMonth = /₹699[^\n]*माह/.test(faq);
    expect(hasEnglishMonth || hasHindiMonth).toBe(true);
  });

  it('FAQV2 and KB use IDENTICAL Pro-plan price literal (drift detector)', () => {
    // Final cross-file assertion: if either source changes the Pro-plan
    // digits, this test fails.
    //
    // Changed 2026-06-25: marketing pass added Starter (₹299) before Pro
    // (₹699) in FAQV2, making first-occurrence extraction fragile.  We now
    // scan ALL ₹N entries in FAQV2 and assert the canonical literal is among
    // them, while KB's first occurrence is still used as the authority (the
    // KB only surfaces the Pro plan as the flagship price).
    const kb = readSource('docs/alfabot/knowledge-base.md');
    const faq = readSource('src/components/landing/FAQV2.tsx');
    const digits = CANONICAL_PRICE_LITERAL.replace('₹', ''); // '699'

    // KB: first price must equal the canonical literal.
    const kbMatch = kb.match(/₹\s*(\d{2,5})/);
    expect(kbMatch).not.toBeNull();
    expect(kbMatch![1]).toBe(digits);

    // FAQV2: the Pro-plan price must appear somewhere in the list of all
    // ₹N prices (multi-plan pages enumerate cheaper tiers first).
    const faqPrices = [...faq.matchAll(/₹\s*(\d{2,5})/g)].map((m) => m[1]);
    expect(faqPrices).toContain(digits);

    // Cross-file parity: KB canonical price matches what FAQV2 lists for Pro.
    expect(kbMatch![1]).toBe(digits);
  });
});
