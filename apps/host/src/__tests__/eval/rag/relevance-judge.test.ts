// src/__tests__/eval/rag/relevance-judge.test.ts
//
// RED-first tests for the B1 retrieval-relevance judge (Task 3). The judge is
// OFFLINE tooling (runs only at golden-set build/refresh time, never on the
// student path — spec Q5). Sonnet, temp 0, strict JSON, fenced-recovery parse,
// clamp — machinery patterned on `src/lib/foxy/quality-eval.ts` but with the
// RETRIEVAL relevance rubric (spec §B1.3).
//
// CRITICAL — no live model call: every test injects a FAKE completion function
// via `judgeRelevance(input, { complete })`. The default `complete` is the
// real fetch-based Anthropic call, but it is NEVER exercised here — the fake
// short-circuits it. This is how reviewers verify no real API traffic leaves
// the test process: there is no global fetch stub, no network, no API key.
//
// Spec anchors:
//   §B1.3 judge rubric — relevance 2/1/0; `off_grade_scope` flagged SEPARATELY
//         (A2) so "wrong grade band" is not conflated with "topically
//         irrelevant"; absent `off_grade_scope` → false.
//   P12   — prompt CBSE-scoped, grade-G/subject-S-scoped, age-appropriate by
//           construction, penalizes off-syllabus chunks.
//   P13   — judge sees ONLY the scrubbed query + corpus chunk text; never a
//           student identifier.
//
// Relative import (the `@/*` Vitest alias does not reach the eval harness,
// which lives outside src/) — matches the convention in `golden-schema.test.ts`
// and `metrics.test.ts`.

import { describe, it, expect, vi } from 'vitest';

import {
  buildJudgeSystemPrompt,
  buildJudgeUserMessage,
  parseJudgeJson,
  clampRelevance,
  judgeRelevance,
  JUDGE_MODEL,
  JUDGE_RUBRIC_VERSION,
  JUDGE_TEMPERATURE,
} from '../../../../eval/rag/harness/relevance-judge';
import type {
  RelevanceJudgeInput,
  RelevanceJudgeResult,
  JudgeCompletionFn,
} from '../../../../eval/rag/harness/relevance-judge';

// ─── A reusable valid judge-input (no PII — scrubbed query + corpus text) ────

const SAMPLE_INPUT: RelevanceJudgeInput = {
  query: 'Why does light bend when it enters water?',
  grade: '8',
  subject: 'science',
  chunkText:
    'Refraction is the bending of light as it passes from one transparent ' +
    'medium into another. When light travels from air into water it slows ' +
    'down and bends towards the normal.',
};

/** Build a fake completion fn that returns a fixed raw string. */
function fakeComplete(raw: string): JudgeCompletionFn {
  return vi.fn(async () => raw);
}

// ─── clampRelevance ──────────────────────────────────────────────────────────

describe('clampRelevance', () => {
  it('passes through valid in-range values 0,1,2', () => {
    expect(clampRelevance(0)).toBe(0);
    expect(clampRelevance(1)).toBe(1);
    expect(clampRelevance(2)).toBe(2);
  });

  it('clamps above-range (3) down to 2', () => {
    expect(clampRelevance(3)).toBe(2);
    expect(clampRelevance(99)).toBe(2);
  });

  it('clamps below-range (-1) up to 0', () => {
    expect(clampRelevance(-1)).toBe(0);
    expect(clampRelevance(-99)).toBe(0);
  });

  it('rounds a fractional value before clamping', () => {
    expect(clampRelevance(1.4)).toBe(1);
    expect(clampRelevance(1.6)).toBe(2);
  });

  it('returns null for non-numeric / non-finite input', () => {
    expect(clampRelevance('high')).toBeNull();
    expect(clampRelevance(undefined)).toBeNull();
    expect(clampRelevance(null)).toBeNull();
    expect(clampRelevance(NaN)).toBeNull();
    expect(clampRelevance(Infinity)).toBeNull();
  });
});

// ─── parseJudgeJson ──────────────────────────────────────────────────────────

describe('parseJudgeJson', () => {
  const validRaw = JSON.stringify({
    relevance: 2,
    off_grade_scope: false,
    reason: 'The chunk directly defines refraction, the subject of the query.',
  });

  it('parses a clean JSON response', () => {
    const out = parseJudgeJson(validRaw);
    expect(out).not.toBeNull();
    expect(out!.relevance).toBe(2);
    expect(out!.off_grade_scope).toBe(false);
    expect(out!.reason).toMatch(/refraction/);
  });

  it('recovers a fenced ```json block (Sonnet sometimes fences despite instructions)', () => {
    const fenced = '```json\n' + validRaw + '\n```';
    const out = parseJudgeJson(fenced);
    expect(out).not.toBeNull();
    expect(out!.relevance).toBe(2);
  });

  it('recovers a bare ``` fence (no language tag)', () => {
    const fenced = '```\n' + validRaw + '\n```';
    expect(parseJudgeJson(fenced)).not.toBeNull();
  });

  it('defaults off_grade_scope to false when the key is absent (A2)', () => {
    const noFlag = JSON.stringify({
      relevance: 1,
      reason: 'partial context, primary source elsewhere',
    });
    const out = parseJudgeJson(noFlag);
    expect(out).not.toBeNull();
    expect(out!.off_grade_scope).toBe(false);
    expect(out!.relevance).toBe(1);
  });

  it('round-trips an off_grade_scope: true label independently of relevance (A2)', () => {
    // A chunk can be relevance=2 (right topic) AND off_grade_scope=true (wrong
    // grade band) — the flag is INDEPENDENT of relevance.
    const offGrade = JSON.stringify({
      relevance: 2,
      off_grade_scope: true,
      reason: 'Right topic but a Class-11 derivation served to a Class-8 query.',
    });
    const out = parseJudgeJson(offGrade);
    expect(out).not.toBeNull();
    expect(out!.relevance).toBe(2);
    expect(out!.off_grade_scope).toBe(true);
  });

  it('clamps an out-of-range relevance into {0,1,2} (judge mistake protection)', () => {
    expect(parseJudgeJson(JSON.stringify({ relevance: 3, reason: 'x' }))!.relevance).toBe(2);
    expect(parseJudgeJson(JSON.stringify({ relevance: -1, reason: 'x' }))!.relevance).toBe(0);
  });

  it('returns null (not throw) on malformed JSON', () => {
    expect(parseJudgeJson('{ relevance: 2 ')).toBeNull();
    expect(parseJudgeJson('not json at all')).toBeNull();
  });

  it('returns null for empty / non-string input', () => {
    expect(parseJudgeJson('')).toBeNull();
    // @ts-expect-error runtime guard
    expect(parseJudgeJson(null)).toBeNull();
    // @ts-expect-error runtime guard
    expect(parseJudgeJson(42)).toBeNull();
  });

  it('returns null when relevance is missing entirely', () => {
    const noRel = JSON.stringify({ off_grade_scope: false, reason: 'x' });
    expect(parseJudgeJson(noRel)).toBeNull();
  });

  it('returns null when relevance is non-numeric / non-coercible', () => {
    expect(parseJudgeJson(JSON.stringify({ relevance: 'high', reason: 'x' }))).toBeNull();
  });

  it('coerces a non-boolean off_grade_scope to false (conservative default)', () => {
    const weird = JSON.stringify({ relevance: 1, off_grade_scope: 'yes', reason: 'x' });
    const out = parseJudgeJson(weird);
    expect(out).not.toBeNull();
    expect(out!.off_grade_scope).toBe(false);
  });

  it('tolerates a missing reason (defaults to empty string, never throws)', () => {
    const noReason = JSON.stringify({ relevance: 0, off_grade_scope: false });
    const out = parseJudgeJson(noReason);
    expect(out).not.toBeNull();
    expect(typeof out!.reason).toBe('string');
  });
});

// ─── buildJudgeSystemPrompt (P12 artifact — assessment reviews wording) ──────

describe('buildJudgeSystemPrompt', () => {
  it('scopes to CBSE / NCERT and grades 6-12 (P12 curriculum-scope guardrail)', () => {
    const p = buildJudgeSystemPrompt();
    expect(p).toMatch(/CBSE/);
    expect(p).toMatch(/NCERT/);
    expect(p).toMatch(/6-12|grades 6/i);
  });

  it('describes the 2/1/0 relevance scale', () => {
    const p = buildJudgeSystemPrompt();
    expect(p).toContain('2');
    expect(p).toContain('1');
    expect(p).toContain('0');
    expect(p).toMatch(/relevan/i);
  });

  it('instructs the judge to flag off_grade_scope SEPARATELY from relevance (A2)', () => {
    const p = buildJudgeSystemPrompt();
    expect(p).toContain('off_grade_scope');
    // The disambiguation language: off_grade_scope is independent of relevance.
    expect(p).toMatch(/independent|separate/i);
  });

  it('penalizes off-syllabus / out-of-scope chunks (P12 scope-lock)', () => {
    const p = buildJudgeSystemPrompt();
    expect(p).toMatch(/syllabus|out of scope|out-of-scope|scope/i);
  });

  it('demands strict JSON output (no prose, no fences)', () => {
    const p = buildJudgeSystemPrompt();
    expect(p).toMatch(/JSON/);
    expect(p).toMatch(/only/i);
  });

  it('declares the exact JSON output shape (relevance / off_grade_scope / reason)', () => {
    const p = buildJudgeSystemPrompt();
    expect(p).toContain('relevance');
    expect(p).toContain('off_grade_scope');
    expect(p).toContain('reason');
  });
});

// ─── buildJudgeUserMessage (carries grade + subject; only scrubbed query + chunk) ─

describe('buildJudgeUserMessage', () => {
  it('includes the grade and subject in the message (grade-G/subject-S scope)', () => {
    const msg = buildJudgeUserMessage(SAMPLE_INPUT);
    expect(msg).toContain('8'); // grade
    expect(msg).toContain('science'); // subject
  });

  it('includes the query text and the candidate chunk text', () => {
    const msg = buildJudgeUserMessage(SAMPLE_INPUT);
    expect(msg).toContain('Why does light bend');
    expect(msg).toContain('Refraction is the bending of light');
  });

  it('caps the chunk text to bound judge context', () => {
    const longChunk = 'x'.repeat(5000);
    const msg = buildJudgeUserMessage({ ...SAMPLE_INPUT, chunkText: longChunk });
    const xRun = msg.match(/x+/);
    expect(xRun).not.toBeNull();
    expect(xRun![0].length).toBeLessThanOrEqual(2000);
  });
});

// ─── judgeRelevance — end to end with a MOCKED LLM (no real API call) ────────

describe('judgeRelevance (LLM mocked via injected `complete`)', () => {
  it('parses a valid JSON completion into a typed result', async () => {
    const complete = fakeComplete(
      JSON.stringify({ relevance: 2, off_grade_scope: false, reason: 'primary source' }),
    );
    const res = await judgeRelevance(SAMPLE_INPUT, { complete });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.relevance).toBe(2);
      expect(res.value.off_grade_scope).toBe(false);
      expect(res.value.reason).toBe('primary source');
    }
    // The fake was called exactly once — proves we routed through the injected
    // completion fn and never the default fetch-based one.
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('recovers a fenced ```json completion', async () => {
    const raw =
      '```json\n' +
      JSON.stringify({ relevance: 1, off_grade_scope: false, reason: 'partial' }) +
      '\n```';
    const res = await judgeRelevance(SAMPLE_INPUT, { complete: fakeComplete(raw) });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.relevance).toBe(1);
  });

  it('clamps an out-of-range relevance from the model (3 → 2)', async () => {
    const res = await judgeRelevance(SAMPLE_INPUT, {
      complete: fakeComplete(JSON.stringify({ relevance: 3, reason: 'x' })),
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.relevance).toBe(2);
  });

  it('defaults off_grade_scope to false when the model omits it (A2)', async () => {
    const res = await judgeRelevance(SAMPLE_INPUT, {
      complete: fakeComplete(JSON.stringify({ relevance: 1, reason: 'x' })),
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.off_grade_scope).toBe(false);
  });

  it('returns a typed fallback (never throws) on malformed model output', async () => {
    const res = await judgeRelevance(SAMPLE_INPUT, {
      complete: fakeComplete('total garbage, not json'),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(typeof res.error).toBe('string');
      expect(res.error.length).toBeGreaterThan(0);
    }
  });

  it('returns a typed fallback (never throws) when the completion fn throws', async () => {
    const throwing: JudgeCompletionFn = vi.fn(async () => {
      throw new Error('network down');
    });
    // Must not reject — the judge wraps the error into a typed fallback.
    const res = await judgeRelevance(SAMPLE_INPUT, { complete: throwing });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.length).toBeGreaterThan(0);
  });

  it('passes the built system + user prompt to the completion fn (P12/P13 surface)', async () => {
    const complete: JudgeCompletionFn = vi.fn(async (args) => {
      // The judge must hand the completion fn the CBSE-scoped system prompt and
      // a user message that carries ONLY the scrubbed query + chunk text.
      expect(args.system).toMatch(/CBSE/);
      expect(args.user).toContain('Why does light bend');
      expect(args.user).toContain('Refraction is the bending of light');
      expect(args.temperature).toBe(JUDGE_TEMPERATURE);
      expect(args.model).toBe(JUDGE_MODEL);
      return JSON.stringify({ relevance: 2, off_grade_scope: false, reason: 'ok' });
    });
    const res = await judgeRelevance(SAMPLE_INPUT, { complete });
    expect(res.ok).toBe(true);
    expect(complete).toHaveBeenCalledTimes(1);
  });
});

// ─── module constants ─────────────────────────────────────────────────────────

describe('module constants', () => {
  it('pins the judge model to a Sonnet variant (offline, latency-tolerant — Q5)', () => {
    expect(JUDGE_MODEL).toMatch(/sonnet/i);
  });

  it('pins temperature to 0 (deterministic relevance labels)', () => {
    expect(JUDGE_TEMPERATURE).toBe(0);
  });

  it('exports a versioned rubric so historical labels can be filtered', () => {
    expect(typeof JUDGE_RUBRIC_VERSION).toBe('string');
    expect(JUDGE_RUBRIC_VERSION.length).toBeGreaterThan(0);
  });
});
