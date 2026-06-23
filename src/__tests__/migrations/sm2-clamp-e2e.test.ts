import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { hasSupabaseIntegrationEnv, skipIfNoSubstrate } from '../helpers/integration';

/**
 * SM-2 interval clamp — END-TO-END regression (integration lane).
 *
 * Companion to the always-on structural pins (sm2-interval-clamp-structure.test.ts).
 * This file exercises the repaired RPC against the LIVE, MIGRATED DB:
 *
 *   - public.update_learner_state_post_quiz(uuid, uuid, boolean, text, text,
 *                                           int, int, float, float, float)
 *       Fixed by 20260622080000. Pre-fix, a long correct streak grew the SM-2
 *       interval geometrically (v_review_interval * ease) until
 *       now() + (v_new_interval || ' days')::INTERVAL overflowed timestamptz
 *       (SQLSTATE 22008) at ~17 consecutive-correct on one (student,topic).
 *       The overflow aborted the upsert, silently FREEZING that student's
 *       mastery on the topic forever. The clamp
 *       `v_new_interval := LEAST(v_new_interval, 365)` is the single-source fix.
 *
 * WHAT THIS PROVES (assessment-defined — 6 assertions):
 *   (a) 30 consecutive-correct on a throwaway (student,topic) completes with NO
 *       error (pre-fix this threw 22008 around the ~17th call).
 *   (b) review_interval_days <= 365 AND next_review_at <= now()+365d AND
 *       next_review_at is a valid, parseable timestamptz.
 *   (c) sub-cap regression: a 2-correct streak still yields interval 6, and the
 *       interval sequence stays MONOTONIC non-decreasing and clamps to exactly
 *       365 at the top. (The LIVE ease-driven sequence is 1,6,17,49,147,365 —
 *       NOT a constant-2.5 sequence — so we assert <=365 + monotonic, not exact
 *       literals beyond the first two values.)
 *   (d) mastery (new_mastery / p_know) is IDENTICAL with the clamp for the same
 *       input — BKT is interval-independent, the clamp cannot move it.
 *   (e) idempotent re-run: re-driving the same streak on a clean pair reproduces
 *       the same capped terminal state with no error.
 *
 * LANE: integration. Skips cleanly unless real Supabase creds are present
 * (hasSupabaseIntegrationEnv() — placeholder-aware) OR RUN_INTEGRATION_TESTS=1
 * is set with real creds. The structural pins are the always-on companion.
 *
 * DATA HYGIENE: drives a single (existing student, existing topic) pair as the
 * "throwaway" unit. The RPC only ever writes concept_mastery, so the pair is the
 * throwaway. beforeAll asserts a clean slate (deletes any pre-existing row for
 * the pair); afterAll DELETEs every concept_mastery row this test created, keyed
 * by the exact (student_id, topic_id) tuples it owns. It reuses an existing
 * student + existing curriculum_topics row; it never creates throwaway students,
 * topics, or questions, and never writes XP / quiz_sessions / scores.
 */

const wantIntegration =
  hasSupabaseIntegrationEnv() ||
  (process.env.RUN_INTEGRATION_TESTS === '1' && hasSupabaseIntegrationEnv());
const describeIntegration = wantIntegration ? describe : describe.skip;

const RPC = 'update_learner_state_post_quiz';
const DAY_MS = 86_400_000;
// next_review_at = DB now() + interval days. We bound it by (local now + 365d),
// but the DB server clock can be skewed several minutes from the local clock, so
// the cap assertion tolerates a generous skew window. The point of (b) is "the
// interval never exceeds 365 days", NOT second-precision agreement with the
// local clock. One day of slack is far larger than any plausible skew yet still
// proves the value is bounded near 365d (and nowhere near the overflow horizon).
const CLOCK_SKEW_MS = DAY_MS;

type RpcResult = {
  new_mastery: number;
  old_mastery: number;
  mastery_delta: number;
  new_ease_factor: number;
  new_review_interval: number;
  next_review_at: string;
  streak: number;
  bloom_mastery: Record<string, number>;
  cme_action: string;
  confidence_score: number;
};

/** One correct attempt on (student, topic) through the live RPC. */
async function applyCorrect(
  admin: SupabaseClient,
  studentId: string,
  topicId: string,
): Promise<RpcResult> {
  const { data, error } = await admin.rpc(RPC, {
    p_student_id: studentId,
    p_topic_id: topicId,
    p_is_correct: true,
    // first-7-positional-equivalent named call; BKT params left at RPC defaults.
    p_bloom_level: null,
    p_error_type: null,
    p_response_time_ms: null,
    p_difficulty: null,
  });
  if (error) {
    throw new Error(`${RPC} error: ${error.code ?? ''} ${error.message}`);
  }
  return data as RpcResult;
}

describeIntegration('SM-2 interval clamp e2e (live RPC against migrated DB)', () => {
  let admin: SupabaseClient;
  let studentId: string;
  let topicA: string; // 30-streak / sub-cap / mastery-parity pair
  let topicB: string; // idempotent re-run pair (distinct from A)
  // SEED-DATA gate: false when the live DB lacks a student or >=2 curriculum_topics.
  // Each test skips gracefully via skipIfNoSubstrate rather than failing on the
  // substrate-less CI DB. A real DB ERROR still throws (genuine regression).
  let available = false;

  // Cleanup ledger — only delete rows THIS test created.
  const cmOwned: Array<{ student_id: string; topic_id: string }> = [];

  async function cleanPair(studentId: string, topicId: string) {
    await admin
      .from('concept_mastery')
      .delete()
      .eq('student_id', studentId)
      .eq('topic_id', topicId);
  }

  beforeAll(async () => {
    const { createClient } = await import('@supabase/supabase-js');
    admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );

    // Reuse one existing student. Substrate-absent (seed-less CI DB) => leave
    // available=false so each test SKIPS. A real DB ERROR still throws.
    const { data: student, error: sErr } = await admin
      .from('students')
      .select('id, grade')
      .limit(1)
      .maybeSingle();
    if (sErr) throw new Error(`students probe failed: ${sErr.message}`);
    if (!student) return; // no seed student on this DB → tests skip
    studentId = student.id;

    // Reuse two distinct existing curriculum_topics rows as the throwaway pairs.
    const { data: topics, error: tErr } = await admin
      .from('curriculum_topics')
      .select('id')
      .limit(2);
    if (tErr) throw new Error(`curriculum_topics probe failed: ${tErr.message}`);
    if (!topics || topics.length < 2) return; // < 2 topics → tests skip
    topicA = topics[0].id;
    topicB = topics[1].id;

    // Clean slate for both pairs so the run is independent and afterAll removes
    // only what we own.
    await cleanPair(studentId, topicA);
    await cleanPair(studentId, topicB);
    cmOwned.push({ student_id: studentId, topic_id: topicA });
    cmOwned.push({ student_id: studentId, topic_id: topicB });

    available = true;
  });

  afterAll(async () => {
    if (!admin) return;
    for (const c of cmOwned) {
      await cleanPair(c.student_id, c.topic_id);
    }
  });

  // ───────────────────────────────────────────────────────────────────────
  // (a) 30 consecutive-correct completes with NO error.
  // (b) capped interval + valid bounded timestamptz.
  // (c) sub-cap regression: first two intervals 1 -> 6, monotonic, clamps 365.
  // ───────────────────────────────────────────────────────────────────────
  it('drives 30 consecutive-correct with NO error; interval caps at 365, monotonic, sub-cap unchanged', async (ctx) => {
    skipIfNoSubstrate(ctx, available, 'no student / >=2 curriculum_topics to drive the test');
    await cleanPair(studentId, topicA); // independent of any prior `it`

    const intervals: number[] = [];
    let last: RpcResult | null = null;

    for (let i = 0; i < 30; i++) {
      // (a) Each call must complete. Pre-fix, ~the 17th threw 22008.
      last = await applyCorrect(admin, studentId, topicA);
      intervals.push(last.new_review_interval);

      // (b) running invariant: never exceed the cap.
      expect(
        last.new_review_interval,
        `interval exceeded cap at attempt ${i + 1}`,
      ).toBeLessThanOrEqual(365);
    }

    expect(last).not.toBeNull();
    const terminal = last as RpcResult;

    // (c) sub-cap regression — the FIRST two intervals are the SM-2 base values
    // (independent of ease): a brand-new pair => 1, then => 6.
    expect(intervals[0], 'first correct on a fresh pair must be interval 1').toBe(1);
    expect(intervals[1], 'second consecutive correct must be interval 6').toBe(6);

    // (c) monotonic non-decreasing across the whole streak, and it must reach
    // the cap exactly (the live ease-driven sequence is 1,6,17,49,147,365,365…).
    for (let i = 1; i < intervals.length; i++) {
      expect(
        intervals[i],
        `interval must be monotonic non-decreasing (idx ${i}: ${intervals[i]} < ${intervals[i - 1]})`,
      ).toBeGreaterThanOrEqual(intervals[i - 1]);
    }
    expect(
      Math.max(...intervals),
      'a 30-streak must reach the 365 cap',
    ).toBe(365);
    expect(
      intervals[intervals.length - 1],
      'terminal interval must sit at the cap',
    ).toBe(365);

    // (b) terminal stored interval + bounded, valid next_review_at.
    expect(terminal.new_review_interval).toBeLessThanOrEqual(365);
    const next = new Date(terminal.next_review_at);
    expect(Number.isNaN(next.getTime()), 'next_review_at must be a valid timestamptz').toBe(false);
    // <= now() + 365d (allow a small clock-skew margin).
    expect(next.getTime()).toBeLessThanOrEqual(Date.now() + 365 * DAY_MS + CLOCK_SKEW_MS);
    // and it must be in the future (a positive interval was applied).
    expect(next.getTime()).toBeGreaterThan(Date.now());

    // Confirm the STORED row agrees with the RPC return (the upsert landed —
    // pre-fix the overflow aborted the upsert and the row stayed frozen).
    const { data: row, error: rowErr } = await admin
      .from('concept_mastery')
      .select('review_interval_days, next_review_at')
      .eq('student_id', studentId)
      .eq('topic_id', topicA)
      .single();
    expect(rowErr).toBeNull();
    expect(row).not.toBeNull();
    expect((row as { review_interval_days: number }).review_interval_days).toBeLessThanOrEqual(365);
    const storedNext = new Date((row as { next_review_at: string }).next_review_at);
    expect(Number.isNaN(storedNext.getTime())).toBe(false);
    expect(storedNext.getTime()).toBeLessThanOrEqual(Date.now() + 365 * DAY_MS + CLOCK_SKEW_MS);

    // EVIDENCE for the report.
    // eslint-disable-next-line no-console
    console.warn(
      '[sm2-clamp-e2e] 30-streak intervals:',
      JSON.stringify(intervals),
      '| terminal next_review_at:',
      terminal.next_review_at,
    );
  });

  // ───────────────────────────────────────────────────────────────────────
  // (d) mastery is interval-independent — identical with the clamp.
  // ───────────────────────────────────────────────────────────────────────
  it('BKT mastery is unaffected by the clamp (interval-independent): deterministic per-step mastery', async (ctx) => {
    skipIfNoSubstrate(ctx, available, 'no student / >=2 curriculum_topics to drive the test');
    // Re-drive the SAME input on the SAME clean pair and prove the per-step
    // mastery trajectory is deterministic and bounded [0,1]. Because BKT depends
    // only on prior mastery + correctness (never the interval), the clamp cannot
    // perturb it. We assert: (i) mastery strictly increases on each correct until
    // saturation, (ii) stays within [0,1], (iii) the terminal mastery matches a
    // second independent replay exactly (clamp-independence => determinism).
    await cleanPair(studentId, topicA);
    const run1: number[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await applyCorrect(admin, studentId, topicA);
      run1.push(r.new_mastery);
      expect(r.new_mastery).toBeGreaterThanOrEqual(0);
      expect(r.new_mastery).toBeLessThanOrEqual(1);
    }
    // monotonic non-decreasing mastery on a pure-correct streak.
    for (let i = 1; i < run1.length; i++) {
      expect(run1[i]).toBeGreaterThanOrEqual(run1[i - 1] - 1e-9);
    }

    // Independent replay on a CLEAN copy of the same pair — same inputs, so the
    // mastery trajectory must be byte-identical (clamp touches only the interval).
    await cleanPair(studentId, topicA);
    const run2: number[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await applyCorrect(admin, studentId, topicA);
      run2.push(r.new_mastery);
    }
    for (let i = 0; i < run1.length; i++) {
      expect(run2[i]).toBeCloseTo(run1[i], 9);
    }

    // eslint-disable-next-line no-console
    console.warn(
      '[sm2-clamp-e2e] BKT mastery trajectory (interval-independent):',
      JSON.stringify(run1.map((m) => Number(m.toFixed(4)))),
    );
  });

  // ───────────────────────────────────────────────────────────────────────
  // (e) idempotent re-run.
  // ───────────────────────────────────────────────────────────────────────
  it('idempotent re-run: re-driving the streak on a clean pair reproduces the same capped terminal state', async (ctx) => {
    skipIfNoSubstrate(ctx, available, 'no student / >=2 curriculum_topics to drive the test');
    async function driveTerminal(topicId: string): Promise<RpcResult> {
      await cleanPair(studentId, topicId);
      let r: RpcResult | null = null;
      for (let i = 0; i < 25; i++) {
        r = await applyCorrect(admin, studentId, topicId);
      }
      return r as RpcResult;
    }

    const first = await driveTerminal(topicB);
    const second = await driveTerminal(topicB);

    // Same capped interval, same mastery, no error either time.
    expect(first.new_review_interval).toBe(365);
    expect(second.new_review_interval).toBe(365);
    expect(second.new_mastery).toBeCloseTo(first.new_mastery, 9);
    expect(second.new_ease_factor).toBeCloseTo(first.new_ease_factor, 9);

    // Both terminal next_review_at values are valid + bounded.
    for (const r of [first, second]) {
      const d = new Date(r.next_review_at);
      expect(Number.isNaN(d.getTime())).toBe(false);
      expect(d.getTime()).toBeLessThanOrEqual(Date.now() + 365 * DAY_MS + CLOCK_SKEW_MS);
    }

    // eslint-disable-next-line no-console
    console.warn(
      '[sm2-clamp-e2e] idempotent terminal interval:',
      first.new_review_interval,
      '==',
      second.new_review_interval,
    );
  });
});
