import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { hasSupabaseIntegrationEnv } from '../helpers/integration';
// All XP magnitudes below are DERIVED from the single source of truth (P2) — no
// hardcoded XP literals live in this test. The RPC caller computes p_xp from this
// same formula; we re-derive expected values here so a future XP-rule change can
// never silently desync this regression from the economy.
import { XP_RULES } from '@/lib/xp-config';

/** P2 formula, re-derived so expected XP is never a bare literal. */
function expectedQuizXp(correct: number, total: number): number {
  const scorePercent = Math.round((correct / total) * 100);
  return (
    correct * XP_RULES.quiz_per_correct +
    (scorePercent >= 80 ? XP_RULES.quiz_high_score_bonus : 0) +
    (scorePercent === 100 ? XP_RULES.quiz_perfect_bonus : 0)
  );
}

/**
 * atomic_quiz_profile_update 42P10 hotfix — END-TO-END regression (integration lane).
 *
 * Companion to the always-on structural pins (atomic-quiz-conflict-42p10-structure.test.ts).
 * This file exercises the repaired RPC against the LIVE, MIGRATED DB:
 *
 *   public.atomic_quiz_profile_update(
 *     p_student_id, p_subject, p_xp, p_total, p_correct, p_time_seconds, p_session_id)
 *
 * Pre-fix (20260610000000), CASE A — a quiz submitted with a session_id and
 * v_xp_to_award > 0 (the normal correct-answer / high-XP path) — raised SQLSTATE
 * 42P10 because the ledger INSERT used a bare `ON CONFLICT (reference_id) DO NOTHING`
 * that Postgres could not match to the PARTIAL unique index idx_xp_txn_reference_id
 * (... WHERE reference_id IS NOT NULL). The fix (20260623000600) adds the matching
 * predicate so the partial index is inferred.
 *
 * WHAT THIS PROVES (3 assertions):
 *   (A) CASE A submit (session_id set + xp > 0) SUCCEEDS with NO 42P10 and grants
 *       exactly the requested (capped) XP into the ledger + students.xp_total.
 *   (B) P4 idempotency: re-submitting the SAME session_id grants +0 (the partial
 *       index dedup silently swallows the second insert; xp_total unchanged).
 *   (C) P2 daily cap: repeated distinct-session submits clamp the day's quiz XP at
 *       exactly 200 — the cap math survived the hotfix.
 *
 * LANE: integration. Self-skips cleanly unless real Supabase creds are present
 * (hasSupabaseIntegrationEnv() — placeholder-aware) OR RUN_INTEGRATION_TESTS=1 is
 * set with real creds. The structural pins are the always-on companion.
 *
 * DATA HYGIENE: creates ONE throwaway student row (random auth_user_id) and drives
 * synthetic submits. afterAll DELETEs every row this test created/touched —
 * xp_transactions (by student_id), student_learning_profiles (by student_id),
 * state_events (by the quiz-completed idempotency keys it generated), and finally
 * the throwaway students row. It never reuses or mutates real student data.
 *
 * REGRESSION CATALOG: REG-170 (recommended).
 */

const wantIntegration =
  hasSupabaseIntegrationEnv() ||
  (process.env.RUN_INTEGRATION_TESTS === '1' && hasSupabaseIntegrationEnv());
const describeIntegration = wantIntegration ? describe : describe.skip;

const RPC = 'atomic_quiz_profile_update';
const SUBJECT = 'mathematics';

async function callRpc(
  admin: SupabaseClient,
  studentId: string,
  xp: number,
  total: number,
  correct: number,
  timeSeconds: number,
  sessionId: string | null,
): Promise<{ error: { code?: string; message: string } | null }> {
  const { error } = await admin.rpc(RPC, {
    p_student_id: studentId,
    p_subject: SUBJECT,
    p_xp: xp,
    p_total: total,
    p_correct: correct,
    p_time_seconds: timeSeconds,
    p_session_id: sessionId,
  });
  return { error: error as { code?: string; message: string } | null };
}

async function studentXpTotal(admin: SupabaseClient, studentId: string): Promise<number> {
  const { data, error } = await admin
    .from('students')
    .select('xp_total')
    .eq('id', studentId)
    .single();
  if (error) throw new Error(`xp_total read failed: ${error.message}`);
  return (data as { xp_total: number | null }).xp_total ?? 0;
}

async function todayLedgerQuizXp(admin: SupabaseClient, studentId: string): Promise<number> {
  const { data, error } = await admin
    .from('xp_transactions')
    .select('amount')
    .eq('student_id', studentId)
    .eq('daily_category', 'quiz');
  if (error) throw new Error(`ledger read failed: ${error.message}`);
  return (data as Array<{ amount: number }>).reduce((s, r) => s + (r.amount ?? 0), 0);
}

describeIntegration('atomic_quiz 42P10 e2e (live RPC against migrated DB)', () => {
  let admin: SupabaseClient;
  let studentId: string;
  const createdSessionIds: string[] = [];

  beforeAll(async () => {
    const { createClient } = await import('@supabase/supabase-js');
    admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );

    // Create a fully throwaway student (random auth_user_id so it never collides
    // with a real auth user). The RPC reads students.id / auth_user_id / school_id.
    const { data, error } = await admin
      .from('students')
      .insert({
        auth_user_id: randomUUID(),
        name: 'REG-170 throwaway',
        email: `reg170+${randomUUID()}@example.test`,
        grade: '9',
        board: 'CBSE',
        preferred_language: 'en',
        account_status: 'active',
        xp_total: 0,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`could not create throwaway student: ${error?.message}`);
    studentId = (data as { id: string }).id;
  });

  afterAll(async () => {
    if (!admin || !studentId) return;
    // Tear down everything this test created/touched, in FK-safe order.
    await admin.from('xp_transactions').delete().eq('student_id', studentId);
    await admin.from('student_learning_profiles').delete().eq('student_id', studentId);
    for (const sid of createdSessionIds) {
      await admin
        .from('state_events')
        .delete()
        .eq('idempotency_key', `quiz-completed:${sid}`);
    }
    await admin.from('students').delete().eq('id', studentId);
  });

  // ───────────────────────────────────────────────────────────────────────
  // (A) CASE A submit succeeds with NO 42P10 and grants the (capped) XP.
  // ───────────────────────────────────────────────────────────────────────
  it('CASE A (session_id set + xp>0) submits with NO 42P10 and grants the formula XP', async () => {
    const sessionId = randomUUID();
    createdSessionIds.push(sessionId);

    // 9/10 correct => 90% => 9*per_correct + high_score_bonus (derived from XP_RULES).
    const correct = 9;
    const total = 10;
    const requestedXp = expectedQuizXp(correct, total);
    const before = await studentXpTotal(admin, studentId);

    const { error } = await callRpc(admin, studentId, requestedXp, total, correct, 600, sessionId);

    // The whole point: the pre-fix bug was SQLSTATE 42P10 on exactly this path.
    expect(error?.code, `42P10 must NOT occur: ${error?.code} ${error?.message}`).not.toBe('42P10');
    expect(error, error?.message).toBeNull();

    const after = await studentXpTotal(admin, studentId);
    expect(after - before, 'students.xp_total must increase by the granted XP').toBe(requestedXp);

    const ledger = await todayLedgerQuizXp(admin, studentId);
    expect(ledger, 'ledger today-quiz total must equal the granted XP').toBe(requestedXp);

    // eslint-disable-next-line no-console
    console.warn('[atomic-quiz-42p10-e2e] CASE A granted XP:', requestedXp, '| xp_total delta:', after - before);
  });

  // ───────────────────────────────────────────────────────────────────────
  // (B) P4 idempotency: re-submitting the SAME session_id grants +0.
  // ───────────────────────────────────────────────────────────────────────
  it('re-submitting the SAME session_id is idempotent (+0 XP, dedup via the partial index)', async () => {
    const sessionId = randomUUID();
    createdSessionIds.push(sessionId);

    const correct = 7;
    const total = 10;
    const requestedXp = expectedQuizXp(correct, total); // 70% => no bonus.

    // First submit grants the XP.
    const before = await studentXpTotal(admin, studentId);
    const first = await callRpc(admin, studentId, requestedXp, total, correct, 600, sessionId);
    expect(first.error?.code).not.toBe('42P10');
    expect(first.error, first.error?.message).toBeNull();
    const afterFirst = await studentXpTotal(admin, studentId);
    expect(afterFirst - before).toBe(requestedXp);

    // Second submit with the SAME session_id => +0 (ON CONFLICT DO NOTHING on the
    // partial unique index; v_rows_inserted = 0 so xp_total is NOT bumped).
    const second = await callRpc(admin, studentId, requestedXp, 10, 7, 600, sessionId);
    expect(second.error?.code, `re-submit must not 42P10: ${second.error?.message}`).not.toBe('42P10');
    expect(second.error, second.error?.message).toBeNull();
    const afterSecond = await studentXpTotal(admin, studentId);
    expect(afterSecond - afterFirst, 'duplicate session_id must grant +0 XP').toBe(0);

    // Exactly one ledger row exists for this reference_id.
    const { data: rows, error } = await admin
      .from('xp_transactions')
      .select('id')
      .eq('student_id', studentId)
      .eq('reference_id', `quiz_${sessionId}`);
    expect(error).toBeNull();
    expect((rows ?? []).length, 'exactly one ledger row per session_id').toBe(1);

    // eslint-disable-next-line no-console
    console.warn('[atomic-quiz-42p10-e2e] idempotent re-submit delta:', afterSecond - afterFirst);
  });

  // ───────────────────────────────────────────────────────────────────────
  // (C) P2 daily cap: distinct-session submits clamp the day's quiz XP at 200.
  // ───────────────────────────────────────────────────────────────────────
  it('daily quiz XP clamps at exactly 200 across multiple distinct-session submits', async () => {
    // Use a SECOND throwaway student so this test is independent of (A)/(B)'s
    // already-accumulated same-day ledger.
    const { data: s2, error: s2err } = await admin
      .from('students')
      .insert({
        auth_user_id: randomUUID(),
        name: 'REG-170 cap throwaway',
        email: `reg170cap+${randomUUID()}@example.test`,
        grade: '9',
        board: 'CBSE',
        preferred_language: 'en',
        account_status: 'active',
        xp_total: 0,
      })
      .select('id')
      .single();
    expect(s2err, s2err?.message).toBeNull();
    const capStudent = (s2 as { id: string }).id;

    const capSessions: string[] = [];
    const cap = XP_RULES.quiz_daily_cap; // 200, single source of truth.
    // Per-submit award sized so that >2 submits exceed the cap (3 * perSubmit > cap).
    const perSubmit = Math.ceil((cap * 3) / 4); // e.g. 150 each => 450 requested.
    try {
      // Three distinct submits requesting 3*perSubmit total; the cap must clamp it.
      for (let i = 0; i < 3; i++) {
        const sid = randomUUID();
        capSessions.push(sid);
        const { error } = await callRpc(admin, capStudent, perSubmit, 10, 9, 600, sid);
        expect(error?.code, `cap submit ${i} must not 42P10`).not.toBe('42P10');
        expect(error, error?.message).toBeNull();
      }

      const ledgerTotal = await todayLedgerQuizXp(admin, capStudent);
      const studentTotal = await studentXpTotal(admin, capStudent);

      expect(ledgerTotal, 'ledger daily quiz XP must clamp at the daily cap').toBe(cap);
      expect(studentTotal, 'students.xp_total must clamp at the daily cap').toBe(cap);

      // eslint-disable-next-line no-console
      console.warn('[atomic-quiz-42p10-e2e] daily-cap clamp: ledger', ledgerTotal, '| xp_total', studentTotal);
    } finally {
      // Clean the cap-test student + its rows.
      await admin.from('xp_transactions').delete().eq('student_id', capStudent);
      await admin.from('student_learning_profiles').delete().eq('student_id', capStudent);
      for (const sid of capSessions) {
        await admin.from('state_events').delete().eq('idempotency_key', `quiz-completed:${sid}`);
      }
      await admin.from('students').delete().eq('id', capStudent);
    }
  });
});
