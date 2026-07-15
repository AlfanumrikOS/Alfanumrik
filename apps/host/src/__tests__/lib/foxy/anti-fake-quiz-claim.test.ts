// apps/host/src/__tests__/lib/foxy/anti-fake-quiz-claim.test.ts
//
// REG-248 (unit half) — the UNCONDITIONAL, flag-independent anti-fake-quiz-claim
// backstop. Locks the pure detector `stripFakeQuizClaim(text)`:
//
//   • A "generated / created / prepared / here are N questions"-style claim that
//     carries NO real question content (< 3 MCQ option markers AND < 2 question
//     marks) is CLAIM-ONLY → replaced with the graceful bilingual fallback.
//   • The SAME claim BACKED by real rendered questions (A)/B)/C)/D) markers, or
//     multiple inline "?" ) passes through UNTOUCHED (never stripped).
//   • Detection is EN + Hindi/Devanagari (danda-aware) and defensive on non-string.
//
// This is the NEW backstop assessment gave APPROVE-WITH-CONDITIONS on. REG-245
// covers only the flag-ON real-practice path; this file + its siblings cover the
// flag-OFF / legacy backstop that runs regardless of any feature flag.
//
// Owner: ai-engineer. Reviewers: assessment (fallback copy + the two intentional
// narrow false-positive boundaries), testing (this file). Pure-module test — no
// route / DB / Claude imports.

import { describe, it, expect } from 'vitest';
import {
  stripFakeQuizClaim,
  QUIZ_CLAIM_FALLBACK_TEXT,
} from '@alfanumrik/lib/foxy/anti-fake-quiz-claim';

// A real rendered question set: a claim sentence PLUS actual lettered options.
// This is the shape renderQuizQuestionsText / a gated practice turn produces.
const REAL_QUESTION_SET =
  'Here are 4 practice questions — attempt them, then check the answers below.\n' +
  '1. What is the powerhouse of the cell?\n' +
  '   A) Nucleus\n' +
  '   B) Mitochondria\n' +
  '   C) Ribosome\n' +
  '   D) Golgi body\n\n' +
  'Answers / उत्तर:\n1. B — Mitochondria produce ATP.';

describe('stripFakeQuizClaim — claim-only quiz meta-claim is stripped to the fallback', () => {
  it('EN "Generated 5 quiz questions." with no options → claimOnly, replaced by the bilingual fallback', () => {
    const result = stripFakeQuizClaim('Generated 5 quiz questions.');
    expect(result.claimOnly).toBe(true);
    // The caller must surface the graceful bilingual fallback, NOT the claim.
    expect(result.text).toBe(QUIZ_CLAIM_FALLBACK_TEXT);
    expect(result.text).not.toContain('Generated 5');
  });

  it('EN "I have created a quiz with 5 questions" (quiz-qualified) with no options → claimOnly', () => {
    const result = stripFakeQuizClaim('I have created a quiz with 5 questions for you.');
    expect(result.claimOnly).toBe(true);
    expect(result.text).toBe(QUIZ_CLAIM_FALLBACK_TEXT);
  });

  it('Hindi "5 प्रश्न बनाए।" claim-only (danda-aware) → claimOnly, replaced by the fallback', () => {
    const result = stripFakeQuizClaim('5 प्रश्न बनाए।');
    expect(result.claimOnly).toBe(true);
    expect(result.text).toBe(QUIZ_CLAIM_FALLBACK_TEXT);
  });
});

describe('stripFakeQuizClaim — real question content passes through UNTOUCHED', () => {
  it('the SAME "Here are N questions" claim BACKED by A)/B)/C)/D) options is NOT stripped', () => {
    const result = stripFakeQuizClaim(REAL_QUESTION_SET);
    expect(result.claimOnly).toBe(false);
    // Passes through byte-identical — genuine quiz content is never rewritten.
    expect(result.text).toBe(REAL_QUESTION_SET);
  });

  it('normal teaching prose (no quiz claim) is NOT stripped', () => {
    const prose =
      'Photosynthesis is the process by which green plants make food using ' +
      'sunlight. Let me walk you through the steps one at a time.';
    const result = stripFakeQuizClaim(prose);
    expect(result.claimOnly).toBe(false);
    expect(result.text).toBe(prose);
  });

  it('empty / whitespace / non-string input is defensively NOT claim-only', () => {
    expect(stripFakeQuizClaim('').claimOnly).toBe(false);
    expect(stripFakeQuizClaim('   \n  ').claimOnly).toBe(false);
    // never throws on non-string; returns a safe passthrough
    expect(stripFakeQuizClaim(undefined as unknown as string).claimOnly).toBe(false);
    expect(stripFakeQuizClaim(null as unknown as string).claimOnly).toBe(false);
    expect(stripFakeQuizClaim(42 as unknown as string).claimOnly).toBe(false);
  });
});

describe('stripFakeQuizClaim — the two INTENTIONAL narrow false-positive boundaries (assessment-flagged, documented)', () => {
  // BOUNDARY 1 — "≤2 imperative numbered questions after a claim".
  // The evidence detector needs >=3 option markers OR >=2 "?" to treat a claim as
  // backed by real questions. A claim followed by only TWO numbered imperatives
  // (no "?") has just 2 markers and 0 question marks, so it stays CLAIM-ONLY and
  // is stripped. Assessment accepts this as an intentional narrow false positive:
  // two bare imperatives with no "?" are indistinguishable from a padded claim,
  // and over-stripping here is strictly safer than shipping a claim-with-no-quiz.
  it('a claim + exactly TWO numbered imperative questions (no "?") is STILL stripped (documented intentional FP)', () => {
    const twoNumbered =
      'I created 2 practice questions.\n' +
      '1. Define photosynthesis.\n' +
      '2. State Newtons first law.';
    const result = stripFakeQuizClaim(twoNumbered);
    expect(result.claimOnly).toBe(true);
    expect(result.text).toBe(QUIZ_CLAIM_FALLBACK_TEXT);
  });

  // BOUNDARY 2 — "Devanagari-lettered evidence".
  // The option-marker detector recognizes only Latin A-D / a-d / 1-4 markers, so a
  // Hindi claim whose real options are lettered in Devanagari (क)/ख)/ग)/घ)) is not
  // seen as backed and stays CLAIM-ONLY. Assessment accepts this as an intentional
  // narrow false positive: Foxy renders lettered options in Latin (A)-D)), so a
  // Devanagari-lettered set is not a shape the real renderer emits, and stripping
  // it is safe. Pinned so any future widening of the evidence detector is a
  // deliberate, reviewed change — not an accident.
  it('a Hindi claim + Devanagari-lettered options (क)/ख)/ग)/घ)) is STILL stripped (documented intentional FP)', () => {
    const devanagariLettered =
      '5 प्रश्न बनाए।\n' +
      'क) पहला विकल्प\n' +
      'ख) दूसरा विकल्प\n' +
      'ग) तीसरा विकल्प\n' +
      'घ) चौथा विकल्प';
    const result = stripFakeQuizClaim(devanagariLettered);
    expect(result.claimOnly).toBe(true);
    expect(result.text).toBe(QUIZ_CLAIM_FALLBACK_TEXT);
  });
});

describe('QUIZ_CLAIM_FALLBACK_TEXT — graceful bilingual (P7) fallback, no fake claim', () => {
  it('is bilingual (EN + Devanagari) and never claims produced questions', () => {
    expect(QUIZ_CLAIM_FALLBACK_TEXT).toMatch(/[A-Za-z]/); // English
    expect(QUIZ_CLAIM_FALLBACK_TEXT).toMatch(/[ऀ-ॿ]/); // Devanagari
    // The fallback itself must NOT read as a quiz claim (else it would be stripped
    // in a loop). Feeding it back through the detector is a stable no-op.
    expect(stripFakeQuizClaim(QUIZ_CLAIM_FALLBACK_TEXT).claimOnly).toBe(false);
  });
});
