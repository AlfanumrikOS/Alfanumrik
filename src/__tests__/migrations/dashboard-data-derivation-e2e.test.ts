import { describe, it, expect, beforeAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { hasSupabaseIntegrationEnv } from '../helpers/integration';

/**
 * get_dashboard_data bloom + knowledge_gaps derivation fix — END-TO-END
 * regression (integration lane).
 *
 * Companion to the always-on structural pins
 * (dashboard-data-derivation-structure.test.ts). This file exercises the
 * repointed get_dashboard_data RPC against the LIVE, MIGRATED DB to prove the
 * derive-from-concept_mastery contract actually holds on real backfilled data —
 * AND that get_dashboard_data's OWN emitted shape (single 7-key bloom object;
 * 5-field knowledge_gaps array) is preserved, distinct from the standalone RPCs.
 *
 * THE BUG (RCA): get_dashboard_data read the empty public.bloom_progression /
 * public.knowledge_gaps tables INLINE, so the dashboard 'bloom' key was null and
 * 'knowledge_gaps' was []. Migration 20260623000800 repoints both INLINE reads to
 * DERIVE from the populated public.concept_mastery — the single source of truth.
 *
 * WHAT THIS PROVES (assessment-defined contract):
 *   get_dashboard_data(student with concept_mastery):
 *     - all ~11 top-level keys present.
 *     - bloom is a non-null OBJECT (not an array) with current_bloom_level + the
 *       6 *_mastery keys, each numeric in [0,1].
 *     - knowledge_gaps is a non-empty ARRAY, worst-first
 *       (confidence_score DESC == 1 - mastery_probability), each row the 5-field
 *       shape { id, target_concept_name, missing_prerequisite_name, status,
 *       confidence_score } with status === 'open'.
 *   get_dashboard_data(empty student):
 *     - bloom null (or empty), knowledge_gaps [], no error, all ~11 keys present.
 *
 * LANE: integration. Skips cleanly unless real Supabase creds are present
 * (hasSupabaseIntegrationEnv() — placeholder-aware) OR RUN_INTEGRATION_TESTS=1
 * is set with real creds. The structural pins are the always-on companion.
 *
 * DATA HYGIENE: READ-ONLY against an existing backfilled student (this RPC never
 * writes). The only mutation is a throwaway empty student created to prove the
 * empty-data branch, deleted in the same test. No quiz_sessions / XP / score
 * writes.
 */

const wantIntegration =
  hasSupabaseIntegrationEnv() ||
  (process.env.RUN_INTEGRATION_TESTS === '1' && hasSupabaseIntegrationEnv());
const describeIntegration = wantIntegration ? describe : describe.skip;

const TOP_LEVEL_KEYS = [
  'profiles',
  'due_count',
  'unread_count',
  'knowledge_gaps',
  'velocity',
  'bloom',
  'cbse_readiness',
  'exams',
  'nudges',
  'retention_score',
  'error_breakdown',
] as const;

const BLOOM_MASTERY_KEYS = [
  'remember_mastery',
  'understand_mastery',
  'apply_mastery',
  'analyze_mastery',
  'evaluate_mastery',
  'create_mastery',
] as const;

type BloomObject = Record<string, unknown> & { current_bloom_level?: unknown };
type GapRow = {
  id: unknown;
  target_concept_name: string;
  missing_prerequisite_name: string;
  status: string;
  confidence_score: number;
};
type DashboardData = Record<string, unknown> & {
  bloom: BloomObject | null;
  knowledge_gaps: GapRow[];
};

describeIntegration('get_dashboard_data derivation e2e (live RPC vs concept_mastery)', () => {
  let admin: SupabaseClient;
  let backfilledStudentId: string;

  beforeAll(async () => {
    const { createClient } = await import('@supabase/supabase-js');
    admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );

    // Find a student that actually has practiced concept_mastery rows so the
    // derive-from-concept_mastery path has something to aggregate. Prefer the
    // architect-named backfilled student; fall back to any student with rows.
    const PREFERRED = '136bcdcd';
    const { data: prefRows } = await admin
      .from('concept_mastery')
      .select('student_id')
      .gt('attempts', 0)
      .ilike('student_id', `${PREFERRED}%`)
      .limit(1);
    if (prefRows && prefRows.length > 0) {
      backfilledStudentId = prefRows[0].student_id;
      return;
    }

    const { data: anyRows, error } = await admin
      .from('concept_mastery')
      .select('student_id')
      .gt('attempts', 0)
      .limit(1);
    if (error || !anyRows || anyRows.length === 0) {
      throw new Error(
        `no student with practiced concept_mastery rows available: ${error?.message ?? 'none'}`,
      );
    }
    backfilledStudentId = anyRows[0].student_id;
  });

  // ───────────────────────────────────────────────────────────────────────
  // Backfilled student: bloom object + knowledge_gaps array hold the contract.
  // ───────────────────────────────────────────────────────────────────────
  it('returns all ~11 top-level keys, a non-null bloom OBJECT, and a worst-first 5-field knowledge_gaps array', async () => {
    const { data, error } = await admin.rpc('get_dashboard_data', {
      p_student_id: backfilledStudentId,
    });
    expect(error).toBeNull();
    const dash = data as DashboardData;
    expect(dash).toBeTruthy();
    expect((dash as Record<string, unknown>).error).toBeUndefined();

    // all top-level keys present.
    for (const key of TOP_LEVEL_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(dash, key), `missing key '${key}'`).toBe(true);
    }

    // bloom is a single OBJECT (not an array, not null) with the 7-key shape.
    const bloom = dash.bloom;
    expect(bloom).not.toBeNull();
    expect(Array.isArray(bloom)).toBe(false);
    expect(typeof bloom).toBe('object');
    expect(typeof (bloom as BloomObject).current_bloom_level).toBe('string');
    for (const key of BLOOM_MASTERY_KEYS) {
      const v = Number((bloom as BloomObject)[key]);
      expect(Number.isFinite(v), `${key} not numeric`).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }

    // knowledge_gaps is a non-empty array, worst-first (confidence_score DESC),
    // each row the EXACT 5-field shape with status 'open'.
    const gaps = dash.knowledge_gaps;
    expect(Array.isArray(gaps)).toBe(true);
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.length).toBeLessThanOrEqual(3); // prior inline cap.

    for (let i = 1; i < gaps.length; i++) {
      expect(gaps[i].confidence_score).toBeLessThanOrEqual(gaps[i - 1].confidence_score + 1e-9);
    }
    for (const g of gaps) {
      // exactly the 5 declared fields, no more.
      expect(Object.keys(g).sort()).toEqual(
        ['confidence_score', 'id', 'missing_prerequisite_name', 'status', 'target_concept_name'].sort(),
      );
      expect(g.status).toBe('open');
      expect(typeof g.target_concept_name).toBe('string');
      expect(g.target_concept_name.length).toBeGreaterThan(0);
      expect(typeof g.missing_prerequisite_name).toBe('string');
      expect(g.confidence_score).toBeGreaterThanOrEqual(0);
      expect(g.confidence_score).toBeLessThanOrEqual(1);
    }

    // eslint-disable-next-line no-console
    console.warn(
      '[dashboard-derivation-e2e] bloom.current_bloom_level:',
      (bloom as BloomObject).current_bloom_level,
      '| gaps:',
      gaps.length,
      gaps.length ? `worst confidence=${gaps[0].confidence_score}` : '(none weak)',
    );
  });

  // ───────────────────────────────────────────────────────────────────────
  // Empty student: bloom null/empty, knowledge_gaps [], no error, keys present.
  // ───────────────────────────────────────────────────────────────────────
  it('empty student → bloom null/empty + knowledge_gaps [] + no error + all keys present', async () => {
    // Create a throwaway student with zero concept_mastery, run the RPC, clean up.
    const { data: newStudent, error: insErr } = await admin
      .from('students')
      .insert({
        full_name: 'dashboard-derivation-e2e throwaway',
        grade: '6',
        board: 'CBSE',
      })
      .select('id')
      .single();

    // If the students table requires columns we can't satisfy in this env, fall
    // back to a random UUID. NOTE: get_dashboard_data returns {error:'Student not
    // found'} when no students row exists, so prefer the real throwaway row.
    const emptyStudentId: string | null =
      !insErr && newStudent ? newStudent.id : null;

    if (!emptyStudentId) {
      // Cannot create a real empty student in this env — skip the assertion
      // rather than assert against the not-found branch (different contract).
      // eslint-disable-next-line no-console
      console.warn(
        '[dashboard-derivation-e2e] could not create throwaway student; skipping empty-branch assertions:',
        insErr?.message,
      );
      return;
    }

    try {
      const { data, error } = await admin.rpc('get_dashboard_data', {
        p_student_id: emptyStudentId,
      });
      expect(error).toBeNull();
      const dash = data as DashboardData;
      expect(dash).toBeTruthy();
      expect((dash as Record<string, unknown>).error).toBeUndefined();

      for (const key of TOP_LEVEL_KEYS) {
        expect(Object.prototype.hasOwnProperty.call(dash, key), `missing key '${key}'`).toBe(true);
      }

      // bloom null (no practiced concepts).
      expect(dash.bloom == null).toBe(true);
      // knowledge_gaps is the empty array.
      expect(Array.isArray(dash.knowledge_gaps)).toBe(true);
      expect(dash.knowledge_gaps).toEqual([]);
    } finally {
      await admin.from('students').delete().eq('id', emptyStudentId);
    }
  });
});
