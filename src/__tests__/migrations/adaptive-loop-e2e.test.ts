import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { hasSupabaseIntegrationEnv } from '../helpers/integration';

/**
 * PHASE 0 adaptive-loop fix — END-TO-END regression (integration lane).
 *
 * THE BUG THIS WOULD HAVE CAUGHT
 * ------------------------------
 * Before the Phase-0 fix, a quiz could be submitted successfully (score + XP
 * persisted) while concept_mastery was NEVER written. Two root causes, fixed
 * by two migrations:
 *
 *   1. 20260622020000_add_concept_mastery_cme_columns.sql
 *      Added the 13 BKT/CME/retention columns that update_learner_state_post_quiz
 *      (20260615181255) INSERT/UPDATEs but that were ABSENT from live
 *      public.concept_mastery. Their absence made the RPC throw.
 *
 *   2. 20260622030000_submit_quiz_v2_resilient_mastery_perform.sql
 *      The per-response `PERFORM update_learner_state_post_quiz(...)` inside
 *      submit_quiz_results_v2 ran UN-wrapped, so the throw from (1) aborted the
 *      ENTIRE quiz submit → client fell back to XP-only and mastery was never
 *      persisted. The fix wraps the PERFORM in BEGIN…EXCEPTION WHEN OTHERS so a
 *      single failing learner-state write can no longer abort the submit.
 *
 * This test calls update_learner_state_post_quiz directly against the LIVE,
 * MIGRATED DB and asserts the directional mastery invariants defined by the
 * assessment agent. Pre-fix (missing columns) the RPC would throw here and the
 * test would fail loudly — exactly the break it is meant to catch.
 *
 * LANE: integration. Gated by hasSupabaseIntegrationEnv() (the repo's
 * placeholder-aware live-DB gate — see helpers/integration.ts). CI sets
 * placeholder Supabase creds, so this whole block evaluates to describe.skip in
 * normal `npm test` / CI and only runs when real NEXT_PUBLIC_SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY are present. The structural pin
 * (resilient-mastery-perform-structure.test.ts) is the always-on companion.
 *
 * DATA HYGIENE: every concept_mastery row created here is DELETEd in afterAll,
 * keyed by the exact (student_id, topic_id) pairs used, so prod data stays
 * clean. No throwaway students/topics are created — we reuse one existing
 * student and two existing active topics, on (student, topic) pairs that had no
 * prior concept_mastery row (asserted in beforeAll).
 */

const describeIntegration = hasSupabaseIntegrationEnv() ? describe : describe.skip;

const EPS = 1e-9;

describeIntegration('adaptive-loop e2e — mastery is written & directionally correct (live RPC)', () => {
  let admin: SupabaseClient;
  let studentId: string;
  let topicCorrect: string; // CORRECT-case topic
  let topicWrong: string; //   WRONG-case topic

  type Row = {
    mastery_level: string | null;
    attempts: number;
    correct_attempts: number;
    streak_current: number;
    consecutive_wrong: number;
    ease_factor: number;
    review_interval_days: number;
    error_count_conceptual: number;
    error_count_procedural: number;
    error_count_careless: number;
    last_attempted_at: string | null;
    next_review_at: string | null;
  };

  const SELECT_COLS =
    'mastery_level, attempts, correct_attempts, streak_current, consecutive_wrong, ' +
    'ease_factor, review_interval_days, error_count_conceptual, error_count_procedural, ' +
    'error_count_careless, last_attempted_at, next_review_at';

  async function readRow(topicId: string): Promise<Row> {
    const { data, error } = await admin
      .from('concept_mastery')
      .select(SELECT_COLS)
      .eq('student_id', studentId)
      .eq('topic_id', topicId)
      .single();
    if (error) throw new Error(`readRow(${topicId}) failed: ${error.message}`);
    return data as unknown as Row;
  }

  /** Call the learner-state RPC for one response. Throws on RPC error — which is
   *  itself the regression signal (pre-fix this throws on the missing columns). */
  async function applyResponse(
    topicId: string,
    isCorrect: boolean,
    errorType: string | null,
  ): Promise<void> {
    const { error } = await admin.rpc('update_learner_state_post_quiz', {
      p_student_id: studentId,
      p_topic_id: topicId,
      p_is_correct: isCorrect,
      p_bloom_level: 'understand',
      p_error_type: errorType,
      p_response_time_ms: 5000,
      p_difficulty: 2,
    });
    if (error) {
      throw new Error(
        `update_learner_state_post_quiz threw (this is the Phase-0 break): ${error.message}`,
      );
    }
  }

  const masteryOf = (r: Row): number => parseFloat(r.mastery_level ?? '0');

  beforeAll(async () => {
    const { createClient } = await import('@supabase/supabase-js');
    admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );

    // Reuse one existing student (FK: concept_mastery.student_id -> students.id).
    const { data: student, error: sErr } = await admin
      .from('students')
      .select('id')
      .limit(1)
      .single();
    if (sErr || !student) throw new Error(`no student available: ${sErr?.message}`);
    studentId = student.id;

    // Reuse two existing active topics (FK: topic_id -> curriculum_topics.id).
    const { data: topics, error: tErr } = await admin
      .from('curriculum_topics')
      .select('id')
      .eq('is_active', true)
      .order('id', { ascending: true })
      .limit(2);
    if (tErr || !topics || topics.length < 2) {
      throw new Error(`need 2 active topics: ${tErr?.message}`);
    }
    topicCorrect = topics[0].id;
    topicWrong = topics[1].id;

    // Ensure both (student, topic) pairs start clean so this run is independent
    // and our afterAll delete only removes rows this test owns.
    await admin
      .from('concept_mastery')
      .delete()
      .eq('student_id', studentId)
      .in('topic_id', [topicCorrect, topicWrong]);

    const { count } = await admin
      .from('concept_mastery')
      .select('*', { count: 'exact', head: true })
      .eq('student_id', studentId)
      .in('topic_id', [topicCorrect, topicWrong]);
    expect(count ?? 0).toBe(0);
  });

  afterAll(async () => {
    if (!admin || !studentId) return;
    await admin
      .from('concept_mastery')
      .delete()
      .eq('student_id', studentId)
      .in('topic_id', [topicCorrect, topicWrong]);
  });

  // ───────────────────────────────────────────────────────────────────────
  // MINIMUM VIABLE CANARY — proves mastery is written at all (the core break).
  // ───────────────────────────────────────────────────────────────────────
  it('CANARY: a single response writes a concept_mastery row (mastery was NOT silently dropped)', async () => {
    await applyResponse(topicCorrect, true, null);

    const r = await readRow(topicCorrect); // .single() throws if row missing → caught
    expect(r.attempts).toBe(1); // attempts == #responses
    expect(r.correct_attempts).toBe(1); // correct_attempts == #correct
    expect(r.correct_attempts).toBeLessThanOrEqual(r.attempts);
    const m = masteryOf(r);
    expect(m).toBeGreaterThanOrEqual(0);
    expect(m).toBeLessThanOrEqual(1); // mastery_level::float in [0,1]
    expect(new Date(r.next_review_at!).getTime()).toBeGreaterThan(Date.now()); // next_review_at > now
  });

  // ───────────────────────────────────────────────────────────────────────
  // CORRECT case — directional invariants (assessment agent).
  // Baseline seeded above by the canary (1 correct). We apply a 2nd correct
  // and compare deltas on the DO UPDATE path.
  // ───────────────────────────────────────────────────────────────────────
  it('CORRECT response moves every signal in the right direction', async () => {
    const before = await readRow(topicCorrect);
    await applyResponse(topicCorrect, true, null);
    const after = await readRow(topicCorrect);

    expect(masteryOf(after)).toBeGreaterThanOrEqual(masteryOf(before)); // new mastery >= old
    expect(after.consecutive_wrong).toBe(0);
    expect(after.streak_current).toBe(before.streak_current + 1); // streak +1
    expect(after.correct_attempts).toBe(before.correct_attempts + 1); // correct +1
    expect(after.attempts).toBe(before.attempts + 1); // attempts +1
    expect(after.ease_factor).toBeGreaterThanOrEqual(before.ease_factor); // non-decreasing
    expect(after.error_count_conceptual).toBe(before.error_count_conceptual); // unchanged
    expect(after.error_count_procedural).toBe(before.error_count_procedural);
    expect(after.error_count_careless).toBe(before.error_count_careless);

    expect(new Date(after.last_attempted_at!).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(new Date(after.next_review_at!).getTime()).toBeGreaterThan(Date.now());
  });

  // ───────────────────────────────────────────────────────────────────────
  // WRONG case — directional invariants (assessment agent).
  // Seed a fresh baseline (1 correct so a row exists with streak=1,
  // consecutive_wrong=0), then apply a WRONG response with a conceptual error.
  // ───────────────────────────────────────────────────────────────────────
  it('WRONG response moves every signal in the right direction', async () => {
    // Seed baseline so we exercise the DO UPDATE path (streak resets, cw +1).
    await applyResponse(topicWrong, true, null);
    const before = await readRow(topicWrong);
    expect(before.streak_current).toBeGreaterThanOrEqual(1);

    await applyResponse(topicWrong, false, 'conceptual');
    const after = await readRow(topicWrong);

    expect(masteryOf(after)).toBeLessThanOrEqual(masteryOf(before) + EPS); // new mastery <= old (±1e-9)
    expect(after.consecutive_wrong).toBe(before.consecutive_wrong + 1); // cw +1
    expect(after.streak_current).toBe(0); // streak reset
    expect(after.correct_attempts).toBe(before.correct_attempts); // correct unchanged
    expect(after.attempts).toBe(before.attempts + 1); // attempts +1
    expect(after.ease_factor).toBeLessThanOrEqual(before.ease_factor); // non-increasing
    expect(after.review_interval_days).toBe(1); // sm2_interval == 1 on wrong
    expect(after.error_count_conceptual).toBe(before.error_count_conceptual + 1); // matching type +1
    expect(after.error_count_procedural).toBe(before.error_count_procedural); // other types unchanged
    expect(after.error_count_careless).toBe(before.error_count_careless);

    expect(new Date(after.next_review_at!).getTime()).toBeGreaterThan(Date.now());
  });
});
