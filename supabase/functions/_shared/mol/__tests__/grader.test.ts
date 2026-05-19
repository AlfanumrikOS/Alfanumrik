// supabase/functions/_shared/mol/__tests__/grader.test.ts
//
// C4.2b-i (2026-05-19) — gradeShadowPair unit tests.
// C4.2b-i review fixes (2026-05-19): tests updated to cover the rubric v2
// changes (A1..A8, B5, B6, B1).
//
// The grader is an OFFLINE quality tool (P12 does not apply — no student
// ever sees the output). These tests verify:
//   1. Happy path: valid Sonnet response → typed GraderResult with the
//      six rubric dimensions, overall, agreement, winner, and notes.
//   2. Defensive parsing: markdown fences stripped; out-of-range scores
//      clamped to [0,1]; missing winner defaulted from overall delta;
//      missing agreement defaulted from |baseline.overall - shadow.overall|;
//      citation_accuracy may be null (A3) with renormalization.
//   3. Failure paths: timeout / non-200 / parse error / empty body all
//      return null so the cron driver can record `skipped_no_text`
//      without exhausting Sonnet quota.
//   4. Sample-bucket determinism and the GRADER_SAMPLING_RATES contract.
//   5. A1: grade + coach_mode flow through to the user message.
//   6. A2: anti-bias clauses appear in the system prompt.
//   7. A4: new weight order (accuracy 0.30 > cbse_scope 0.25).
//   8. A5: tie threshold is ±0.03, not ±0.05.
//   9. A6: scaffold_fidelity is a first-class dimension.
//  10. A8: RUBRIC_VERSION === 'mol-grader-v2'; dimension names match Foxy.

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
  GRADER_DAILY_CAP_INR,
  DEFAULT_RUBRIC,
  RUBRIC_VERSION,
  type GraderResult,
  type GraderInput,
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
    accuracy: 0.9,
    cbse_scope: 0.9,
    age_appropriateness: 0.8,
    scaffold_fidelity: 0.85,
    helpfulness: 0.85,
    citation_accuracy: 0.7,
    overall: 0.855,
  },
  shadow: {
    accuracy: 0.7,
    cbse_scope: 0.8,
    age_appropriateness: 0.85,
    scaffold_fidelity: 0.7,
    helpfulness: 0.8,
    citation_accuracy: 0.6,
    overall: 0.755,
  },
  agreement: 0.9,
  winner: 'baseline',
  notes: 'Baseline cites NCERT chapter accurately; shadow misses citation.',
};

const ARGS: GraderInput = {
  question: 'What is photosynthesis?',
  baseline_text: 'Photosynthesis is the process by which plants make food using sunlight.',
  shadow_text: 'Plants eat sunlight and turn it into food.',
  grade: '7',
  coach_mode: 'answer',
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
    // overall is recomputed by validateCandidate against the rubric so the
    // assertion uses computeOverall on the per-dimension fixture to derive
    // the canonical expected value (not the grader-supplied 0.855 / 0.755).
    expect(out!.baseline.overall).toBeCloseTo(
      computeOverall({
        accuracy: 0.9,
        cbse_scope: 0.9,
        age_appropriateness: 0.8,
        scaffold_fidelity: 0.85,
        helpfulness: 0.85,
        citation_accuracy: 0.7,
      }),
      3,
    );
    expect(out!.shadow.overall).toBeCloseTo(
      computeOverall({
        accuracy: 0.7,
        cbse_scope: 0.8,
        age_appropriateness: 0.85,
        scaffold_fidelity: 0.7,
        helpfulness: 0.8,
        citation_accuracy: 0.6,
      }),
      3,
    );
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
      ...ARGS,
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

// ─── A1: grade + coach_mode forwarded to user message ───────────────────────

describe('gradeShadowPair — A1: grade + coach_mode in user prompt', () => {
  it('includes grade and coach_mode in the user message', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(init!.body as string) as Record<string, unknown>;
      return okSonnetResponse(VALID_GRADER_BODY);
    });
    await gradeShadowPair({
      ...ARGS,
      grade: '9',
      coach_mode: 'socratic',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiKey: 'sk-test',
    });
    expect(capturedBody).not.toBeNull();
    const messages = (capturedBody as { messages: Array<{ content: string }> }).messages;
    const userContent = messages[0].content;
    expect(userContent).toMatch(/Grade: 9/);
    expect(userContent).toMatch(/Coach mode: socratic/);
  });

  it('emits a "(not recorded)" placeholder when grade is empty', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(init!.body as string) as Record<string, unknown>;
      return okSonnetResponse(VALID_GRADER_BODY);
    });
    await gradeShadowPair({
      ...ARGS,
      grade: '',
      coach_mode: null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiKey: 'sk-test',
    });
    const messages = (capturedBody as unknown as { messages: Array<{ content: string }> }).messages;
    expect(messages[0].content).toMatch(/Grade: \(not recorded/);
    expect(messages[0].content).toMatch(/Coach mode: \(not recorded/);
  });
});

// ─── A2: anti-bias clauses in system prompt ─────────────────────────────────

describe('gradeShadowPair — A2: anti-bias instructions in system prompt', () => {
  it('system prompt warns against length bias, stylistic preambles, and confidence bias', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(init!.body as string) as Record<string, unknown>;
      return okSonnetResponse(VALID_GRADER_BODY);
    });
    await gradeShadowPair({
      ...ARGS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiKey: 'sk-test',
    });
    const system = (capturedBody as { system: string }).system;
    // Length-bias clause
    expect(system).toMatch(/shorter or longer/i);
    expect(system).toMatch(/length is not quality/i);
    // Preamble / model-tells clause
    expect(system).toMatch(/As an AI assistant/i);
    expect(system).toMatch(/Great question/i);
    expect(system).toMatch(/Let me help you/i);
    // Confidence-tone bias clause
    expect(system).toMatch(/sounds more confident/i);
  });
});

// ─── A4: weight order — accuracy now ahead of cbse_scope ────────────────────

describe('DEFAULT_RUBRIC — A4: accuracy weight > cbse_scope weight', () => {
  it('accuracy weight is 0.30 and exceeds cbse_scope weight of 0.25', () => {
    expect(DEFAULT_RUBRIC.accuracy).toBeCloseTo(0.30, 6);
    expect(DEFAULT_RUBRIC.cbse_scope).toBeCloseTo(0.25, 6);
    expect(DEFAULT_RUBRIC.accuracy).toBeGreaterThan(DEFAULT_RUBRIC.cbse_scope);
  });

  it('all weights sum to 1.0', () => {
    const sum =
      DEFAULT_RUBRIC.accuracy +
      DEFAULT_RUBRIC.cbse_scope +
      DEFAULT_RUBRIC.age_appropriateness +
      DEFAULT_RUBRIC.scaffold_fidelity +
      DEFAULT_RUBRIC.helpfulness +
      DEFAULT_RUBRIC.citation_accuracy;
    expect(sum).toBeCloseTo(1.0, 6);
  });
});

// ─── A6: scaffold_fidelity is a first-class dimension ───────────────────────

describe('DEFAULT_RUBRIC — A6: scaffold_fidelity dimension', () => {
  it('scaffold_fidelity weight is 0.10 (NEW dimension)', () => {
    expect(DEFAULT_RUBRIC.scaffold_fidelity).toBeCloseTo(0.10, 6);
  });

  it('helpfulness weight reduced to 0.05 to make room for scaffold_fidelity', () => {
    expect(DEFAULT_RUBRIC.helpfulness).toBeCloseTo(0.05, 6);
  });

  it('system prompt explains scaffolding contract for doubt_solving / coach modes', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(init!.body as string) as Record<string, unknown>;
      return okSonnetResponse(VALID_GRADER_BODY);
    });
    await gradeShadowPair({
      ...ARGS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiKey: 'sk-test',
    });
    const system = (capturedBody as { system: string }).system;
    expect(system).toMatch(/scaffold_fidelity/);
    expect(system).toMatch(/socratic/i);
    expect(system).toMatch(/Bloom/i);
  });
});

// ─── A8: dimension names harmonized + RUBRIC_VERSION bump ───────────────────

describe('A8: dimensions harmonized with Foxy quality-eval + version bump', () => {
  it('RUBRIC_VERSION is mol-grader-v2', () => {
    expect(RUBRIC_VERSION).toBe('mol-grader-v2');
  });

  it('DEFAULT_RUBRIC has the v2 dimension names (accuracy / cbse_scope / scaffold_fidelity)', () => {
    expect(DEFAULT_RUBRIC).toHaveProperty('accuracy');
    expect(DEFAULT_RUBRIC).toHaveProperty('cbse_scope');
    expect(DEFAULT_RUBRIC).toHaveProperty('scaffold_fidelity');
    expect(DEFAULT_RUBRIC).toHaveProperty('age_appropriateness');
    expect(DEFAULT_RUBRIC).toHaveProperty('helpfulness');
    expect(DEFAULT_RUBRIC).toHaveProperty('citation_accuracy');
    // v1 names are gone
    expect((DEFAULT_RUBRIC as Record<string, unknown>).factual_correctness).toBeUndefined();
    expect((DEFAULT_RUBRIC as Record<string, unknown>).ncert_alignment).toBeUndefined();
  });
});

// ─── A3: citation_accuracy nullable + renormalization ───────────────────────

describe('A3: citation_accuracy null + renormalization', () => {
  it('computeOverall renormalizes the remaining weights when citation_accuracy is null', () => {
    const out = computeOverall({
      accuracy: 1,
      cbse_scope: 1,
      age_appropriateness: 1,
      scaffold_fidelity: 1,
      helpfulness: 1,
      citation_accuracy: null,
    });
    // All five remaining dimensions perfect → overall should be 1.0 after
    // renormalization. Without renormalization it would be 1 - 0.10 = 0.90.
    expect(out).toBeCloseTo(1.0, 6);
  });

  it('computeOverall with null citation gives accuracy dimension its renormalized weight', () => {
    // Only accuracy=1, all others 0. Without citation weight (0.10), the
    // renormalized accuracy weight is 0.30 / 0.90 ≈ 0.3333.
    const out = computeOverall({
      accuracy: 1,
      cbse_scope: 0,
      age_appropriateness: 0,
      scaffold_fidelity: 0,
      helpfulness: 0,
      citation_accuracy: null,
    });
    expect(out).toBeCloseTo(DEFAULT_RUBRIC.accuracy / (1 - DEFAULT_RUBRIC.citation_accuracy), 4);
  });

  it('grader response with citation_accuracy=null is accepted (no validator rejection)', async () => {
    const abstainBody = {
      ...VALID_GRADER_BODY,
      baseline: { ...VALID_GRADER_BODY.baseline, citation_accuracy: null },
      shadow: { ...VALID_GRADER_BODY.shadow, citation_accuracy: null },
    };
    const fetchImpl = vi.fn(async () => okSonnetResponse(abstainBody));
    const out = await gradeShadowPair({
      ...ARGS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiKey: 'sk-test',
    });
    expect(out).not.toBeNull();
    expect(out!.baseline.citation_accuracy).toBeNull();
    expect(out!.shadow.citation_accuracy).toBeNull();
    // The recomputed overall reflects renormalization.
    expect(out!.baseline.overall).toBeCloseTo(
      computeOverall({
        accuracy: 0.9,
        cbse_scope: 0.9,
        age_appropriateness: 0.8,
        scaffold_fidelity: 0.85,
        helpfulness: 0.85,
        citation_accuracy: null,
      }),
      3,
    );
  });
});

// ─── A5: tighter tie threshold (±0.03 not ±0.05) ────────────────────────────

describe('A5: tie threshold is ±0.03', () => {
  it('a 0.04 overall delta is no longer a tie — it becomes a winner', async () => {
    // baseline.overall ≈ 0.84, shadow.overall ≈ 0.80 — delta = 0.04
    // Under old ±0.05 threshold this was a tie; under new ±0.03 it's a baseline win.
    const close = {
      baseline: {
        accuracy: 1, cbse_scope: 1, age_appropriateness: 1, scaffold_fidelity: 0,
        helpfulness: 0, citation_accuracy: 0, overall: 0.84,
      },
      shadow: {
        accuracy: 1, cbse_scope: 1, age_appropriateness: 0.8, scaffold_fidelity: 0,
        helpfulness: 0, citation_accuracy: 0, overall: 0.80,
      },
      agreement: 0.96,
      notes: 'close call',
    };
    // Remove winner so the grader's pickWinner fallback runs against the
    // tightened threshold. Note: overall is recomputed by validateCandidate
    // so we engineer baseline.accuracy=baseline.cbse_scope=baseline.age=1
    // and shadow.age=0.8 to produce a 0.04 delta.
    const fetchImpl = vi.fn(async () => okSonnetResponse(close));
    const out = await gradeShadowPair({
      ...ARGS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiKey: 'sk-test',
    });
    expect(out).not.toBeNull();
    // The recomputed overall delta between baseline and shadow with these
    // dimensions is 0.20 * 0.20 = 0.04 (age_appropriateness contribution).
    const bOverall = computeOverall({
      accuracy: 1, cbse_scope: 1, age_appropriateness: 1, scaffold_fidelity: 0,
      helpfulness: 0, citation_accuracy: 0,
    });
    const sOverall = computeOverall({
      accuracy: 1, cbse_scope: 1, age_appropriateness: 0.8, scaffold_fidelity: 0,
      helpfulness: 0, citation_accuracy: 0,
    });
    expect(Math.abs(bOverall - sOverall)).toBeCloseTo(0.04, 3);
    // Under old ±0.05 this would be a tie; under new ±0.03 baseline wins.
    expect(out!.winner).toBe('baseline');
  });

  it('a 0.02 delta still ties', async () => {
    const close = {
      baseline: {
        accuracy: 1, cbse_scope: 1, age_appropriateness: 1, scaffold_fidelity: 0,
        helpfulness: 0, citation_accuracy: 0, overall: 0.82,
      },
      shadow: {
        accuracy: 1, cbse_scope: 1, age_appropriateness: 0.9, scaffold_fidelity: 0,
        helpfulness: 0, citation_accuracy: 0, overall: 0.80,
      },
      agreement: 0.98,
      notes: 'too close to call',
    };
    const fetchImpl = vi.fn(async () => okSonnetResponse(close));
    const out = await gradeShadowPair({
      ...ARGS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiKey: 'sk-test',
    });
    expect(out).not.toBeNull();
    // overall delta = 0.20 * 0.10 = 0.02 — within ±0.03 → tie
    expect(out!.winner).toBe('tie');
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
      baseline: { ...VALID_GRADER_BODY.baseline, accuracy: 1.7 },
      shadow: { ...VALID_GRADER_BODY.shadow, cbse_scope: -0.4 },
    };
    const fetchImpl = vi.fn(async () => okSonnetResponse(wild));
    const out = await gradeShadowPair({
      ...ARGS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiKey: 'sk-test',
    });
    expect(out).not.toBeNull();
    expect(out!.baseline.accuracy).toBe(1);
    expect(out!.shadow.cbse_scope).toBe(0);
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
    // baseline beats shadow by enough — baseline wins under the tightened threshold.
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
    const bOverall = computeOverall({
      accuracy: 0.9, cbse_scope: 0.9, age_appropriateness: 0.8,
      scaffold_fidelity: 0.85, helpfulness: 0.85, citation_accuracy: 0.7,
    });
    const sOverall = computeOverall({
      accuracy: 0.7, cbse_scope: 0.8, age_appropriateness: 0.85,
      scaffold_fidelity: 0.7, helpfulness: 0.8, citation_accuracy: 0.6,
    });
    expect(out!.agreement).toBeCloseTo(1 - Math.abs(bOverall - sOverall), 3);
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
      baseline: { accuracy: 0.9, cbse_scope: 0.9, age_appropriateness: 0.8, scaffold_fidelity: 0.85 /* helpfulness missing */, citation_accuracy: 0.7, overall: 0.85 },
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

describe('computeOverall (weighted sum, v2 rubric)', () => {
  it('returns 1.0 when every dimension is 1.0', () => {
    const out = computeOverall({
      accuracy: 1,
      cbse_scope: 1,
      age_appropriateness: 1,
      scaffold_fidelity: 1,
      helpfulness: 1,
      citation_accuracy: 1,
    });
    expect(out).toBeCloseTo(1, 6);
  });

  it('returns 0.0 when every dimension is 0', () => {
    const out = computeOverall({
      accuracy: 0,
      cbse_scope: 0,
      age_appropriateness: 0,
      scaffold_fidelity: 0,
      helpfulness: 0,
      citation_accuracy: 0,
    });
    expect(out).toBeCloseTo(0, 6);
  });

  it('weights respect DEFAULT_RUBRIC (accuracy weight isolated)', () => {
    const out = computeOverall(
      { accuracy: 1, cbse_scope: 0, age_appropriateness: 0, scaffold_fidelity: 0, helpfulness: 0, citation_accuracy: 0 },
    );
    expect(out).toBeCloseTo(DEFAULT_RUBRIC.accuracy, 6);
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

// ─── A7: adjusted sampling rates ────────────────────────────────────────────

describe('GRADER_SAMPLING_RATES — A7: adjusted rates', () => {
  it('doubt_solving is 15% (highest student impact)', () => {
    expect(GRADER_SAMPLING_RATES.doubt_solving).toBe(15);
  });

  it('step_by_step is 15% (board-exam stakes)', () => {
    expect(GRADER_SAMPLING_RATES.step_by_step).toBe(15);
  });

  it('concept_explanation is 8%', () => {
    expect(GRADER_SAMPLING_RATES.concept_explanation).toBe(8);
  });

  it('explanation is 5%', () => {
    expect(GRADER_SAMPLING_RATES.explanation).toBe(5);
  });

  it('non-allow-list task types remain absent (default → 0%)', () => {
    expect(GRADER_SAMPLING_RATES.quiz_generation).toBeUndefined();
    expect(GRADER_SAMPLING_RATES.grounding_check).toBeUndefined();
    expect(GRADER_SAMPLING_RATES.evaluation).toBeUndefined();
    expect(GRADER_SAMPLING_RATES.reasoning).toBeUndefined();
    expect(GRADER_SAMPLING_RATES.ocr_extraction).toBeUndefined();
  });

  it('GRADER_DAILY_COST_CAP_INR (shadow cap) matches the runbook constant', () => {
    expect(GRADER_DAILY_COST_CAP_INR).toBe(10_000);
  });

  it('GRADER_DAILY_CAP_INR (grader cap, B6) is set at half the shadow cap', () => {
    expect(GRADER_DAILY_CAP_INR).toBe(5_000);
  });
});

// Re-exported for clarity in defensive tests — kept here so the tooling
// notices the imported GraderResult type is actually referenced.
type _ResultType = GraderResult; // eslint-disable-line @typescript-eslint/no-unused-vars
