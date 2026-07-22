// apps/host/src/__tests__/lib/ai/validation/synthesis-oracle.test.ts
//
// Item 4.2/4.5 (2026-07-21) — Monthly Synthesis parent-summary fabrication
// oracle. Pure-module tests — no route/DB/Claude imports.
//
// Covers all four responsibilities of packages/lib/src/ai/validation/
// synthesis-oracle.ts:
//   1. Fabrication check (numbers + chapter/topic names)
//   2. Word-cap enforcement (sentence-boundary-aware truncation)
//   3. Template-only fallback (never leaves the summary empty)
//   4. Circuit breaker (same closed/open/half-open pattern as
//      parent-report-generator/index.ts)
//
// Owner: ai-engineer. Reviewer: assessment (fabrication/quality bar correctness).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  extractNumbers,
  collectAllowedNumbers,
  checkNumberFabrication,
  extractCandidateTopicPhrases,
  checkTopicFabrication,
  countWords,
  enforceWordCap,
  SYNTHESIS_WORD_CAP,
  SYNTHESIS_WORD_CAP_HARD_CEILING,
  validateSynthesisSummary,
  buildSynthesisFallbackSummary,
  createSynthesisCircuitBreaker,
  SYNTHESIS_CB_FAILURE_THRESHOLD,
  SYNTHESIS_CB_RESET_TIMEOUT_MS,
} from '@alfanumrik/lib/ai/validation/synthesis-oracle';
import type { SynthesisBundle } from '@alfanumrik/lib/learn/monthly-synthesis-orchestrator';

function makeBundle(overrides: Partial<SynthesisBundle> = {}): SynthesisBundle {
  return {
    monthLabel: '2026-06',
    weeklyArtifactIds: ['artifact-1', 'artifact-2'],
    masteryDelta: {
      chaptersTouched: ['Motion', 'Force and Laws of Motion'],
      topicsMastered: 3,
      topicsImproved: 5,
      topicsRegressed: 1,
    },
    chapterMockSummary: {
      chapters: ['Motion', 'Force and Laws of Motion'],
      totalQuestions: 8,
      targetDifficulty: 0.55,
    },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 1a. Numeric fabrication
// ─────────────────────────────────────────────────────────────────────────

describe('extractNumbers', () => {
  it('extracts integers and decimals', () => {
    expect(extractNumbers('mastered 3 topics, 55.5% ready')).toEqual([3, 55.5]);
  });

  it('normalises Devanagari digits to ASCII', () => {
    expect(extractNumbers('५ अध्याय पढ़े')).toEqual([5]);
  });

  it('returns [] for text with no numbers', () => {
    expect(extractNumbers('Great progress this month!')).toEqual([]);
  });
});

describe('collectAllowedNumbers', () => {
  it('harvests numbers from every nested field, including inside string chapter titles', () => {
    const bundle = makeBundle({
      masteryDelta: {
        chaptersTouched: ['Chapter 5: Motion'],
        topicsMastered: 3,
        topicsImproved: 5,
        topicsRegressed: 1,
      },
    });
    const allowed = collectAllowedNumbers(bundle);
    expect(allowed.has(5)).toBe(true); // from "Chapter 5"
    expect(allowed.has(3)).toBe(true); // topicsMastered
    expect(allowed.has(1)).toBe(true); // topicsRegressed
    expect(allowed.has(8)).toBe(true); // chapterMockSummary.totalQuestions
  });

  it('allows the rounded-percent form of a fractional value (targetDifficulty)', () => {
    const bundle = makeBundle();
    const allowed = collectAllowedNumbers(bundle);
    expect(allowed.has(55)).toBe(true); // Math.round(0.55 * 100)
  });

  it('allows the year and month components of monthLabel', () => {
    const bundle = makeBundle({ monthLabel: '2026-06' });
    const allowed = collectAllowedNumbers(bundle);
    expect(allowed.has(2026)).toBe(true);
    expect(allowed.has(6)).toBe(true);
  });

  // Bug 1 regression (assessment rejection, 2026-07-21): weeklyArtifactIds
  // are opaque Postgres UUID primary keys in production, not human-authored
  // text. Walking them for numeric substrings would legitimise random noise
  // (e.g. "8400" inside "550e8400-...") as a "backed" fact.
  it('does NOT harvest numbers from inside weeklyArtifactIds UUID strings', () => {
    const bundle = makeBundle({
      weeklyArtifactIds: ['550e8400-e29b-41d4-a716-446655440000'],
    });
    const allowed = collectAllowedNumbers(bundle);
    // 8400 is a hex substring of the UUID, not a real fact — must NOT be
    // silently allowed just because it appears inside the id string.
    expect(allowed.has(8400)).toBe(false);
    expect(allowed.has(41)).toBe(false);
    expect(allowed.has(446655440000)).toBe(false);
  });

  it('still allows the artifact COUNT explicitly (the prompt cites "{artifactCount} weekly artifacts")', () => {
    const bundle = makeBundle({
      weeklyArtifactIds: [
        '550e8400-e29b-41d4-a716-446655440000',
        '660f9511-f3ac-52e5-b827-557766551111',
        '771a0622-04bd-63f6-c938-668877662222',
      ],
    });
    const allowed = collectAllowedNumbers(bundle);
    expect(allowed.has(3)).toBe(true); // weeklyArtifactIds.length, not walked from the id text
  });

  // Bug 2 regression (assessment rejection, 2026-07-21): the prompt hands
  // Claude "Student: {name} (Grade {grade})" as direct context, but grade is
  // not part of SynthesisBundle. Passing studentGrade must allowlist EXACTLY
  // that value — not every small number.
  it('allows the student grade only when explicitly passed as context', () => {
    // 9 does not appear anywhere in the default bundle (topicsMastered=3,
    // topicsImproved=5, topicsRegressed=1, totalQuestions=8, month=2026-06,
    // artifact count=2, rounded-percent=55) — a clean value to probe with.
    const bundle = makeBundle();
    const withoutGrade = collectAllowedNumbers(bundle);
    expect(withoutGrade.has(9)).toBe(false);

    const withGrade = collectAllowedNumbers(bundle, { studentGrade: '9' });
    expect(withGrade.has(9)).toBe(true);
    // A DIFFERENT grade must not be allowed as a side effect — this is not a
    // wildcard "small numbers are fine" allowance.
    expect(withGrade.has(10)).toBe(false);
    expect(withGrade.has(11)).toBe(false);
  });
});

describe('checkNumberFabrication', () => {
  it('passes when every mentioned number is backed by the bundle', () => {
    const bundle = makeBundle();
    const result = checkNumberFabrication(
      'This month, Asha mastered 3 topics and improved on 5 more.',
      bundle,
    );
    expect(result.ok).toBe(true);
  });

  it('rejects a number with no basis anywhere in the bundle', () => {
    const bundle = makeBundle();
    const result = checkNumberFabrication(
      'Asha completed 47 quizzes this month!',
      bundle,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.unbackedNumbers).toContain(47);
      // P13-safe: reason is a count/category description, never a quoted excerpt.
      expect(result.reason).not.toContain('Asha');
    }
  });

  it('passes on empty text', () => {
    expect(checkNumberFabrication('', makeBundle()).ok).toBe(true);
  });

  it('catches fabrication in Hindi (Devanagari digit) text too', () => {
    const bundle = makeBundle();
    const result = checkNumberFabrication('आशा ने ९९ प्रश्न हल किए', bundle);
    expect(result.ok).toBe(false);
  });

  // Bug 1 regression, end-to-end probe (assessment's exact scenario): a
  // hallucinated number that coincidentally matches a hex substring inside
  // one of the month's weeklyArtifactIds UUIDs must be flagged, not silently
  // waved through as "backed by the bundle".
  it('flags a hallucinated number that coincidentally matches a hex substring inside a weeklyArtifactIds UUID', () => {
    const bundle = makeBundle({
      weeklyArtifactIds: ['550e8400-e29b-41d4-a716-446655440000'],
    });
    const result = checkNumberFabrication('Asha completed 8400 practice questions this month!', bundle);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.unbackedNumbers).toContain(8400);
  });

  // Bug 2 regression, end-to-end probe: a summary that naturally restates
  // the student's real grade must pass once the grade is supplied as
  // context — this is the exact context the prompt hands Claude directly.
  it('passes when the summary restates the student\'s real grade and grade context is supplied', () => {
    const bundle = makeBundle();
    const result = checkNumberFabrication(
      'As a Grade 8 student, Asha mastered 3 topics and improved on 5 more.',
      bundle,
      { studentGrade: '8' },
    );
    expect(result.ok).toBe(true);
  });

  it('still flags the grade number when grade context is NOT supplied (no silent global allowance)', () => {
    // Use Grade 9 (not 8) — 8 is already backed by chapterMockSummary.totalQuestions
    // in the default bundle, so it would pass regardless; 9 appears nowhere.
    const bundle = makeBundle();
    const result = checkNumberFabrication('As a Grade 9 student, Asha had a great month.', bundle);
    expect(result.ok).toBe(false);
  });

  it('does not allow a DIFFERENT grade than the one actually supplied as context', () => {
    const bundle = makeBundle();
    // Student is really Grade 9, but the generated text hallucinates Grade 10.
    const result = checkNumberFabrication(
      'As a Grade 10 student, Asha had a great month.',
      bundle,
      { studentGrade: '9' },
    );
    expect(result.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 1b. Topic/name fabrication
// ─────────────────────────────────────────────────────────────────────────

describe('extractCandidateTopicPhrases', () => {
  it('extracts a phrase following the word "chapter"', () => {
    const phrases = extractCandidateTopicPhrases('You did great in chapter Photosynthesis this month.');
    expect(phrases.some((p) => p.toLowerCase().includes('photosynthesis'))).toBe(true);
  });

  it('extracts a quoted phrase', () => {
    const phrases = extractCandidateTopicPhrases('Great work on "Trigonometric Identities" this month.');
    expect(phrases).toContain('Trigonometric Identities');
  });

  it('returns [] for plain prose with no chapter/topic/quote markers', () => {
    expect(extractCandidateTopicPhrases('Asha had a great month overall.')).toEqual([]);
  });
});

describe('checkTopicFabrication', () => {
  it('passes when the referenced chapter overlaps the bundle chapters', () => {
    const bundle = makeBundle();
    const result = checkTopicFabrication(
      'Great progress in chapter Motion this month.',
      bundle,
    );
    expect(result.ok).toBe(true);
  });

  it('passes when no candidate phrases are present', () => {
    expect(checkTopicFabrication('Asha had a great month overall.', makeBundle()).ok).toBe(true);
  });

  it('rejects a chapter/topic name with zero overlap against the bundle', () => {
    const bundle = makeBundle();
    const result = checkTopicFabrication(
      'Great progress in chapter Thermodynamics and Nuclear Physics this month.',
      bundle,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.unbackedPhrases?.length).toBeGreaterThan(0);
    }
  });

  it('rejects ANY chapter/topic citation when the bundle has no chapters touched (light month)', () => {
    const emptyBundle = makeBundle({
      masteryDelta: { chaptersTouched: [], topicsMastered: 0, topicsImproved: 0, topicsRegressed: 0 },
      chapterMockSummary: null,
    });
    const result = checkTopicFabrication('Great progress in chapter Motion this month.', emptyBundle);
    expect(result.ok).toBe(false);
  });

  it('treats the student name as a legitimate (non-fabricated) mention', () => {
    const bundle = makeBundle();
    const result = checkTopicFabrication('"Asha" had a wonderful month.', bundle, 'Asha');
    expect(result.ok).toBe(true);
  });

  it('does not crash on a partial/legacy bundle shape missing masteryDelta/chapterMockSummary', () => {
    const partial = { monthLabel: '2026-06' } as unknown as SynthesisBundle;
    expect(() => checkTopicFabrication('chapter Motion was great', partial)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2. Word-cap enforcement
// ─────────────────────────────────────────────────────────────────────────

describe('countWords / enforceWordCap', () => {
  it('countWords counts whitespace-separated tokens', () => {
    expect(countWords('one two three')).toBe(3);
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
  });

  it('leaves text untouched when at or under the hard ceiling', () => {
    const text = Array(SYNTHESIS_WORD_CAP_HARD_CEILING).fill('word').join(' ') + '.';
    const result = enforceWordCap(text);
    expect(result.wasTruncated).toBe(false);
    expect(result.text).toBe(text);
  });

  it('truncates over-length text at a sentence boundary within the cap', () => {
    // Build text with clean sentence boundaries every 10 words, well past
    // the hard ceiling.
    const sentence = 'This is one clean sentence with exactly ten words total.';
    const longText = Array(50).fill(sentence).join(' '); // ~500 words
    const result = enforceWordCap(longText);
    expect(result.wasTruncated).toBe(true);
    expect(countWords(result.text)).toBeLessThanOrEqual(SYNTHESIS_WORD_CAP);
    // Must end on a sentence boundary, not mid-sentence.
    expect(/[.!?।॥]$/.test(result.text.trim())).toBe(true);
  });

  it('hard-cuts at the cap when no usable sentence boundary exists early enough', () => {
    const longText = Array(500).fill('word').join(' '); // no punctuation at all
    const result = enforceWordCap(longText);
    expect(result.wasTruncated).toBe(true);
    expect(countWords(result.text)).toBeLessThanOrEqual(SYNTHESIS_WORD_CAP);
  });

  it('recognises the Hindi purna viram (।) as a sentence boundary', () => {
    const sentence = 'यह एक वाक्य है और इसमें दस शब्द हैं आज।';
    const longText = Array(50).fill(sentence).join(' ');
    const result = enforceWordCap(longText);
    expect(result.wasTruncated).toBe(true);
    expect(result.text.trim().endsWith('।')).toBe(true);
  });

  it('handles empty text without throwing', () => {
    expect(enforceWordCap('')).toEqual({ text: '', wasTruncated: false });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3. Combined oracle entry point
// ─────────────────────────────────────────────────────────────────────────

describe('validateSynthesisSummary', () => {
  it('approves a clean, bundle-backed bilingual summary and applies word-cap pass-through', () => {
    const bundle = makeBundle();
    const result = validateSynthesisSummary({
      textEn: 'Asha mastered 3 topics and improved on 5 more, covering Motion this month.',
      textHi: 'आशा ने इस महीने Motion अध्याय में 3 विषयों में महारत हासिल की।',
      bundle,
      studentName: 'Asha',
    });
    expect(result.ok).toBe(true);
    expect(result.wasTruncatedEn).toBe(false);
    expect(result.wasTruncatedHi).toBe(false);
  });

  it('rejects when EN text has a fabricated number, even if HI text is clean', () => {
    const bundle = makeBundle();
    const result = validateSynthesisSummary({
      textEn: 'Asha completed 999 quizzes this month!',
      textHi: 'आशा ने इस महीने अच्छी प्रगति की।',
      bundle,
      studentName: 'Asha',
    });
    expect(result.ok).toBe(false);
    expect(result.rejectionCategory).toBe('fabricated_number');
    // On rejection both languages are dropped together (never a mixed
    // personalised-EN + generic-HI pair).
    expect(result.textEn).toBe('');
    expect(result.textHi).toBe('');
  });

  it('rejects when EN text names an unbacked chapter', () => {
    const bundle = makeBundle();
    const result = validateSynthesisSummary({
      textEn: 'Great work in chapter Quantum Mechanics this month!',
      textHi: 'आशा ने इस महीने अच्छी प्रगति की।',
      bundle,
      studentName: 'Asha',
    });
    expect(result.ok).toBe(false);
    expect(result.rejectionCategory).toBe('fabricated_topic');
  });

  it('P13: rejectionReason never contains the student name', () => {
    const bundle = makeBundle();
    const result = validateSynthesisSummary({
      textEn: 'Asha completed 999 quizzes this month!',
      textHi: '',
      bundle,
      studentName: 'Asha',
    });
    expect(result.ok).toBe(false);
    expect(result.rejectionReason).not.toContain('Asha');
  });

  // Bug 1 regression at the full oracle entry point: a hallucinated number
  // that happens to match a hex substring inside a weeklyArtifactIds UUID
  // must be rejected, not silently approved.
  it('rejects a summary whose only "backing" for a fabricated number is a UUID hex substring', () => {
    const bundle = makeBundle({
      weeklyArtifactIds: ['550e8400-e29b-41d4-a716-446655440000'],
    });
    const result = validateSynthesisSummary({
      textEn: 'Asha completed 8400 practice questions this month!',
      textHi: 'आशा ने इस महीने अच्छी प्रगति की।',
      bundle,
      studentName: 'Asha',
    });
    expect(result.ok).toBe(false);
    expect(result.rejectionCategory).toBe('fabricated_number');
  });

  // Bug 2 regression at the full oracle entry point: a genuinely accurate,
  // bundle-backed summary that naturally mentions "Grade {grade}" must pass
  // once studentGrade is threaded through, not be discarded to the generic
  // template purely because the grade number isn't part of the bundle.
  it('approves a summary that naturally mentions the student\'s real grade when studentGrade is supplied', () => {
    // Grade 11 does not appear anywhere in the default bundle (unlike 8,
    // which coincidentally matches chapterMockSummary.totalQuestions) — this
    // isolates the fix rather than riding on a pre-existing coincidence.
    const bundle = makeBundle();
    const result = validateSynthesisSummary({
      textEn: 'As a Grade 11 student, Asha mastered 3 topics and improved on 5 more, covering Motion this month.',
      textHi: 'कक्षा 11 की छात्रा आशा ने इस महीने Motion अध्याय में 3 विषयों में महारत हासिल की।',
      bundle,
      studentName: 'Asha',
      studentGrade: '11',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects that same real-grade mention when studentGrade context is NOT supplied (proves the fix is load-bearing)', () => {
    const bundle = makeBundle();
    const result = validateSynthesisSummary({
      textEn: 'As a Grade 11 student, Asha mastered 3 topics and improved on 5 more, covering Motion this month.',
      textHi: 'कक्षा 11 की छात्रा आशा ने इस महीने Motion अध्याय में 3 विषयों में महारत हासिल की।',
      bundle,
      studentName: 'Asha',
    });
    expect(result.ok).toBe(false);
    expect(result.rejectionCategory).toBe('fabricated_number');
  });

  it('does not use studentGrade as a wildcard — a different hallucinated grade still fails', () => {
    const bundle = makeBundle();
    const result = validateSynthesisSummary({
      textEn: 'As a Grade 11 student, Asha mastered 3 topics and improved on 5 more.',
      textHi: 'आशा ने इस महीने अच्छी प्रगति की।',
      bundle,
      studentName: 'Asha',
      studentGrade: '8',
    });
    expect(result.ok).toBe(false);
    expect(result.rejectionCategory).toBe('fabricated_number');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 4. Template-only fallback
// ─────────────────────────────────────────────────────────────────────────

describe('buildSynthesisFallbackSummary', () => {
  it('produces a non-empty bilingual summary purely from bundle fields', () => {
    const bundle = makeBundle();
    const result = buildSynthesisFallbackSummary({ studentName: 'Asha', bundle });
    expect(result.textEn.length).toBeGreaterThan(0);
    expect(result.textHi.length).toBeGreaterThan(0);
    expect(result.textEn).toContain('Asha');
    expect(result.textEn).toContain('3'); // topicsMastered
  });

  it('never mentions "0" dishonestly — states light-month status when no chapters touched', () => {
    const bundle = makeBundle({
      masteryDelta: { chaptersTouched: [], topicsMastered: 0, topicsImproved: 0, topicsRegressed: 0 },
      weeklyArtifactIds: [],
      chapterMockSummary: null,
    });
    const result = buildSynthesisFallbackSummary({ studentName: 'Asha', bundle });
    expect(result.textEn).toMatch(/lighter month/i);
    expect(result.textEn.length).toBeGreaterThan(0);
  });

  it('does not crash on a partial/legacy bundle shape', () => {
    const partial = { monthLabel: '2026-06' } as unknown as SynthesisBundle;
    expect(() => buildSynthesisFallbackSummary({ studentName: 'Asha', bundle: partial })).not.toThrow();
    const result = buildSynthesisFallbackSummary({ studentName: 'Asha', bundle: partial });
    expect(result.textEn.length).toBeGreaterThan(0);
  });

  it('falls back to a generic name when studentName is empty', () => {
    const bundle = makeBundle();
    const result = buildSynthesisFallbackSummary({ studentName: '', bundle });
    expect(result.textEn).toContain('Your child');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 5. Circuit breaker
// ─────────────────────────────────────────────────────────────────────────

describe('createSynthesisCircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts closed and allows requests', () => {
    const cb = createSynthesisCircuitBreaker();
    expect(cb.canRequest()).toBe(true);
    expect(cb.getState().state).toBe('closed');
  });

  it('opens after reaching the failure threshold', () => {
    const cb = createSynthesisCircuitBreaker({ failureThreshold: 3 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.canRequest()).toBe(true); // still closed, 2 < 3
    cb.recordFailure();
    expect(cb.getState().state).toBe('open');
    expect(cb.canRequest()).toBe(false);
  });

  it('moves to half-open exactly once after the reset window, then closes on success', () => {
    const cb = createSynthesisCircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 30_000 });
    cb.recordFailure();
    expect(cb.getState().state).toBe('open');
    expect(cb.canRequest()).toBe(false);

    // Still within the reset window — stays open.
    vi.advanceTimersByTime(29_999);
    expect(cb.canRequest()).toBe(false);

    // Past the reset window — transitions to half-open and allows exactly
    // one probe.
    vi.advanceTimersByTime(2);
    expect(cb.canRequest()).toBe(true);
    expect(cb.getState().state).toBe('half-open');
    // A second call while still half-open (before recordSuccess/Failure) is
    // NOT allowed — only one probe per open->half-open transition.
    expect(cb.canRequest()).toBe(false);

    cb.recordSuccess();
    expect(cb.getState().state).toBe('closed');
    expect(cb.canRequest()).toBe(true);
  });

  it('re-opens on a failed half-open probe', () => {
    const cb = createSynthesisCircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1_000 });
    cb.recordFailure();
    vi.advanceTimersByTime(1_001);
    expect(cb.canRequest()).toBe(true); // transitions to half-open
    cb.recordFailure(); // probe failed
    expect(cb.getState().state).toBe('open');
    expect(cb.canRequest()).toBe(false);
  });

  it('default singleton uses the parent-report-generator-matching thresholds', () => {
    expect(SYNTHESIS_CB_FAILURE_THRESHOLD).toBe(5);
    expect(SYNTHESIS_CB_RESET_TIMEOUT_MS).toBe(60_000);
  });
});
