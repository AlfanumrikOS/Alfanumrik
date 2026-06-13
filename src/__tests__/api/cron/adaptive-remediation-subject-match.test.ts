/**
 * Round 2 condition fix (assessment cond 2, BLOCKING-B2B) — tier matrix for
 * the B2B escalation subject matcher in
 * src/app/api/cron/adaptive-remediation/_lib/subject-match.ts.
 *
 * Pins:
 *   - separator normalization on BOTH sides ([_\s]+ → single space,
 *     lowercase, trim) — kills the underscore false negatives
 *     ('social_studies' vs 'Social Studies');
 *   - token-boundary matching, NOT bare substring — kills the
 *     'Social Science' ⊃ 'science' false positive;
 *   - tier ordering: exact normalized equality (2) outranks partial
 *     token-boundary match (1) outranks no match (0);
 *   - the full CBSE code set: math, science, english, hindi, social_studies,
 *     physics, chemistry, biology, business_studies, political_science,
 *     computer_science, economics, accountancy, geography, history.
 *
 * The route-level consequence (which class's teacher receives the
 * escalation) is pinned in adaptive-remediation.test.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeSubjectLabel,
  subjectMatchTier,
} from '@/app/api/cron/adaptive-remediation/_lib/subject-match';

describe('normalizeSubjectLabel', () => {
  it('collapses underscore/whitespace runs to a single space, lowercases, trims', () => {
    expect(normalizeSubjectLabel('Social_Studies ')).toBe('social studies');
    expect(normalizeSubjectLabel('  BUSINESS__STUDIES')).toBe('business studies');
    expect(normalizeSubjectLabel("Social\tScience\n")).toBe('social science');
    expect(normalizeSubjectLabel('_math_')).toBe('math');
    expect(normalizeSubjectLabel('   ')).toBe('');
  });
});

describe('subjectMatchTier — tier 2 (exact normalized equality)', () => {
  // Every CBSE code vs its canonical Title Case display name.
  const exactPairs: Array<[string, string]> = [
    ['math', 'Math'],
    ['science', 'Science'],
    ['english', 'English'],
    ['hindi', 'Hindi'],
    ['social_studies', 'Social Studies'],
    ['physics', 'Physics'],
    ['chemistry', 'Chemistry'],
    ['biology', 'Biology'],
    ['business_studies', 'Business Studies'],
    ['political_science', 'Political Science'],
    ['computer_science', 'Computer Science'],
    ['economics', 'Economics'],
    ['accountancy', 'Accountancy'],
    ['geography', 'Geography'],
    ['history', 'History'],
  ];
  it.each(exactPairs)('code %s ≡ class "%s" → tier 2', (code, display) => {
    expect(subjectMatchTier(display, code)).toBe(2);
  });

  it('underscore false-negative regression: separators normalize on BOTH sides', () => {
    // Old substring logic returned NO match for every one of these.
    expect(subjectMatchTier('Social Studies', 'social_studies')).toBe(2);
    expect(subjectMatchTier('social_studies', 'social_studies')).toBe(2);
    expect(subjectMatchTier('Business  Studies', 'business_studies')).toBe(2);
    expect(subjectMatchTier('POLITICAL_SCIENCE', 'political_science')).toBe(2);
    expect(subjectMatchTier(' Computer Science ', 'computer_science')).toBe(2);
  });
});

describe('subjectMatchTier — tier 1 (token-boundary partial match)', () => {
  const partialPairs: Array<[string, string]> = [
    ['math', 'Mathematics'],            // token-start prefix
    ['math', 'Maths'],                  // common Indian usage
    ['math', 'Mathematics Standard'],   // CBSE grade-10 variant
    ['math', 'Mathematics Basic'],
    ['english', 'English Core'],        // CBSE 11-12
    ['english', 'Eng'],                 // abbreviation (class side shorter)
    ['hindi', 'Hindi B'],               // CBSE Hindi A/B
    ['science', 'Science & Technology'],
    ['social_studies', 'Social Studies & Civics'],
    ['economics', 'Eco'],
    ['computer_science', 'Computers'],  // bidirectional token prefix
    ['biology', 'Bio'],
  ];
  it.each(partialPairs)('code %s ~ class "%s" → tier 1', (code, display) => {
    expect(subjectMatchTier(display, code)).toBe(1);
  });
});

describe('subjectMatchTier — tier 0 (no match: substring containment is dead)', () => {
  const noMatchPairs: Array<[string, string]> = [
    // THE blocking false positive: 'science' must never match inside a
    // multi-token subject whose leading token differs.
    ['science', 'Social Science'],
    ['science', 'Political Science'],
    ['science', 'Computer Science'],
    ['science', 'Environmental Science'],
    // Code side multi-token, class side a different single token.
    ['social_studies', 'Science'],
    ['political_science', 'Science'],
    // Same leading token but diverging second token.
    ['social_studies', 'Social Science'], // documented limitation — alias mapping is out of scope
    ['business_studies', 'Business Economics'],
    // Unrelated subjects sharing a 2-letter prefix-ish shape.
    ['hindi', 'History'],
    ['history', 'Hindi'],
    ['math', 'Science'],
    ['physics', 'Physical Education'],
  ];
  it.each(noMatchPairs)('code %s vs class "%s" → tier 0', (code, display) => {
    expect(subjectMatchTier(display, code)).toBe(0);
  });

  it('null / blank inputs → tier 0', () => {
    expect(subjectMatchTier(null, 'math')).toBe(0);
    expect(subjectMatchTier('', 'math')).toBe(0);
    expect(subjectMatchTier('   ', 'math')).toBe(0);
    expect(subjectMatchTier('Math', '')).toBe(0);
    expect(subjectMatchTier('Math', '  _ ')).toBe(0);
  });
});

describe('subjectMatchTier — tier ORDERING (exact beats partial beats none)', () => {
  it('exact (2) > partial (1) > none (0) for the same code', () => {
    const code = 'social_studies';
    const exact = subjectMatchTier('Social Studies', code);
    const partial = subjectMatchTier('Social Studies & Civics', code);
    const none = subjectMatchTier('Social Science', code);
    expect(exact).toBe(2);
    expect(partial).toBe(1);
    expect(none).toBe(0);
    expect(exact).toBeGreaterThan(partial);
    expect(partial).toBeGreaterThan(none);
  });
});
