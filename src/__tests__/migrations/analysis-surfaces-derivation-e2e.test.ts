import { describe, it, expect, beforeAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { hasSupabaseIntegrationEnv } from '../helpers/integration';

/**
 * Analysis-surface derivation fix — END-TO-END regression (integration lane).
 *
 * Companion to the always-on structural pins
 * (analysis-surfaces-derivation-structure.test.ts). This file exercises the two
 * repointed RPCs against the LIVE, MIGRATED DB to prove the derive-from-
 * concept_mastery contract actually holds on real backfilled data.
 *
 * THE BUG (RCA): get_bloom_progression + get_knowledge_gaps read FROM the empty
 * public.bloom_progression / public.knowledge_gaps tables, so both always
 * returned []. The progress surfaces (MasteryBloomPanel, KnowledgeGapActions)
 * were dead. Migration 20260623000700 repoints both to DERIVE from the populated
 * public.concept_mastery — the single source of truth.
 *
 * WHAT THIS PROVES (assessment-defined contract):
 *   get_bloom_progression(student with concept_mastery):
 *     - returns >= 1 object per PRACTICED subject (not []).
 *     - every object has all 6 *_mastery keys, each numeric in [0,1].
 *     - the subject filter narrows the result to that subject.
 *     - an empty (no-concept_mastery) student → [].
 *   get_knowledge_gaps(student):
 *     - weak concepts worst-first (mastery_probability ASC).
 *     - confidence_score == 1 - mastery_probability (±1e-9).
 *     - severity matches the strict ">" thresholds (>0.7 critical, >0.4 high, else medium).
 *     - superset fields present (target_concept_name non-empty, subject, topic,
 *       mastery_probability, status === 'open').
 *     - an empty (no-concept_mastery) student → [].
 *
 * LANE: integration. Skips cleanly unless real Supabase creds are present
 * (hasSupabaseIntegrationEnv() — placeholder-aware) OR RUN_INTEGRATION_TESTS=1
 * is set with real creds. The structural pins are the always-on companion.
 *
 * DATA HYGIENE: READ-ONLY against an existing backfilled student (these two RPCs
 * never write). The only mutation is an optional throwaway empty student created
 * to prove the []-for-no-data branch, deleted in the same test. No quiz_sessions
 * / XP / score writes.
 */

const wantIntegration =
  hasSupabaseIntegrationEnv() ||
  (process.env.RUN_INTEGRATION_TESTS === '1' && hasSupabaseIntegrationEnv());
const describeIntegration = wantIntegration ? describe : describe.skip;

const BLOOM_KEYS = [
  'remember_mastery',
  'understand_mastery',
  'apply_mastery',
  'analyze_mastery',
  'evaluate_mastery',
  'create_mastery',
] as const;

type BloomRow = Record<string, unknown> & { subject: string };
type GapRow = {
  target_concept_name: string;
  missing_prerequisite_name: string;
  detection_method: string;
  confidence_score: number;
  mastery_probability: number;
  severity: string;
  status: string;
  subject: string;
  topic: string;
  detected_at: string;
};

function expectedSeverity(confidence: number): string {
  if (confidence > 0.7) return 'critical';
  if (confidence > 0.4) return 'high';
  return 'medium';
}

describeIntegration('analysis-surface derivation e2e (live RPCs vs concept_mastery)', () => {
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
  // get_bloom_progression
  // ───────────────────────────────────────────────────────────────────────
  it('get_bloom_progression returns >= 1 object per practiced subject; each has all 6 *_mastery keys in [0,1]', async () => {
    const { data, error } = await admin.rpc('get_bloom_progression', {
      p_student_id: backfilledStudentId,
      p_subject: null,
    });
    expect(error).toBeNull();
    const rows = (data ?? []) as BloomRow[];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThanOrEqual(1);

    const subjects = new Set<string>();
    for (const r of rows) {
      expect(typeof r.subject).toBe('string');
      expect((r.subject ?? '').length).toBeGreaterThan(0);
      // one object per subject — subjects must be unique.
      expect(subjects.has(r.subject)).toBe(false);
      subjects.add(r.subject);

      for (const key of BLOOM_KEYS) {
        const v = Number(r[key]);
        expect(Number.isFinite(v), `${key} not numeric on subject ${r.subject}`).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }

    // eslint-disable-next-line no-console
    console.warn(
      '[analysis-derivation-e2e] bloom subjects:',
      JSON.stringify(Array.from(subjects)),
    );
  });

  it('get_bloom_progression subject filter narrows to that subject', async () => {
    const { data: all } = await admin.rpc('get_bloom_progression', {
      p_student_id: backfilledStudentId,
      p_subject: null,
    });
    const allRows = (all ?? []) as BloomRow[];
    expect(allRows.length).toBeGreaterThanOrEqual(1);
    const targetSubject = allRows[0].subject;

    const { data: filtered, error } = await admin.rpc('get_bloom_progression', {
      p_student_id: backfilledStudentId,
      p_subject: targetSubject,
    });
    expect(error).toBeNull();
    const filteredRows = (filtered ?? []) as BloomRow[];
    expect(filteredRows.length).toBeGreaterThanOrEqual(1);
    for (const r of filteredRows) {
      expect(r.subject).toBe(targetSubject);
    }
    // filter cannot widen the result.
    expect(filteredRows.length).toBeLessThanOrEqual(allRows.length);
  });

  // ───────────────────────────────────────────────────────────────────────
  // get_knowledge_gaps
  // ───────────────────────────────────────────────────────────────────────
  it('get_knowledge_gaps returns weak concepts worst-first; confidence/severity/superset fields all hold the contract', async () => {
    const { data, error } = await admin.rpc('get_knowledge_gaps', {
      p_student_id: backfilledStudentId,
      p_subject: null,
      p_limit: 20,
    });
    expect(error).toBeNull();
    const rows = (data ?? []) as GapRow[];
    expect(Array.isArray(rows)).toBe(true);

    // worst-first: mastery_probability ascending.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].mastery_probability).toBeGreaterThanOrEqual(
        rows[i - 1].mastery_probability - 1e-9,
      );
    }

    for (const r of rows) {
      // confidence_score == 1 - mastery_probability (within rounding tolerance —
      // both columns are ROUND(...,4) so allow a 4-dp epsilon).
      expect(Math.abs(r.confidence_score - (1 - r.mastery_probability))).toBeLessThanOrEqual(1e-4);
      // severity matches the strict ">" thresholds against confidence_score.
      expect(r.severity).toBe(expectedSeverity(r.confidence_score));
      // superset fields present + well-formed.
      expect(typeof r.target_concept_name).toBe('string');
      expect(r.target_concept_name.length).toBeGreaterThan(0);
      expect(typeof r.subject).toBe('string');
      expect(typeof r.topic).toBe('string');
      expect(r.mastery_probability).toBeGreaterThanOrEqual(0);
      expect(r.mastery_probability).toBeLessThanOrEqual(1);
      expect(r.status).toBe('open');
    }

    // eslint-disable-next-line no-console
    console.warn(
      '[analysis-derivation-e2e] knowledge gaps:',
      rows.length,
      rows.length
        ? `worst=${rows[0].mastery_probability} sev=${rows[0].severity}`
        : '(none weak)',
    );
  });

  it('get_knowledge_gaps respects p_limit', async () => {
    const { data, error } = await admin.rpc('get_knowledge_gaps', {
      p_student_id: backfilledStudentId,
      p_subject: null,
      p_limit: 1,
    });
    expect(error).toBeNull();
    const rows = (data ?? []) as GapRow[];
    expect(rows.length).toBeLessThanOrEqual(1);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Empty-student branch: both RPCs return [] (not null, not error).
  // ───────────────────────────────────────────────────────────────────────
  it('both RPCs return [] for a student with no concept_mastery rows', async () => {
    // Create a throwaway student with zero concept_mastery, run both RPCs, clean up.
    const { data: newStudent, error: insErr } = await admin
      .from('students')
      .insert({
        full_name: 'analysis-derivation-e2e throwaway',
        grade: '6',
        board: 'CBSE',
      })
      .select('id')
      .single();

    // If the students table requires columns we can't satisfy in this env, fall
    // back to a random UUID that simply has no concept_mastery rows.
    const emptyStudentId: string =
      !insErr && newStudent ? newStudent.id : crypto.randomUUID();

    try {
      const bloom = await admin.rpc('get_bloom_progression', {
        p_student_id: emptyStudentId,
        p_subject: null,
      });
      expect(bloom.error).toBeNull();
      expect(bloom.data).toEqual([]);

      const gaps = await admin.rpc('get_knowledge_gaps', {
        p_student_id: emptyStudentId,
        p_subject: null,
        p_limit: 10,
      });
      expect(gaps.error).toBeNull();
      expect(gaps.data).toEqual([]);
    } finally {
      if (!insErr && newStudent) {
        await admin.from('students').delete().eq('id', emptyStudentId);
      }
    }
  });
});
