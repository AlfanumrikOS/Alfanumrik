// supabase/functions/_shared/mol/__tests__/grader.test.ts
//
// C4.2b-i (2026-05-19) — gradeShadowPair unit tests.
//
// The grader is an OFFLINE quality tool (P12 does not apply — no student
// ever sees the output). These tests verify:
//   1. Happy path: valid Sonnet response → typed GraderResult with the
//      five rubric dimensions, overall, agreement, winner, and notes.
//   2. Defensive parsing: markdown fences stripped; out-of-range scores
//      clamped to [0,1]; missing winner defaulted from overall delta;
//      missing agreement defaulted from |baseline.overall - shadow.overall|.
//   3. Failure paths: timeout / non-200 / parse error / empty body all
//      return null so the cron driver can record `skipped_no_text`
//      without exhausting Sonnet quota.
//   4. Sample-bucket determinism and the GRADER_SAMPLING_RATES contract.

// @ts-ignore — grader.ts reads Deno.env at construction time when no
// fetchImpl/apiKey override is provided. We stub here so the import-time
// access doesn't trip.
globalThis.Deno = { env: { get: (_k: string) => '' } };

import { describe, it, expect, vi } from 'vitest';
import {
  gradeShadowPair,
  computeOverall,
  graderSampleBucket,
  GRADER_SAMPLING_RATES,
  GRADER_DAILY_COST_CAP_INR,
  DEFAULT_RUBRIC,
  RUBRIC_VERSION,
  type GraderResult,
} from '../grader.ts';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function okSonnetResponse(body: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({
      content: [{ type: 'text', text: JSON.stringify(body) }],
      usage: { input_tokens: 320, output_tokens: 280 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function failingSonnetResponse(status: number, body = ''): Response {
  return new Response(body, { status });
}

const VALID_GRADER_BODY = {
  baseline: {
    ncert_alignment: 0.9,
    factual_correctness: 0.9,
    age_appropriateness: 0.8,
    helpfulness: 0.85,
    citation_accuracy: 0.7,
    overall: 0.855,
  },
  shadow: {
    ncert_alignment: 0.7,
    factual_correctness: 0.8,
    age_appropriateness: 0.85,
    helpfulness: 0.8,
    citation_accuracy: 0.6,
    overall: 0.755,
  },
  agreement: 0.9,
  winner: 'baseline',
  notes: 'Baseline cites NCERT chapter accurately; shadow misses citation.',
};

const ARGS = {
  question: 'What is photosynthesis?',
  baseline_text: 'Photosynthesis is the process by which plants make food using sunlight.',
  shadow_text: 'Plants eat sunlight and turn it into food.',
};

// ─── Happy path ──────────────────────────────────────────────────────────────

describe('gradeShadowPair — happy path', () => {
  it('parses a well-formed Sonnet response into a typed GraderResult', async () => {
    const fetchImpl = vi.fn(async () => okSonnetResponse(VALID_GRADER_BODY));

    const out = await gradeShadowPair({
      ...ARGS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiKey: 'sk-test',
    });

    expect(out).not.toBeNull();
    expect(out!.baseline.overall).toBeCloseTo(0.855, 3);
    expect(out!.shadow.overall).toBeCloseTo(0.755, 3);
    expect(out!.winner).toBe('baseline');
    expect(out!.agreement).toBeCloseTo(0.9, 3);
    expect(out!.notes).toMatch(/NCERT/i);
    expect(out!.rubric_version).toBe(RUBRIC_VERSION);
    expect(out!.prompt_tokens).toBe(320);
    expect(out!.completion_tokens).toBe(280);
  });

  it('returns null when ANTHROPIC_API_KEY is missing (no Sonnet call)', async () => {
    const fetchImpl = vi.fn(async () => okSonnetResponse(VALID_GRADER_BODY));
    const out = await gradeShadowPair({
      ...ARGS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiKey: '', // explicit empty → grader bails
    });
    expect(out).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns null when question or candidates are empty (no Sonnet quota burn)', async () => {
    const fetchImpl = vi.fn(async () => okSonnetResponse(VALID_GRADER_BODY));
    const out = await gradeShadowPair({
      question: '',
      baseline_text: 'x',
      shadow_text: 'y',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiKey: 'sk-test',
    });
    expect(out).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

// ─── Defensive parsing ───────────────────────────────────────────────────────

describe('gradeShadowPair — defensive parsing', () => {
  it('strips a leading ```json markdown fence', async () => {
    const fenced = '```json\n' + JSON.stringify(VALID_GRADER_BODY) + '\n```';
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ content: [{ type: 'text', text: fenced }], usage: { input_tokens: 1, output_tokens: 1 } }),
        { status: 200 },
      ),
    );
    const out = await gradeShadowPair({
      ...ARGS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiKey: 'sk-test',
    });
    expect(out).not.toBeNull();
    expect(out!.winner).toBe('baseline');
  });

  it('clamps out-of-range scores to [0,1]', async () => {
    const wild = {
      ...VALID_GRADER_BODY,
      baseline: { ...VALID_GRADER_BODY.baseline, ncert_alignment: 1.7 },
      shadow: { ...VALID_GRADER_BODY.shadow, factual_correctness: -0.4 },
    };
    const fetchImpl = vi.fn(async () => okSonnetResponse(wild));
    const out = await gradeShadowPair({
      ...ARGS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiKey: 'sk-test',
    });
    expect(out).not.toBeNull();
    expect(out!.baseline.ncert_alignment).toBe(1);
    expect(out!.shadow.factual_correctness).toBe(0);
  });

  it('defaults winner from overall delta when grader omits it', async () => {
    const minus = { ...VALID_GRADER_BODY };
    delete (minus as Record<string, unknown>).winner;
    const fetchImpl = vi.fn(async () => okSonnetResponse(minus as Record<string, unknown>));
    const out = await gradeShadowPair({
      ...ARGS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiKey: 'sk-test',
    });
    expect(out).not.toBeNull();
    // baseline.overall (0.855) - shadow.overall (0.755) = 0.10 → baseline wins
    expect(out!.winner).toBe('baseline');
  });

  it('defaults agreement to 1 - |baseline.overall - shadow.overall| when grader omits it', async () => {
    const minus = { ...VALID_GRADER_BODY };
    delete (minus as Record<string, unknown>).agreement;
    const fetchImpl = vi.fn(async () => okSonnetResponse(minus as Record<string, unknown>));
    const out = await gradeShadowPair({
      ...ARGS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiKey: 'sk-test',
    });
    expect(out).not.toBeNull();
    expect(out!.agreement).toBeCloseTo(1 - Math.abs(0.855 - 0.755), 3);
  });

  it('emits "tie" when overall delta is within ±0.05', async () => {
    const close = {
      ...VALID_GRADER_BODY,
      baseline: { ...VALID_GRADER_BODY.baseline, overall: 0.80 },
      shadow: { ...VALID_GRADER_BODY.shadow, overall: 0.82 },
    };
    delete (close as Record<string, unknown>).winner;
    const fetchImpl = vi.fn(async () => okSonnetResponse(close));
    const out = await gradeShadowPair({
      ...ARGS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiKey: 'sk-test',
    });
    expect(out!.winner).toBe('tie');
  });
});

// ─── Failure paths ───────────────────────────────────────────────────────────

describe('gradeShadowPair — failure paths', () => {
  it('returns null on non-200 Sonnet response', async () => {
    const fetchImpl = vi.fn(async () => failingSonnetResponse(503, 'overloaded'));
    const out = await gradeShadowPair({
      ...ARGS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiKey: 'sk-test',
    });
    expect(out).toBeNull();
  });

  it('returns null on JSON parse failure (grader emitted garbage)', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ content: [{ type: 'text', text: 'not valid {{{' }], usage: { input_tokens: 1, output_tokens: 1 } }),
        { status: 200 },
      ),
    );
    const out = await gradeShadowPair({
      ...ARGS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiKey: 'sk-test',
    });
    expect(out).toBeNull();
  });

  it('returns null on empty Sonnet text body', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ content: [], usage: { input_tokens: 1, output_tokens: 1 } }),
        { status: 200 },
      ),
    );
    const out = await gradeShadowPair({
      ...ARGS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiKey: 'sk-test',
    });
    expect(out).toBeNull();
  });

  it('returns null on validator failure (missing dimension)', async () => {
    const incomplete = {
      ...VALID_GRADER_BODY,
      baseline: { ncert_alignment: 0.9, factual_correctness: 0.9, age_appropriateness: 0.8, helpfulness: 0.85 /* citation_accuracy missing */, overall: 0.85 },
    };
    const fetchImpl = vi.fn(async () => okSonnetResponse(incomplete));
    const out = await gradeShadowPair({
      ...ARGS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiKey: 'sk-test',
    });
    expect(out).toBeNull();
  });

  it('returns null when fetch throws (network outage / abort)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    const out = await gradeShadowPair({
      ...ARGS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiKey: 'sk-test',
    });
    expect(out).toBeNull();
  });
});

// ─── Pure helpers ────────────────────────────────────────────────────────────

describe('computeOverall (weighted sum)', () => {
  it('returns 1.0 when every dimension is 1.0', () => {
    const out = computeOverall({
      ncert_alignment: 1,
      factual_correctness: 1,
      age_appropriateness: 1,
      helpfulness: 1,
      citation_accuracy: 1,
    });
    expect(out).toBeCloseTo(1, 6);
  });

  it('returns 0.0 when every dimension is 0', () => {
    const out = computeOverall({
      ncert_alignment: 0,
      factual_correctness: 0,
      age_appropriateness: 0,
      helpfulness: 0,
      citation_accuracy: 0,
    });
    expect(out).toBeCloseTo(0, 6);
  });

  it('weights match DEFAULT_RUBRIC (30/25/20/15/10)', () => {
    const out = computeOverall(
      { ncert_alignment: 1, factual_correctness: 0, age_appropriateness: 0, helpfulness: 0, citation_accuracy: 0 },
    );
    expect(out).toBeCloseTo(DEFAULT_RUBRIC.ncert_alignment, 6);
  });
});

describe('graderSampleBucket — deterministic 0..99', () => {
  it('returns a stable integer for the same request_id', () => {
    const a = graderSampleBucket('abc-123');
    const b = graderSampleBucket('abc-123');
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(100);
  });

  it('different request_ids produce different buckets (overwhelmingly)', () => {
    // Not a guarantee, but spot-check that 10 random ids don't all land
    // in the same bucket (which would imply the hash collapsed).
    const buckets = new Set<number>();
    for (let i = 0; i < 10; i++) buckets.add(graderSampleBucket(`req-${i}-${Math.random()}`));
    expect(buckets.size).toBeGreaterThan(1);
  });
});

describe('GRADER_SAMPLING_RATES contract', () => {
  it('explanation + concept_explanation are 10%', () => {
    expect(GRADER_SAMPLING_RATES.explanation).toBe(10);
    expect(GRADER_SAMPLING_RATES.concept_explanation).toBe(10);
  });

  it('doubt_solving + step_by_step are 5%', () => {
    expect(GRADER_SAMPLING_RATES.doubt_solving).toBe(5);
    expect(GRADER_SAMPLING_RATES.step_by_step).toBe(5);
  });

  it('non-allow-list task types are not present (default → 0%)', () => {
    // The cron driver coerces missing keys to 0; the contract here is
    // that the constants do not silently leak rates for task types we
    // chose to exclude from C4 (quiz_generation, grounding_check, etc.).
    expect(GRADER_SAMPLING_RATES.quiz_generation).toBeUndefined();
    expect(GRADER_SAMPLING_RATES.grounding_check).toBeUndefined();
    expect(GRADER_SAMPLING_RATES.evaluation).toBeUndefined();
    expect(GRADER_SAMPLING_RATES.reasoning).toBeUndefined();
    expect(GRADER_SAMPLING_RATES.ocr_extraction).toBeUndefined();
  });

  it('GRADER_DAILY_COST_CAP_INR matches the runbook constant', () => {
    expect(GRADER_DAILY_COST_CAP_INR).toBe(10_000);
  });
});

// Re-exported for clarity in defensive tests — kept here so the tooling
// notices the imported GraderResult type is actually referenced.
type _ResultType = GraderResult; // eslint-disable-line @typescript-eslint/no-unused-vars
