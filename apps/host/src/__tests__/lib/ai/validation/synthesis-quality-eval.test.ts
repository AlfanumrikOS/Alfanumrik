/**
 * scoreSynthesisSummary — Phase 8 item 8.6 LLM-as-judge quality scorer.
 *
 * Covers: circuit-breaker gating (open breaker skips the judge call → null),
 * judge fetch-failure fallback (returns null, records a breaker failure, never
 * throws), the deterministic-oracle override (any unbacked number clamps
 * no_fabrication to 0 and caps grounding at 40), and the clean happy path.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  scoreSynthesisSummary,
  computeSynthesisOverall,
  parseSynthesisJudgeJson,
} from '@alfanumrik/lib/ai/validation/synthesis-quality-eval';
import { createSynthesisCircuitBreaker } from '@alfanumrik/lib/ai/validation/synthesis-oracle';
import type { SynthesisBundle } from '@alfanumrik/lib/learn/monthly-synthesis-orchestrator';

const API_KEY = 'sk-test';

const CLEAN_BUNDLE: SynthesisBundle = {
  monthLabel: '2026-06',
  weeklyArtifactIds: [],
  masteryDelta: { chaptersTouched: ['Motion'], topicsMastered: 2, topicsImproved: 1, topicsRegressed: 0 },
  chapterMockSummary: null,
};

// Grounded summary: only cites numbers present in the bundle (2, 1, 0).
const CLEAN_INPUT = {
  summaryEn: 'Your child mastered 2 topics and improved 1 this month. Keep it up!',
  summaryHi: 'आपके बच्चे ने इस महीने 2 विषयों में महारत हासिल की और 1 में सुधार किया।',
  bundle: CLEAN_BUNDLE,
  studentName: 'Asha',
  studentGrade: '9',
};

function mockFetchJudge(json: Record<string, number | string>) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ content: [{ type: 'text', text: JSON.stringify(json) }] }),
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('scoreSynthesisSummary', () => {
  it('throws only on missing API key (loud misconfiguration)', async () => {
    await expect(scoreSynthesisSummary(CLEAN_INPUT, '')).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  it('skips the judge call and returns null when the breaker is open', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    const openBreaker = createSynthesisCircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 60_000 });
    openBreaker.recordFailure(); // → open

    const result = await scoreSynthesisSummary(CLEAN_INPUT, API_KEY, openBreaker);
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns null and records a breaker failure when the judge call fails (no throw)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, json: async () => ({}) } as never);
    const breaker = createSynthesisCircuitBreaker();

    const result = await scoreSynthesisSummary(CLEAN_INPUT, API_KEY, breaker);
    expect(result).toBeNull();
    expect(breaker.getState().failures).toBe(1);
  });

  it('happy path: blends the judge scores with the default weights', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(
      mockFetchJudge({ grounding: 90, tone: 80, no_fabrication: 100, cbse_scope: 90 }) as never,
    );
    const breaker = createSynthesisCircuitBreaker();

    const result = await scoreSynthesisSummary(CLEAN_INPUT, API_KEY, breaker);
    expect(result).not.toBeNull();
    expect(result!.groundingScore).toBe(90);
    expect(result!.noFabricationScore).toBe(100);
    // 0.35*90 + 0.35*100 + 0.20*80 + 0.10*90 = 31.5+35+16+9 = 91.5 → 92
    expect(result!.overallScore).toBe(92);
    expect(result!.oracleFindings).toEqual({ unbacked_number_count: 0, unbacked_topic_count: 0 });
    expect(breaker.getState().state).toBe('closed');
  });

  it('deterministic override: an unbacked number clamps no_fabrication to 0 and caps grounding at 40', async () => {
    // The summary invents "45 minutes" — not present anywhere in the bundle.
    const fabricatedInput = {
      ...CLEAN_INPUT,
      summaryEn: 'Your child mastered 2 topics. Please have them practice 45 minutes every day.',
    };
    // Judge (naively) gives high scores; the deterministic oracle must override.
    vi.spyOn(global, 'fetch').mockImplementation(
      mockFetchJudge({ grounding: 95, tone: 90, no_fabrication: 95, cbse_scope: 90 }) as never,
    );
    const breaker = createSynthesisCircuitBreaker();

    const result = await scoreSynthesisSummary(fabricatedInput, API_KEY, breaker);
    expect(result).not.toBeNull();
    expect(result!.noFabricationScore).toBe(0);      // hard fail on fabrication
    expect(result!.groundingScore).toBe(40);         // capped
    expect(result!.oracleFindings.unbacked_number_count).toBeGreaterThanOrEqual(1);
    expect(result!.notes).toMatch(/oracle/i);
  });
});

describe('pure helpers', () => {
  it('computeSynthesisOverall clamps to [0,100]', () => {
    expect(computeSynthesisOverall({ grounding: 100, no_fabrication: 100, tone: 100, cbse_scope: 100 })).toBe(100);
    expect(computeSynthesisOverall({ grounding: 0, no_fabrication: 0, tone: 0, cbse_scope: 0 })).toBe(0);
  });

  it('parseSynthesisJudgeJson tolerates ```json fences and rejects malformed', () => {
    const ok = parseSynthesisJudgeJson('```json\n{"grounding":80,"tone":70,"no_fabrication":90,"cbse_scope":60}\n```');
    expect(ok).not.toBeNull();
    expect(ok!.grounding).toBe(80);
    expect(parseSynthesisJudgeJson('not json')).toBeNull();
    expect(parseSynthesisJudgeJson('{"grounding":80}')).toBeNull(); // missing dims
  });
});
