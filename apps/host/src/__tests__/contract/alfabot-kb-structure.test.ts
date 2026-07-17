/**
 * Contract test — AlfaBot knowledge-base structural integrity.
 *
 * Companion to `alfabot-kb-pricing-drift.test.ts` (REG-65). Added with the
 * counseling-v2 KB expansion (2026-07-17, +10 sections). Pins:
 *
 *   1. Every expected section id exists (12 original + 10 counseling-v2).
 *   2. Every section has a meta block with `audience:` and `last_reviewed:`,
 *      and a non-empty EN body AND a non-empty HI body — the embed script
 *      (`scripts/embed-alfabot-kb.mjs`) silently SKIPS sections that miss
 *      either, so a malformed section would vanish from retrieval without
 *      any error. This test turns that silent skip into a PR failure.
 *   3. The FIRST ₹-price literal in the whole file is still ₹699 — the
 *      REG-65 drift test uses first-occurrence as the KB pricing authority,
 *      so no new section may introduce an earlier different price.
 *   4. No future-promise language anywhere in the KB (P12: the same banned
 *      phrases the AlfaBot post-processor enforces on model output).
 *   5. The four canned refusal strings remain verbatim in refusal-policy.
 *   6. New counseling sections carry the intended audience routing.
 *
 * Owner: ai-engineer. Reviewers: assessment (content correctness), testing.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');

const kb = readFileSync(
  resolve(REPO_ROOT, 'docs/alfabot/knowledge-base.md'),
  'utf8',
);

/** Mirrors the embed script's parser closely enough to catch skip-shaped bugs. */
interface KbSection {
  id: string;
  audience: string[];
  lastReviewed: string | null;
  en: string;
  hi: string;
}

function parseSections(markdown: string): KbSection[] {
  const parts = markdown.split(/^## /m).slice(1);
  const sections: KbSection[] = [];
  for (const part of parts) {
    const lines = part.split('\n');
    const id = lines[0].trim();
    const body = lines.slice(1).join('\n');
    const metaMatch = body.match(/<!--\s*meta:\s*([\s\S]*?)-->/);
    const audMatch = metaMatch?.[1].match(/audience:\s*([^\n]+)/);
    const reviewedMatch = metaMatch?.[1].match(/last_reviewed:\s*([^\n]+)/);
    const enMatch = body.match(/^###\s+EN\s*\n([\s\S]*?)(?=^###\s+HI|^---|\Z)/m);
    const hiMatch = body.match(/^###\s+HI\s*\n([\s\S]*?)(?=^---|\Z)/m);
    sections.push({
      id,
      audience: (audMatch?.[1] ?? '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
      lastReviewed: reviewedMatch?.[1].trim() ?? null,
      en: (enMatch?.[1] ?? '').trim(),
      hi: (hiMatch?.[1] ?? '').trim(),
    });
  }
  return sections;
}

const ORIGINAL_SECTIONS = [
  'company',
  'product-features',
  'pricing-plans',
  'school-b2b',
  'teacher-tools',
  'parent-dashboard',
  'student-experience',
  'safety-privacy-dpdpa',
  'technical-devices',
  'signup-flow',
  'contact',
  'refusal-policy',
];

const COUNSELING_V2_SECTIONS = [
  'parent-value',
  'screen-time-wellbeing',
  'alfanumrik-with-tuition',
  'ai-safety-for-parents',
  'outcomes-how-we-measure',
  'competition-prep',
  'teacher-time-savings',
  'choosing-a-platform',
  'refunds-cancellation',
  'getting-started-first-week',
];

/** Same phrase set as ALFABOT_BANNED_PHRASES in the prompt module (P12). */
const BANNED_FUTURE_PROMISES: readonly RegExp[] = [
  /\bcoming\s+soon\b/i,
  /\bwe\s+will\s+(support|add|launch|release|ship)\b/i,
  /\bplanning\s+to\b/i,
  /\bgoing\s+to\s+(launch|add|support|release)\b/i,
  /\b(q[1-4]\s+202[6-9])\b/i,
  /\b(later\s+this\s+(quarter|year))\b/i,
];

describe('AlfaBot KB — structural integrity (counseling v2)', () => {
  const sections = parseSections(kb);
  const byId = new Map(sections.map((s) => [s.id, s]));

  it('contains all 12 original + all 10 counseling-v2 section ids', () => {
    for (const id of [...ORIGINAL_SECTIONS, ...COUNSELING_V2_SECTIONS]) {
      expect(byId.has(id), `missing section: ${id}`).toBe(true);
    }
  });

  it('every section has meta (audience + last_reviewed) and non-empty EN + HI bodies', () => {
    for (const section of sections) {
      expect(section.audience.length, `${section.id}: audience missing`).toBeGreaterThan(0);
      expect(section.lastReviewed, `${section.id}: last_reviewed missing`).toMatch(
        /^\d{4}-\d{2}-\d{2}$/,
      );
      expect(section.en.length, `${section.id}: EN body empty (embed script would skip it)`).toBeGreaterThan(0);
      expect(section.hi.length, `${section.id}: HI body empty (embed script would skip it)`).toBeGreaterThan(0);
    }
  });

  it('the FIRST ₹-price in the file is still ₹699 (REG-65 authority preserved)', () => {
    const firstPrice = kb.match(/₹\s*(\d{2,5})/);
    expect(firstPrice).not.toBeNull();
    expect(firstPrice![1]).toBe('699');
    // And it lives inside pricing-plans — i.e. no new section introduced an
    // earlier price literal.
    const pricingStart = kb.indexOf('## pricing-plans');
    expect(kb.indexOf('₹')).toBeGreaterThan(pricingStart);
  });

  it('no future-promise language in any section body, EN or HI (P12)', () => {
    // Scanned per-section (not whole-file): the KB preface legitimately QUOTES
    // "coming soon" while forbidding it in the authoring rules.
    for (const section of sections) {
      for (const pattern of BANNED_FUTURE_PROMISES) {
        expect(
          pattern.test(section.en),
          `${section.id} EN matches banned phrase ${pattern}`,
        ).toBe(false);
        expect(
          pattern.test(section.hi),
          `${section.id} HI matches banned phrase ${pattern}`,
        ).toBe(false);
      }
    }
  });

  it('the KB file ends with a trailing "---" so the embed script keeps the last HI body', () => {
    // scripts/embed-alfabot-kb.mjs terminates the LAST section's HI body on
    // `^---`; its `\Z` fallback is not a real JS end-anchor, so without a
    // trailing rule the final section's Hindi chunk is silently skipped.
    expect(/^---\s*$/m.test(kb.slice(kb.lastIndexOf('### HI'))), 'no trailing --- after last HI body').toBe(true);
  });

  it('refusal-policy still carries the four canned strings verbatim (REG-66)', () => {
    const refusal = kb.slice(kb.indexOf('## refusal-policy'));
    const policySection =
      refusal.slice(0, refusal.search(/\n## [a-z]/) === -1 ? undefined : refusal.search(/\n## [a-z]/));
    expect(policySection).toContain(
      "I help with questions about Alfanumrik. I'm not a tutor — Foxy is, but you need to sign up first.",
    );
    expect(policySection).toContain(
      "I don't have that info — would you like to talk to our team? hello@alfanumrik.com",
    );
    expect(policySection).toContain(
      'I only answer questions about Alfanumrik — not medical, legal, news, or politics.',
    );
    expect(policySection).toContain("I never share other students' data.");
  });

  it('counseling-v2 sections carry the intended audience routing', () => {
    expect(byId.get('parent-value')?.audience).toEqual(['parent']);
    expect(byId.get('screen-time-wellbeing')?.audience).toEqual(['parent']);
    expect(byId.get('alfanumrik-with-tuition')?.audience).toEqual(['parent']);
    expect(byId.get('ai-safety-for-parents')?.audience).toEqual(['parent']);
    expect(byId.get('outcomes-how-we-measure')?.audience).toEqual(['parent', 'teacher']);
    expect(byId.get('competition-prep')?.audience).toEqual(['student', 'parent']);
    expect(byId.get('teacher-time-savings')?.audience).toEqual(['teacher']);
    expect(byId.get('choosing-a-platform')?.audience).toEqual(['all']);
    expect(byId.get('refunds-cancellation')?.audience).toEqual(['parent', 'school']);
    expect(byId.get('getting-started-first-week')?.audience).toEqual(['parent', 'student']);
  });

  it('counseling-v2 sections make no competitor claims and quote refund facts faithfully', () => {
    // choosing-a-platform must not name platforms (retention rule alignment).
    const choosing = byId.get('choosing-a-platform');
    expect(choosing?.en).toContain('do not name or judge other platforms');
    // refunds-cancellation must match the /refunds page facts, not invent terms.
    const refunds = byId.get('refunds-cancellation');
    expect(refunds?.en).toContain('billing@alfanumrik.com');
    expect(refunds?.en).toContain('end of the current billing month');
    expect(refunds?.en).toContain('first 7 days');
    expect(refunds?.en).toContain('7 working days');
    expect(refunds?.en).toContain('/refunds');
    // outcomes section must keep the no-invented-stats posture.
    const outcomes = byId.get('outcomes-how-we-measure');
    expect(outcomes?.en).toContain('measured, not promised');
    expect(outcomes?.en).toContain('do not publish invented success statistics');
  });
});
