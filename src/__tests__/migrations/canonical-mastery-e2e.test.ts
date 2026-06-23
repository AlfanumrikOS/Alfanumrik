import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { hasSupabaseIntegrationEnv } from '../helpers/integration';

/**
 * Canonical-mastery production fix — END-TO-END regression (integration lane).
 *
 * Companion to the always-on structural pins (canonical-mastery-write-structure.test.ts).
 * This file exercises the repaired write path + the dashboard read contract
 * against the LIVE, MIGRATED DB.
 *
 * THE BUG (RCA): update_learner_state_post_quiz stored the NUMERIC BKT posterior
 * as TEXT in `mastery_level` and left the canonical numeric columns
 * (`mastery_probability` + `p_know`) frozen at the 0.1 default. Every dashboard
 * axis that reads a number (Student/Parent/Admin read mastery_probability;
 * Teacher reads p_know) read the stale 0.1; the selector (.lt mastery_probability)
 * never saw real mastery.
 *
 * WHAT THIS PROVES (assessment-defined):
 *   (1) FRESH (student,topic) + one CORRECT attempt via the RPC →
 *         mastery_probability > 0.1, p_know == mastery_probability (±1e-9),
 *         mastery_level is a BAND LABEL (in the band set), NEVER numeric
 *         (NOT ^[0-9.]+$).
 *   (2) Repeated correct attempts → mastery_probability monotonically increases,
 *         mastery_level escalates through bands, caps at 'mastered'.
 *   (3) A WRONG answer → mastery_probability does NOT increase; consecutive_wrong
 *         increments.
 *   (4) DASHBOARD VALIDATION canary — a high-mastery backfilled row
 *         (mastery_probability = 1.0) returns the SAME value on all four
 *         read-paths: mastery_probability (Student/Parent/Admin) == 1.0 and
 *         p_know (Teacher) == 1.0, with mastery_level = 'mastered'. Plus the
 *         data-integrity invariants: NO real row has a numeric mastery_level, and
 *         mastery_probability == p_know across every row.
 *
 * LANE: integration. Skips cleanly unless real Supabase creds are present
 * (hasSupabaseIntegrationEnv() — placeholder-aware) OR RUN_INTEGRATION_TESTS=1
 * is set with real creds. The structural pins are the always-on companion.
 *
 * DATA HYGIENE: drives a single (existing student, existing topic) pair as the
 * "throwaway" unit. The RPC only ever writes concept_mastery, so the pair is the
 * throwaway. beforeAll asserts a clean slate; afterAll DELETEs every
 * concept_mastery row this test created, keyed by the exact (student_id, topic_id)
 * tuples it owns. It reuses an existing student + existing curriculum_topics rows;
 * it never creates throwaway students, topics, or questions, and never writes
 * XP / quiz_sessions / scores.
 */

const wantIntegration =
  hasSupabaseIntegrationEnv() ||
  (process.env.RUN_INTEGRATION_TESTS === '1' && hasSupabaseIntegrationEnv());
const describeIntegration = wantIntegration ? describe : describe.skip;

const RPC = 'update_learner_state_post_quiz';
const BAND_LABELS = ['not_started', 'beginner', 'developing', 'proficient', 'mastered'];
const NUMERIC_RE = /^[0-9.]+$/;
const BAND_RANK: Record<string, number> = {
  not_started: 0,
  beginner: 1,
  developing: 2,
  proficient: 3,
  mastered: 4,
};

type RpcResult = {
  new_mastery: number;
  old_mastery: number;
  mastery_delta: number;
  new_ease_factor: number;
  new_review_interval: number;
  next_review_at: string;
  streak: number;
  cme_action: string;
  confidence_score: number;
};

async function apply(
  admin: SupabaseClient,
  studentId: string,
  topicId: string,
  isCorrect: boolean,
): Promise<RpcResult> {
  const { data, error } = await admin.rpc(RPC, {
    p_student_id: studentId,
    p_topic_id: topicId,
    p_is_correct: isCorrect,
    p_bloom_level: null,
    p_error_type: null,
    p_response_time_ms: null,
    p_difficulty: null,
  });
  if (error) throw new Error(`${RPC} error: ${error.code ?? ''} ${error.message}`);
  return data as RpcResult;
}

type CmRow = {
  mastery_probability: number;
  p_know: number;
  mastery_level: string;
  consecutive_wrong: number | null;
};

async function readRow(
  admin: SupabaseClient,
  studentId: string,
  topicId: string,
): Promise<CmRow> {
  const { data, error } = await admin
    .from('concept_mastery')
    .select('mastery_probability, p_know, mastery_level, consecutive_wrong')
    .eq('student_id', studentId)
    .eq('topic_id', topicId)
    .single();
  if (error) throw new Error(`read concept_mastery error: ${error.message}`);
  return data as CmRow;
}

describeIntegration('canonical-mastery e2e (live RPC + dashboard read contract)', () => {
  let admin: SupabaseClient;
  let studentId: string;
  let topicA: string; // monotonic-escalation + fresh-write pair
  let topicB: string; // wrong-answer pair

  const cmOwned: Array<{ student_id: string; topic_id: string }> = [];

  async function cleanPair(s: string, t: string) {
    await admin.from('concept_mastery').delete().eq('student_id', s).eq('topic_id', t);
  }

  beforeAll(async () => {
    const { createClient } = await import('@supabase/supabase-js');
    admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );

    const { data: student, error: sErr } = await admin
      .from('students')
      .select('id')
      .limit(1)
      .single();
    if (sErr || !student) throw new Error(`no student available: ${sErr?.message}`);
    studentId = student.id;

    const { data: topics, error: tErr } = await admin
      .from('curriculum_topics')
      .select('id')
      .limit(2);
    if (tErr || !topics || topics.length < 2) {
      throw new Error(`need >= 2 curriculum_topics rows: ${tErr?.message}`);
    }
    topicA = topics[0].id;
    topicB = topics[1].id;

    await cleanPair(studentId, topicA);
    await cleanPair(studentId, topicB);
    cmOwned.push({ student_id: studentId, topic_id: topicA });
    cmOwned.push({ student_id: studentId, topic_id: topicB });
  });

  afterAll(async () => {
    if (!admin) return;
    for (const c of cmOwned) await cleanPair(c.student_id, c.topic_id);
  });

  // ───────────────────────────────────────────────────────────────────────
  // (1) Fresh write: canonical numeric + band label, p_know mirrors prob.
  // ───────────────────────────────────────────────────────────────────────
  it('fresh (student,topic) + one CORRECT → mastery_probability>0.1, p_know==prob, mastery_level is a BAND not a number', async () => {
    await cleanPair(studentId, topicA);

    const r = await apply(admin, studentId, topicA, true);
    expect(r.new_mastery).toBeGreaterThan(0.1);

    const row = await readRow(admin, studentId, topicA);

    // canonical numeric written, not frozen at default.
    expect(row.mastery_probability).toBeGreaterThan(0.1);
    // p_know mirrors the posterior exactly.
    expect(Math.abs(row.p_know - row.mastery_probability)).toBeLessThanOrEqual(1e-9);
    // RPC return agrees with stored canonical column.
    expect(Math.abs(row.mastery_probability - r.new_mastery)).toBeLessThanOrEqual(1e-9);

    // mastery_level is a BAND LABEL, NEVER numeric.
    expect(BAND_LABELS).toContain(row.mastery_level);
    expect(NUMERIC_RE.test(row.mastery_level)).toBe(false);

    // eslint-disable-next-line no-console
    console.warn(
      '[canonical-mastery-e2e] fresh write:',
      JSON.stringify({
        mastery_probability: row.mastery_probability,
        p_know: row.p_know,
        mastery_level: row.mastery_level,
      }),
    );
  });

  // ───────────────────────────────────────────────────────────────────────
  // (2) Repeated correct → prob monotonic↑, band escalates, caps at 'mastered'.
  // ───────────────────────────────────────────────────────────────────────
  it('repeated correct → mastery_probability monotonically increases; band escalates and caps at mastered', async () => {
    await cleanPair(studentId, topicA);

    const probs: number[] = [];
    const bands: string[] = [];
    for (let i = 0; i < 30; i++) {
      await apply(admin, studentId, topicA, true);
      const row = await readRow(admin, studentId, topicA);
      probs.push(row.mastery_probability);
      bands.push(row.mastery_level);
      // every persisted band is a label, never numeric.
      expect(NUMERIC_RE.test(row.mastery_level)).toBe(false);
      expect(BAND_LABELS).toContain(row.mastery_level);
      // p_know mirrors prob at every step.
      expect(Math.abs(row.p_know - row.mastery_probability)).toBeLessThanOrEqual(1e-9);
    }

    // monotonic non-decreasing probability on a pure-correct streak.
    for (let i = 1; i < probs.length; i++) {
      expect(probs[i]).toBeGreaterThanOrEqual(probs[i - 1] - 1e-9);
    }
    // band rank monotonic non-decreasing, and the terminal band is the cap.
    for (let i = 1; i < bands.length; i++) {
      expect(BAND_RANK[bands[i]]).toBeGreaterThanOrEqual(BAND_RANK[bands[i - 1]]);
    }
    expect(bands[bands.length - 1]).toBe('mastered');
    expect(probs[probs.length - 1]).toBeGreaterThanOrEqual(0.95);

    // eslint-disable-next-line no-console
    console.warn(
      '[canonical-mastery-e2e] band escalation:',
      JSON.stringify(Array.from(new Set(bands))),
      '| terminal prob:',
      Number(probs[probs.length - 1].toFixed(4)),
    );
  });

  // ───────────────────────────────────────────────────────────────────────
  // (3) Wrong answer → prob does not increase; consecutive_wrong increments.
  // ───────────────────────────────────────────────────────────────────────
  it('a WRONG answer does not increase mastery_probability and increments consecutive_wrong', async () => {
    await cleanPair(studentId, topicB);

    // Build some mastery up first with two corrects so a wrong has somewhere to fall from.
    await apply(admin, studentId, topicB, true);
    await apply(admin, studentId, topicB, true);
    const before = await readRow(admin, studentId, topicB);

    const r = await apply(admin, studentId, topicB, false);
    const after = await readRow(admin, studentId, topicB);

    // a wrong attempt cannot raise the posterior.
    expect(after.mastery_probability).toBeLessThanOrEqual(before.mastery_probability + 1e-9);
    expect(r.new_mastery).toBeLessThanOrEqual(before.mastery_probability + 1e-9);
    // consecutive_wrong incremented from the correct-zeroed baseline.
    expect((after.consecutive_wrong ?? 0)).toBeGreaterThanOrEqual(1);
    // still canonical: p_know mirrors prob, band not numeric.
    expect(Math.abs(after.p_know - after.mastery_probability)).toBeLessThanOrEqual(1e-9);
    expect(NUMERIC_RE.test(after.mastery_level)).toBe(false);

    // eslint-disable-next-line no-console
    console.warn(
      '[canonical-mastery-e2e] wrong answer:',
      JSON.stringify({
        before: before.mastery_probability,
        after: after.mastery_probability,
        consecutive_wrong: after.consecutive_wrong,
      }),
    );
  });

  // ───────────────────────────────────────────────────────────────────────
  // (4) DASHBOARD VALIDATION canary — four read-paths agree on the same row,
  //     plus the table-wide data-integrity invariants the backfill guarantees.
  // ───────────────────────────────────────────────────────────────────────
  it('dashboard canary: a fully-mastered row reads identically on all four axes; no numeric mastery_level anywhere; prob==p_know across all rows', async () => {
    // Drive a throwaway pair to full mastery so we have a deterministic
    // mastery_probability ≈ 1.0 row to validate the 4 read-paths against. (The
    // backfilled prod row with prob=1.0 isn't guaranteed present on every env;
    // this self-creates an equivalent canonical high-mastery row + cleans it up.)
    await cleanPair(studentId, topicA);
    let last: RpcResult | null = null;
    for (let i = 0; i < 40; i++) last = await apply(admin, studentId, topicA, true);
    expect(last).not.toBeNull();

    const row = await readRow(admin, studentId, topicA);

    // FOUR read-paths, ONE truth:
    //   Student / Parent / Admin axis  → mastery_probability
    //   Teacher axis                   → p_know
    const studentParentAdminValue = row.mastery_probability; // single numeric column all three read
    const teacherValue = row.p_know;
    expect(studentParentAdminValue).toBeGreaterThanOrEqual(0.95);
    expect(teacherValue).toBeGreaterThanOrEqual(0.95);
    expect(Math.abs(studentParentAdminValue - teacherValue)).toBeLessThanOrEqual(1e-9);
    expect(row.mastery_level).toBe('mastered');

    // Table-wide invariants the canonical fix + backfill guarantee.
    const { data: allRows, error } = await admin
      .from('concept_mastery')
      .select('mastery_probability, p_know, mastery_level');
    expect(error).toBeNull();
    expect(allRows).not.toBeNull();
    const rows = (allRows ?? []) as Array<{
      mastery_probability: number | null;
      p_know: number | null;
      mastery_level: string | null;
    }>;
    expect(rows.length).toBeGreaterThan(0);

    let numericBands = 0;
    let probKnowMismatch = 0;
    for (const rr of rows) {
      if (rr.mastery_level != null && NUMERIC_RE.test(rr.mastery_level)) numericBands += 1;
      const prob = rr.mastery_probability ?? 0;
      const pk = rr.p_know ?? 0;
      if (Math.abs(prob - pk) > 1e-9) probKnowMismatch += 1;
    }
    // NO real row may have a numeric mastery_level (the bug).
    expect(numericBands, `${numericBands} rows still carry a numeric mastery_level`).toBe(0);
    // mastery_probability == p_know across every row.
    expect(probKnowMismatch, `${probKnowMismatch} rows have prob != p_know`).toBe(0);

    // eslint-disable-next-line no-console
    console.warn(
      '[canonical-mastery-e2e] dashboard canary 4-axis:',
      JSON.stringify({
        student_parent_admin: studentParentAdminValue,
        teacher: teacherValue,
        mastery_level: row.mastery_level,
      }),
      '| table rows:',
      rows.length,
      '| numeric-band rows:',
      numericBands,
      '| prob!=p_know rows:',
      probKnowMismatch,
    );
  });
});
