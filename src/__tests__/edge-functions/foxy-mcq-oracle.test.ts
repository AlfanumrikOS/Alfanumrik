/**
 * REG-56 — Foxy inline MCQ candidates pass the quiz-oracle gate before
 * reaching students (P12 AI safety, P6 question quality).
 *
 * The Marking-Authenticity Wave 2 wired `supabase/functions/foxy-tutor`
 * to run every parsed inline MCQ through the same oracle pipeline used by
 * `bulk-question-gen` (deterministic P6 checks + LLM-grader). Failures
 * cause the MCQ to be DROPPED from the response (the prose answer still
 * ships); telemetry records the rejection category.
 *
 * Strategy: static-source inspection. We pin:
 *   1. foxy-tutor imports `validateCandidate` from `_shared/quiz-oracle.ts`
 *   2. The MCQ branch only emits `inlineMcq` when the oracle returns ok.
 *   3. On reject (or oracle-throw), the MCQ is dropped and a
 *      `foxy_oracle_blocked` PostHog event fires.
 *   4. The `mcq` block schema in `src/lib/foxy/schema.ts` requires
 *      4 distinct options and `correct_answer_index` ∈ 0..3.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { FoxyBlockSchema } from '@/lib/foxy/schema';

const FOXY_TUTOR_PATH = resolve(
  process.cwd(),
  'supabase/functions/foxy-tutor/index.ts',
);
const SCHEMA_PATH = resolve(process.cwd(), 'src/lib/foxy/schema.ts');

describe('REG-56 — Foxy MCQ oracle gate (foxy-tutor)', () => {
  it('foxy-tutor/index.ts exists', () => {
    expect(existsSync(FOXY_TUTOR_PATH)).toBe(true);
  });

  it('imports validateCandidate from the shared quiz-oracle module', () => {
    const src = readFileSync(FOXY_TUTOR_PATH, 'utf8');
    // The oracle module is the single source of truth (pinned by REG-54).
    expect(src).toMatch(/validateCandidate/);
    // Must come from the SAME shared module that bulk-question-gen uses.
    expect(src).toMatch(/_shared\/quiz-oracle/);
  });

  it('runs the oracle gate before emitting an inline MCQ', () => {
    const src = readFileSync(FOXY_TUTOR_PATH, 'utf8');
    // Pin the dispatch: gateMcqWithOracle must be called and its verdict
    // checked. This is the structural canary — if the verdict check is
    // removed (or the gate is bypassed), this regex fails.
    expect(src).toMatch(/gateMcqWithOracle\s*\(/);
    expect(src).toMatch(/verdict\.ok/);
  });

  it('drops the MCQ AND emits foxy_oracle_blocked when the oracle rejects', () => {
    const src = readFileSync(FOXY_TUTOR_PATH, 'utf8');

    // Reject-branch must call posthogCapture('foxy_oracle_blocked', ...)
    // with source='foxy-tutor'. This event powers the AI health panel.
    expect(src).toContain("'foxy_oracle_blocked'");
    expect(src).toContain("source: 'foxy-tutor'");
    // The category from the verdict is forwarded for facetable rejection
    // analysis (matches the OracleRejectionCategory union pinned by REG-54).
    expect(src).toMatch(/category:\s*verdict\.category/);
  });

  it('fails CLOSED when the oracle gate throws (P12 spirit)', () => {
    const src = readFileSync(FOXY_TUTOR_PATH, 'utf8');
    // The catch block must drop the MCQ AND emit a llm_grader_unavailable
    // telemetry event — never silently re-emit the MCQ.
    expect(src).toMatch(/oracleErr/);
    expect(src).toContain("category: 'llm_grader_unavailable'");
  });

  it('only attempts MCQ extraction in quiz/practice modes (dosage cap)', () => {
    const src = readFileSync(FOXY_TUTOR_PATH, 'utf8');
    // Cost ceiling (per REG-54 strategy): 1 oracle call per accepted MCQ;
    // foxy-tutor must not extract MCQs from learn/revision/doubt modes.
    expect(src).toMatch(/safeMode\s*===\s*'quiz'\s*\|\|\s*safeMode\s*===\s*'practice'/);
  });
});

describe('REG-56 — FoxyBlockSchema MCQ shape (P6 question quality)', () => {
  it('foxy/schema.ts exists', () => {
    expect(existsSync(SCHEMA_PATH)).toBe(true);
  });

  it('accepts a well-formed mcq block with 4 distinct options and index 0..3', () => {
    const block = {
      type: 'mcq',
      stem: 'What is 2 + 2?',
      options: ['1', '2', '3', '4'],
      correct_answer_index: 3,
      explanation: '2 + 2 equals 4 because addition combines two equal twos.',
    };
    const result = FoxyBlockSchema.safeParse(block);
    expect(result.success).toBe(true);
  });

  it('rejects an mcq block with fewer than 4 options', () => {
    const block = {
      type: 'mcq',
      stem: 'What is 2 + 2?',
      options: ['1', '2', '3'],
      correct_answer_index: 2,
      explanation: 'Only three options.',
    };
    const result = FoxyBlockSchema.safeParse(block);
    expect(result.success).toBe(false);
  });

  it('rejects an mcq block with correct_answer_index outside 0..3', () => {
    const block = {
      type: 'mcq',
      stem: 'What is 2 + 2?',
      options: ['1', '2', '3', '4'],
      correct_answer_index: 4,
      explanation: 'Out of range index.',
    };
    const result = FoxyBlockSchema.safeParse(block);
    expect(result.success).toBe(false);
  });

  it('rejects an mcq block with duplicate options (P6 distinctness)', () => {
    const block = {
      type: 'mcq',
      stem: 'What is 2 + 2?',
      options: ['4', '4', '4', '4'],
      correct_answer_index: 0,
      explanation: 'All same options.',
    };
    const result = FoxyBlockSchema.safeParse(block);
    expect(result.success).toBe(false);
  });

  it('rejects an mcq block with empty explanation', () => {
    const block = {
      type: 'mcq',
      stem: 'What is 2 + 2?',
      options: ['1', '2', '3', '4'],
      correct_answer_index: 3,
      explanation: '',
    };
    const result = FoxyBlockSchema.safeParse(block);
    expect(result.success).toBe(false);
  });

  it('rejects an mcq block with empty stem', () => {
    const block = {
      type: 'mcq',
      stem: '',
      options: ['1', '2', '3', '4'],
      correct_answer_index: 0,
      explanation: 'Some explanation here.',
    };
    const result = FoxyBlockSchema.safeParse(block);
    expect(result.success).toBe(false);
  });

  it('rejects non-integer correct_answer_index', () => {
    const block = {
      type: 'mcq',
      stem: 'What is 2 + 2?',
      options: ['1', '2', '3', '4'],
      correct_answer_index: 1.5,
      explanation: 'Some explanation here.',
    };
    const result = FoxyBlockSchema.safeParse(block);
    expect(result.success).toBe(false);
  });
});
