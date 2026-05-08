/**
 * B'-1 Phase 1: scoreFoxyAnswer + the pure helpers.
 *
 * Covers the contract: composite blend math, JSON parsing (including
 * fenced and bare-with-noise variants), score clamping, missing/invalid
 * fields, prompt builders.
 *
 * The full Claude API call is not tested here (that's an integration
 * concern; would need a recorded fixture or a live key). Phase 2 will
 * add a manual super-admin "score this message now" trigger that gives
 * us a real-call smoke test.
 */
import { describe, it, expect } from 'vitest';
import {
  buildJudgeSystemPrompt,
  buildJudgeUserMessage,
  computeOverallScore,
  parseJudgeJson,
  RUBRIC_VERSION,
  JUDGE_MODEL,
} from '@/lib/foxy/quality-eval';

describe('computeOverallScore', () => {
  it('blends with documented weights (0.40 / 0.30 / 0.20 / 0.10)', () => {
    const out = computeOverallScore({
      accuracy: 100,
      scaffold_fidelity: 100,
      age_appropriateness: 100,
      cbse_scope: 100,
    });
    expect(out).toBe(100);
  });

  it('returns 0 when all dimensions are 0', () => {
    const out = computeOverallScore({
      accuracy: 0,
      scaffold_fidelity: 0,
      age_appropriateness: 0,
      cbse_scope: 0,
    });
    expect(out).toBe(0);
  });

  it('weights accuracy more than the others', () => {
    // Accuracy 100, rest 0. Should produce ~40 (the accuracy weight).
    const out = computeOverallScore({
      accuracy: 100,
      scaffold_fidelity: 0,
      age_appropriateness: 0,
      cbse_scope: 0,
    });
    expect(out).toBe(40);
  });

  it('clamps to [0, 100] even if inputs somehow drift outside', () => {
    const high = computeOverallScore({
      accuracy: 200,
      scaffold_fidelity: 200,
      age_appropriateness: 200,
      cbse_scope: 200,
    });
    expect(high).toBe(100);

    const low = computeOverallScore({
      accuracy: -50,
      scaffold_fidelity: -50,
      age_appropriateness: -50,
      cbse_scope: -50,
    });
    expect(low).toBe(0);
  });

  it('rounds to int (no float overall)', () => {
    // 33 + 33 + 33 + 33 = ~33 with the weights:
    // 0.4*33 + 0.3*33 + 0.2*33 + 0.1*33 = 33
    const out = computeOverallScore({
      accuracy: 33,
      scaffold_fidelity: 33,
      age_appropriateness: 33,
      cbse_scope: 33,
    });
    expect(Number.isInteger(out)).toBe(true);
    expect(out).toBe(33);
  });
});

describe('parseJudgeJson', () => {
  const validRaw = JSON.stringify({
    accuracy: 90,
    scaffold_fidelity: 80,
    age_appropriateness: 95,
    cbse_scope: 100,
    notes: 'scaffold fidelity is the lowest because the answer skipped the leading sub-question',
  });

  it('parses a clean JSON response', () => {
    const out = parseJudgeJson(validRaw);
    expect(out).not.toBeNull();
    expect(out!.accuracy).toBe(90);
    expect(out!.scaffold_fidelity).toBe(80);
    expect(out!.notes).toMatch(/scaffold fidelity/);
  });

  it('parses a fenced ```json wrap (Sonnet sometimes fences despite instructions)', () => {
    const fenced = '```json\n' + validRaw + '\n```';
    const out = parseJudgeJson(fenced);
    expect(out).not.toBeNull();
    expect(out!.accuracy).toBe(90);
  });

  it('parses a bare ``` fence (no language tag)', () => {
    const fenced = '```\n' + validRaw + '\n```';
    expect(parseJudgeJson(fenced)).not.toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseJudgeJson('{ accuracy: 90 ')).toBeNull();
  });

  it('returns null for empty / non-string input', () => {
    expect(parseJudgeJson('')).toBeNull();
    // @ts-expect-error testing runtime guard
    expect(parseJudgeJson(null)).toBeNull();
    // @ts-expect-error testing runtime guard
    expect(parseJudgeJson(42)).toBeNull();
  });

  it('returns null when a required dimension is missing', () => {
    const partial = JSON.stringify({
      accuracy: 90,
      scaffold_fidelity: 80,
      age_appropriateness: 95,
      // cbse_scope missing
    });
    expect(parseJudgeJson(partial)).toBeNull();
  });

  it('returns null when a dimension is non-numeric', () => {
    const bad = JSON.stringify({
      accuracy: 'high',
      scaffold_fidelity: 80,
      age_appropriateness: 95,
      cbse_scope: 100,
    });
    expect(parseJudgeJson(bad)).toBeNull();
  });

  it('clamps out-of-range scores into [0, 100] (judge mistake protection)', () => {
    const bad = JSON.stringify({
      accuracy: 150,
      scaffold_fidelity: -20,
      age_appropriateness: 95,
      cbse_scope: 100,
    });
    const out = parseJudgeJson(bad);
    expect(out).not.toBeNull();
    expect(out!.accuracy).toBe(100);
    expect(out!.scaffold_fidelity).toBe(0);
  });

  it('rounds non-integer scores to int', () => {
    const fractional = JSON.stringify({
      accuracy: 87.6,
      scaffold_fidelity: 72.3,
      age_appropriateness: 95.5,
      cbse_scope: 100,
    });
    const out = parseJudgeJson(fractional);
    expect(out!.accuracy).toBe(88);
    expect(out!.scaffold_fidelity).toBe(72);
  });

  it('caps notes at 1000 chars', () => {
    const long = JSON.stringify({
      accuracy: 90,
      scaffold_fidelity: 80,
      age_appropriateness: 95,
      cbse_scope: 100,
      notes: 'x'.repeat(2000),
    });
    const out = parseJudgeJson(long);
    expect(out!.notes!.length).toBe(1000);
  });

  it('omits notes when not provided (does not crash)', () => {
    const noNotes = JSON.stringify({
      accuracy: 90,
      scaffold_fidelity: 80,
      age_appropriateness: 95,
      cbse_scope: 100,
    });
    const out = parseJudgeJson(noNotes);
    expect(out).not.toBeNull();
    expect(out!.notes).toBeUndefined();
  });
});

describe('buildJudgeSystemPrompt', () => {
  it('lists all four rubric dimensions by name', () => {
    const p = buildJudgeSystemPrompt();
    expect(p).toContain('accuracy');
    expect(p).toContain('scaffold_fidelity');
    expect(p).toContain('age_appropriateness');
    expect(p).toContain('cbse_scope');
  });

  it('describes all three coach modes (socratic / answer / review)', () => {
    const p = buildJudgeSystemPrompt();
    expect(p).toContain('socratic');
    expect(p).toContain('answer');
    expect(p).toContain('review');
  });

  it('demands strict JSON output (no fences, no prose)', () => {
    const p = buildJudgeSystemPrompt();
    expect(p).toContain('Output ONLY a JSON object');
    expect(p).toContain('no markdown fences');
    expect(p).toContain('no commentary');
  });

  it('explains the abstain-turn case (empty citations)', () => {
    const p = buildJudgeSystemPrompt();
    expect(p).toMatch(/abstain/i);
  });
});

describe('buildJudgeUserMessage', () => {
  it('includes grade, subject, and coach mode in the header', () => {
    const msg = buildJudgeUserMessage({
      question: 'What is photosynthesis?',
      answer: 'Photosynthesis is the process by which plants make food.',
      citations: [],
      grade: '9',
      subject: 'science',
      coachMode: 'socratic',
    });
    expect(msg).toContain('Grade: 9');
    expect(msg).toContain('Subject: science');
    expect(msg).toContain('Expected coach mode: socratic');
  });

  it('handles null coach mode with a fallback directive', () => {
    const msg = buildJudgeUserMessage({
      question: 'Q',
      answer: 'A',
      citations: [],
      grade: '6',
      subject: 'math',
      coachMode: null,
    });
    expect(msg).toMatch(/not recorded.*recognisable scaffolding/);
  });

  it('renders an "(none)" placeholder when there are no citations (abstain)', () => {
    const msg = buildJudgeUserMessage({
      question: 'Q',
      answer: 'A',
      citations: [],
      grade: '9',
      subject: 'science',
      coachMode: 'answer',
    });
    expect(msg).toContain('(none — abstain turn or unsupported question)');
  });

  it('includes citation chapter + page when provided', () => {
    const msg = buildJudgeUserMessage({
      question: 'Q',
      answer: 'A',
      citations: [
        {
          chunk_text: 'Photosynthesis is the process by which green plants...',
          chapter_title: 'Life Processes',
          page_number: 95,
        },
      ],
      grade: '10',
      subject: 'science',
      coachMode: 'answer',
    });
    expect(msg).toContain('[Life Processes, p.95]');
    expect(msg).toContain('Photosynthesis is the process');
  });

  it('caps each citation at 800 chars to bound judge context', () => {
    const longChunk = 'x'.repeat(2000);
    const msg = buildJudgeUserMessage({
      question: 'Q',
      answer: 'A',
      citations: [{ chunk_text: longChunk }],
      grade: '9',
      subject: 'science',
      coachMode: 'answer',
    });
    // Match the slice's actual emitted content: 800 x's surrounded by the
    // citation prefix. We assert the EXACT slice not appears beyond 800.
    const xRun = msg.match(/x+/);
    expect(xRun).not.toBeNull();
    expect(xRun![0].length).toBeLessThanOrEqual(800);
  });

  it('caps citation list at 5 (judge context budget)', () => {
    const citations = Array.from({ length: 10 }, (_, i) => ({
      chunk_text: `chunk ${i}`,
      chapter_title: `Ch ${i}`,
      page_number: i,
    }));
    const msg = buildJudgeUserMessage({
      question: 'Q',
      answer: 'A',
      citations,
      grade: '9',
      subject: 'science',
      coachMode: 'answer',
    });
    expect(msg).toContain('chunk 0');
    expect(msg).toContain('chunk 4');
    // Citation 5 (index 5) should be excluded.
    expect(msg).not.toContain('chunk 5');
    expect(msg).not.toContain('chunk 9');
  });
});

describe('module constants', () => {
  it('exports a versioned rubric so historical signal can be filtered', () => {
    expect(typeof RUBRIC_VERSION).toBe('string');
    expect(RUBRIC_VERSION.length).toBeGreaterThan(0);
  });

  it('pins judge model to a Sonnet variant (latency-tolerant nightly cron)', () => {
    expect(JUDGE_MODEL).toMatch(/sonnet/i);
  });
});
