/**
 * Foxy lab-context — unit tests (Tier 2 R6).
 *
 * Covers the Next.js-side helpers in:
 *   src/lib/foxy/recent-lab-context.ts  (DB row → LabContextEntry mapper + fetcher)
 *   src/lib/foxy/foxy-lab-prompt.ts     (LabContextEntry[] → prompt section)
 *
 * The Deno twins live at:
 *   supabase/functions/_shared/recent-lab-context.ts
 *   supabase/functions/_shared/foxy-lab-prompt.ts
 *
 * Both pairs MUST keep the "NEVER invent" guardrail wording in sync — that
 * line is the P12 safety contract for this feature and the regression test
 * pins it.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  fetchRecentLabContext,
  type LabContextEntry,
} from '@/lib/foxy/recent-lab-context';
import { buildLabContextSection } from '@/lib/foxy/foxy-lab-prompt';

// ── Mock-supabase factory ──────────────────────────────────────────────────
// The fetcher uses a thenable PostgREST chain:
//   supabase.from(...).select(...).eq(...).gte(...).order(...).limit(...)
// All chain methods return `this`; `limit()` returns the awaited result.
function makeMockSupabase(rows: any[] | null, error: any = null) {
  const builder: any = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: rows, error }),
  };
  return builder;
}

const STUDENT_ID = '00000000-0000-0000-0000-000000000001';

// ── fetchRecentLabContext ───────────────────────────────────────────────────

describe('fetchRecentLabContext', () => {
  it('returns [] when the student has zero rows', async () => {
    const supabase = makeMockSupabase([]);
    const entries = await fetchRecentLabContext(supabase, STUDENT_ID);
    expect(entries).toEqual([]);
  });

  it('returns [] when the studentId is empty (defensive)', async () => {
    const supabase = makeMockSupabase([{ /* anything */ }]);
    const entries = await fetchRecentLabContext(supabase, '');
    expect(entries).toEqual([]);
    // The empty-studentId guard short-circuits BEFORE hitting the DB.
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('returns [] on Supabase error (Foxy must keep working)', async () => {
    const supabase = makeMockSupabase(null, { message: 'connection refused' });
    const entries = await fetchRecentLabContext(supabase, STUDENT_ID);
    expect(entries).toEqual([]);
  });

  it('maps a single simple row to a LabContextEntry', async () => {
    const supabase = makeMockSupabase([
      {
        simulation_id: 'ohms-law',
        experiment_id: null,
        observation_type: 'simple',
        observation_text: 'Current rises linearly with voltage',
        structured_observations: null,
        conclusion: 'V = IR is verified within 5% error',
        quiz_score: null,
        total_questions: null,
        subject: 'physics',
        created_at: '2026-05-03T10:00:00.000Z',
      },
    ]);
    const entries = await fetchRecentLabContext(supabase, STUDENT_ID);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      date: '2026-05-03',
      simulationId: 'ohms-law',
      subject: 'physics',
      type: 'simple',
      observationSummary: 'Current rises linearly with voltage',
      conclusion: 'V = IR is verified within 5% error',
      vivaScore: null,
      vivaMax: null,
    });
  });

  it('maps a guided row by concatenating structured_observations values', async () => {
    const supabase = makeMockSupabase([
      {
        simulation_id: 'titration',
        experiment_id: 'exp-acid-base',
        observation_type: 'guided',
        observation_text: null,
        structured_observations: {
          '0': 'NaOH turned phenolphthalein pink at 25 mL',
          '1': 'Endpoint reached at 24.8 mL',
          '2': 'Repeated trial gave 25.1 mL',
        },
        conclusion: 'Average titre 24.97 mL',
        quiz_score: 4,
        total_questions: 5,
        subject: 'chemistry',
        created_at: '2026-05-01T15:30:00.000Z',
      },
    ]);
    const entries = await fetchRecentLabContext(supabase, STUDENT_ID);
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('guided');
    expect(entries[0].observationSummary).toContain('phenolphthalein');
    expect(entries[0].observationSummary).toContain('Endpoint');
    expect(entries[0].vivaScore).toBe(4);
    expect(entries[0].vivaMax).toBe(5);
  });

  it('handles 5 rows (default limit boundary)', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      simulation_id: `sim-${i}`,
      experiment_id: null,
      observation_type: 'simple',
      observation_text: `obs ${i}`,
      structured_observations: null,
      conclusion: null,
      quiz_score: null,
      total_questions: null,
      subject: 'physics',
      created_at: `2026-05-0${i + 1}T10:00:00.000Z`,
    }));
    const supabase = makeMockSupabase(rows);
    const entries = await fetchRecentLabContext(supabase, STUDENT_ID);
    expect(entries).toHaveLength(5);
  });

  it('passes the 30-day cutoff to .gte() so old rows are filtered at the DB', async () => {
    const supabase = makeMockSupabase([]);
    await fetchRecentLabContext(supabase, STUDENT_ID);
    expect(supabase.gte).toHaveBeenCalledWith('created_at', expect.any(String));
    const passedCutoff = new Date(supabase.gte.mock.calls[0][1]);
    const expectedCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    // Tolerance: cutoff was computed inside the fetcher within the last second.
    const driftMs = Math.abs(passedCutoff.getTime() - expectedCutoff.getTime());
    expect(driftMs).toBeLessThan(5_000);
  });

  it('trims a 1000-char observation_text to ≤200 chars in summary (P12 prompt-bloat guard)', async () => {
    const longText = 'A'.repeat(1000);
    const supabase = makeMockSupabase([
      {
        simulation_id: 'big-obs',
        experiment_id: null,
        observation_type: 'simple',
        observation_text: longText,
        structured_observations: null,
        conclusion: null,
        quiz_score: null,
        total_questions: null,
        subject: 'physics',
        created_at: '2026-05-04T00:00:00.000Z',
      },
    ]);
    const entries = await fetchRecentLabContext(supabase, STUDENT_ID);
    expect(entries[0].observationSummary.length).toBeLessThanOrEqual(200);
  });

  it('trims a 1000-char conclusion to ≤300 chars (P12 prompt-bloat guard)', async () => {
    const longConclusion = 'B'.repeat(1000);
    const supabase = makeMockSupabase([
      {
        simulation_id: 'big-conc',
        experiment_id: null,
        observation_type: 'simple',
        observation_text: 'short obs',
        structured_observations: null,
        conclusion: longConclusion,
        quiz_score: null,
        total_questions: null,
        subject: 'physics',
        created_at: '2026-05-04T00:00:00.000Z',
      },
    ]);
    const entries = await fetchRecentLabContext(supabase, STUDENT_ID);
    expect(entries[0].conclusion).not.toBeNull();
    expect(entries[0].conclusion!.length).toBeLessThanOrEqual(300);
  });

  it('drops rows with neither observation summary nor conclusion (noise reduction)', async () => {
    const supabase = makeMockSupabase([
      {
        simulation_id: 'empty-row',
        experiment_id: null,
        observation_type: 'simple',
        observation_text: null,
        structured_observations: null,
        conclusion: null,
        quiz_score: null,
        total_questions: null,
        subject: 'physics',
        created_at: '2026-05-04T00:00:00.000Z',
      },
    ]);
    const entries = await fetchRecentLabContext(supabase, STUDENT_ID);
    expect(entries).toEqual([]);
  });

  it('drops rows with missing simulation_id', async () => {
    const supabase = makeMockSupabase([
      {
        simulation_id: '',
        experiment_id: null,
        observation_type: 'simple',
        observation_text: 'something',
        structured_observations: null,
        conclusion: null,
        quiz_score: null,
        total_questions: null,
        subject: 'physics',
        created_at: '2026-05-04T00:00:00.000Z',
      },
    ]);
    const entries = await fetchRecentLabContext(supabase, STUDENT_ID);
    expect(entries).toEqual([]);
  });
});

// ── buildLabContextSection ──────────────────────────────────────────────────

describe('buildLabContextSection', () => {
  it('returns "" when entries is empty', () => {
    expect(buildLabContextSection([], false)).toBe('');
    expect(buildLabContextSection([], true)).toBe('');
  });

  it('returns "" when entries is null/undefined (defensive)', () => {
    // @ts-expect-error — exercising the runtime guard
    expect(buildLabContextSection(null, false)).toBe('');
    // @ts-expect-error — exercising the runtime guard
    expect(buildLabContextSection(undefined, false)).toBe('');
  });

  const SAMPLE: LabContextEntry = {
    date: '2026-05-03',
    simulationId: "Ohm's Law",
    experimentId: null,
    subject: 'physics',
    type: 'guided',
    observationSummary: 'current rises linearly with voltage, slope ~ 1/R',
    conclusion: 'V = IR is verified within 5% error',
    vivaScore: 5,
    vivaMax: 5,
  };

  // P12 REGRESSION: this guardrail line MUST be present in every non-empty
  // English section. Foxy is forbidden from inventing labs not in the list.
  // If this test breaks, do NOT relax it without an assessment-agent review.
  it('includes the "NEVER invent" guardrail (P12 safety contract)', () => {
    const out = buildLabContextSection([SAMPLE], false);
    expect(out).toContain('NEVER invent or contradict');
    expect(out).toContain('NEVER reference labs not in this list');
  });

  it('includes the Hindi NEVER-invent guardrail when isHi=true (P12 + P7)', () => {
    const out = buildLabContextSection([SAMPLE], true);
    // Hindi guardrail line uses "कभी भी आविष्कार न करें" for "never invent".
    expect(out).toContain('कभी भी आविष्कार न करें');
    // And forbids referencing labs outside the list.
    expect(out).toContain('बाहर के किसी भी लैब का संदर्भ न दें');
  });

  it('uses English headers when isHi=false', () => {
    const out = buildLabContextSection([SAMPLE], false);
    expect(out).toContain('RECENT LAB ACTIVITY');
    expect(out).toContain('They observed');
    expect(out).toContain('Their conclusion');
    expect(out).toContain('Viva 5/5');
  });

  it('uses Hindi headers when isHi=true', () => {
    const out = buildLabContextSection([SAMPLE], true);
    expect(out).toContain('हाल की लैब गतिविधि');
    expect(out).toContain('उनका अवलोकन');
    expect(out).toContain('उनका निष्कर्ष');
    expect(out).toContain('वीवा 5/5');
  });

  it('numbers entries 1, 2, 3 in order', () => {
    const out = buildLabContextSection([SAMPLE, SAMPLE, SAMPLE], false);
    expect(out).toMatch(/^1\. /m);
    expect(out).toMatch(/^2\. /m);
    expect(out).toMatch(/^3\. /m);
  });

  it('omits the Viva line when vivaScore is null', () => {
    const noViva: LabContextEntry = { ...SAMPLE, vivaScore: null, vivaMax: null };
    const out = buildLabContextSection([noViva], false);
    expect(out).not.toContain('Viva ');
  });

  it('omits the conclusion line when conclusion is null', () => {
    const noConc: LabContextEntry = { ...SAMPLE, conclusion: null };
    const out = buildLabContextSection([noConc], false);
    expect(out).not.toContain('Their conclusion');
  });
});
