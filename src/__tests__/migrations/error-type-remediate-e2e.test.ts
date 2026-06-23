import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { hasSupabaseIntegrationEnv } from '../helpers/integration';

/**
 * PART C (error_type -> remediate) — END-TO-END regression (integration lane).
 *
 * Companion to the always-on structural pins in
 * src/__tests__/foxy-weak-area-loop-integrity-pins.test.ts (which grep the
 * migration source). This file exercises the LEARNER-STATE CONSUMER CHAIN that
 * submit_quiz_results_v2 now feeds, against the LIVE migrated DB:
 *
 *   update_learner_state_post_quiz(p_error_type='conceptual') on a WRONG answer
 *     -> concept_mastery.error_count_conceptual increments
 *   3 conceptual errors on a (subject, grade)-scoped topic
 *     -> compute_post_quiz_action(student, subject, grade) returns 'remediate'
 *   a CORRECT answer
 *     -> error_count_conceptual does NOT increment
 *
 * WHAT THIS PROVES (assessment-defined): the chain submit_quiz_results_v2 wires
 * (server-classified error_type -> consumer -> error_count_* -> remediate tier)
 * actually moves the counters and trips the remediation action. The migration
 * 20260623000300 feeds the COMPUTED value into THIS RPC; the structural pin
 * proves the wiring, this proves the consumer behavior.
 *
 * LANE: integration. Skips cleanly unless real Supabase creds are present.
 *
 * DATA HYGIENE: reuses ONE existing student + ONE existing curriculum_topics row
 * (read from the DB; we use its subject.code + grade so compute_post_quiz_action's
 * join matches). The only rows written are concept_mastery for that exact
 * (student_id, topic_id) pair. beforeAll asserts a clean slate; afterAll DELETEs
 * the concept_mastery row it owns. No throwaway students/topics/questions; no
 * XP / quiz_sessions / score writes.
 */

const describeIntegration = hasSupabaseIntegrationEnv() ? describe : describe.skip;

const POST_QUIZ_RPC = 'update_learner_state_post_quiz';
const ACTION_RPC = 'compute_post_quiz_action';

interface Scope {
  studentId: string;
  topicId: string;
  subjectCode: string;
  grade: string;
}

async function apply(
  admin: SupabaseClient,
  scope: Scope,
  isCorrect: boolean,
  errorType: 'conceptual' | 'procedural' | 'careless' | null,
): Promise<void> {
  const { error } = await admin.rpc(POST_QUIZ_RPC, {
    p_student_id: scope.studentId,
    p_topic_id: scope.topicId,
    p_is_correct: isCorrect,
    p_bloom_level: null,
    p_error_type: errorType,
    p_response_time_ms: null,
    p_difficulty: null,
  });
  if (error) throw new Error(`${POST_QUIZ_RPC} failed: ${error.message}`);
}

async function readErrorCounts(
  admin: SupabaseClient,
  scope: Scope,
): Promise<{ conceptual: number; procedural: number; careless: number }> {
  const { data, error } = await admin
    .from('concept_mastery')
    .select('error_count_conceptual, error_count_procedural, error_count_careless')
    .eq('student_id', scope.studentId)
    .eq('topic_id', scope.topicId)
    .maybeSingle();
  if (error) throw new Error(`read concept_mastery failed: ${error.message}`);
  return {
    conceptual: data?.error_count_conceptual ?? 0,
    procedural: data?.error_count_procedural ?? 0,
    careless: data?.error_count_careless ?? 0,
  };
}

describeIntegration('PART C — error_type consumer chain -> remediate (live DB)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: SupabaseClient<any>;
  let scope: Scope;

  beforeAll(async () => {
    const { makeServiceSupabase } = await import('./_helpers/supabase-runtime');
    admin = makeServiceSupabase();

    // Pick one existing student.
    const { data: student, error: sErr } = await admin
      .from('students')
      .select('id')
      .limit(1)
      .maybeSingle();
    if (sErr || !student) throw new Error('no existing student to drive the test');

    // Pick one existing active curriculum topic, reading its subject.code + grade
    // so compute_post_quiz_action's join (subjects.code + curriculum_topics.grade)
    // resolves to this row.
    const { data: topic, error: tErr } = await admin
      .from('curriculum_topics')
      .select('id, grade, subjects!inner(code)')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    if (tErr || !topic) throw new Error('no existing active curriculum topic to drive the test');

    const subjectRel = (topic as { subjects: { code: string } | Array<{ code: string }> }).subjects;
    const subjectCode = Array.isArray(subjectRel) ? subjectRel[0].code : subjectRel.code;

    scope = {
      studentId: student.id as string,
      topicId: (topic as { id: string }).id,
      subjectCode,
      grade: (topic as { grade: string }).grade,
    };

    // Clean slate: remove any pre-existing concept_mastery row for this pair so
    // counts start at 0 and afterAll's delete is exact. ADR-005 exemption: this
    // is TEST data hygiene (throwaway-row cleanup), not a production canonical
    // write — the assertions drive the canonical writer (update_learner_state_post_quiz).
    // eslint-disable-next-line alfanumrik/no-canonical-write-outside-projector
    await admin
      .from('concept_mastery')
      .delete()
      .eq('student_id', scope.studentId)
      .eq('topic_id', scope.topicId);
  });

  afterAll(async () => {
    if (!admin || !scope) return;
    // ADR-005 exemption: test-only cleanup of the throwaway concept_mastery row.
    // eslint-disable-next-line alfanumrik/no-canonical-write-outside-projector
    await admin
      .from('concept_mastery')
      .delete()
      .eq('student_id', scope.studentId)
      .eq('topic_id', scope.topicId);
  });

  it('a WRONG answer with error_type=conceptual increments error_count_conceptual', async () => {
    await apply(admin, scope, false, 'conceptual');
    const counts = await readErrorCounts(admin, scope);
    expect(counts.conceptual).toBe(1);
    expect(counts.procedural).toBe(0);
    expect(counts.careless).toBe(0);
  });

  it('a CORRECT answer does NOT increment any error count', async () => {
    const before = await readErrorCounts(admin, scope);
    // p_error_type passed null mirrors submit_quiz_results_v2's correct-answer path.
    await apply(admin, scope, true, null);
    const after = await readErrorCounts(admin, scope);
    expect(after.conceptual).toBe(before.conceptual);
    expect(after.procedural).toBe(before.procedural);
    expect(after.careless).toBe(before.careless);
  });

  it('3 conceptual errors trip compute_post_quiz_action -> remediate', async () => {
    // We have 1 conceptual from the first test; add 2 more to reach the >= 3 floor.
    await apply(admin, scope, false, 'conceptual');
    await apply(admin, scope, false, 'conceptual');
    const counts = await readErrorCounts(admin, scope);
    expect(counts.conceptual).toBeGreaterThanOrEqual(3);

    const { data, error } = await admin.rpc(ACTION_RPC, {
      p_student_id: scope.studentId,
      p_subject: scope.subjectCode,
      p_grade: scope.grade,
    });
    expect(error).toBeNull();
    const rows = (data ?? []) as Array<{ action_type: string; concept_id: string; reason: string }>;
    const remediate = rows.find((r) => r.action_type === 'remediate');
    expect(remediate, `expected a remediate action; got ${JSON.stringify(rows)}`).toBeTruthy();
    expect(remediate!.concept_id).toBe(scope.topicId);
    expect(remediate!.reason).toMatch(/conceptual/i);
  });
});
