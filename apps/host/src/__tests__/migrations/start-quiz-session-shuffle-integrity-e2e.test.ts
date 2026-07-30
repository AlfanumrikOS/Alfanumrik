import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  hasSupabaseIntegrationEnv,
  skipIfNoSubstrate,
  rpcIsDeployed,
  skipIfRpcNotDeployed,
} from '../helpers/integration';

/**
 * start_quiz_session — live-DB E2E regression for the 3-month P0 silent
 * failure (migration 20260801100800_fix_start_quiz_session_options_version_null.sql).
 *
 * ROOT CAUSE THIS PINS
 * ---------------------
 * From 2026-05-04 to 2026-07-29, EVERY call to start_quiz_session() raised a
 * NOT NULL violation on quiz_session_shuffles.options_version_at_serve,
 * because the deployed function body never populated that column (or
 * integrity_hash) despite the 20260504100500 migration tightening both
 * columns to NOT NULL. The web client swallowed the RPC error and silently
 * fell back to the legacy client-side-shuffle path, so nothing in CI or
 * production monitoring ever surfaced the break — it was only caught when
 * the WhatsApp bot (which has no fallback) started hard-failing.
 *
 * No test in the suite actually INVOKED this RPC against a real/migrated
 * Postgres and asserted a row landed in quiz_session_shuffles. That is the
 * exact gap this file closes: it is a genuine round-trip through the live
 * RPC (not a mock), so a future migration that reintroduces a NOT NULL
 * column start_quiz_session doesn't populate will fail THIS test the same
 * way it should have failed three months ago.
 *
 * LANE: integration. Self-skips unless real Supabase creds are present
 * (hasSupabaseIntegrationEnv()) AND the RPC is deployed on the target DB
 * (rpcIsDeployed probe) — see apps/host/src/__tests__/helpers/integration.ts.
 *
 * DATA HYGIENE: creates one throwaway student + one throwaway question_bank
 * row. afterAll deletes every quiz_session_shuffles row this test produced,
 * then the question_bank row, then the student row.
 *
 * REGRESSION CATALOG: recommended REG id for the P0 quiz-session-shuffle
 * NOT NULL fix (companion to REG-318, the prior quiz-scoring RPC defect
 * cluster from PR #1410 two days earlier).
 */

const describeIntegration = hasSupabaseIntegrationEnv() ? describe : describe.skip;

const RPC = 'start_quiz_session';
const SHA256_HEX = /^[0-9a-f]{64}$/;

describeIntegration('start_quiz_session — quiz_session_shuffles NOT NULL regression (e2e)', () => {
  let admin: SupabaseClient;
  let studentId: string | null = null;
  let questionId: string | null = null;
  let deployed = false;
  let setupError: string | null = null;
  const createdSessionIds: string[] = [];

  beforeAll(async () => {
    const { createClient } = await import('@supabase/supabase-js');
    admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );

    // Capability probe: is start_quiz_session actually deployed here? Empty
    // p_question_ids is the documented benign short-circuit (returns
    // '{"session_id": <uuid>, "questions": []}' without touching any table),
    // so this is safe to run before any fixture exists.
    deployed = await rpcIsDeployed(admin, RPC, {
      p_student_id: randomUUID(),
      p_question_ids: [],
    });
    if (!deployed) return;

    // Defensive seed: question_bank.subject has FK -> subjects.code.
    await admin
      .from('subjects')
      .upsert(
        { code: 'science', name: 'Science', subject_kind: 'cbse_core', is_active: true },
        { onConflict: 'code' },
      );

    const { data: studentRow, error: studentErr } = await admin
      .from('students')
      .insert({
        auth_user_id: randomUUID(),
        name: 'start_quiz_session P0 throwaway',
        email: `sqs-p0+${randomUUID()}@example.test`,
        grade: '9',
        board: 'CBSE',
        preferred_language: 'en',
        preferred_subject: 'math',
        account_status: 'active',
        xp_total: 0,
      })
      .select('id')
      .single();
    if (studentErr || !studentRow) {
      setupError = `student seed failed: ${studentErr?.message ?? 'no row returned'}`;
      return;
    }
    studentId = (studentRow as { id: string }).id;

    const uniqueText = `start_quiz_session P0 regression question - run ${Date.now()}-${randomUUID()}.`;
    const { data: questionRow, error: questionErr } = await admin
      .from('question_bank')
      .insert({
        question_text: uniqueText,
        options: ['Delhi', 'Mumbai', 'Chennai', 'Kolkata'],
        correct_answer_index: 0,
        explanation: 'Delhi is the national capital of India.',
        subject: 'science',
        grade: '9',
        chapter_number: 1,
        difficulty: 2,
        bloom_level: 'understand',
        is_active: true,
      })
      .select('id')
      .single();
    if (questionErr || !questionRow) {
      setupError = `question_bank seed failed: ${questionErr?.message ?? 'no row returned'}`;
      return;
    }
    questionId = (questionRow as { id: string }).id;
  });

  afterAll(async () => {
    if (!admin) return;
    for (const sessionId of createdSessionIds) {
      await admin.from('quiz_session_shuffles').delete().eq('session_id', sessionId);
    }
    if (questionId) {
      await admin.from('question_bank').delete().eq('id', questionId);
    }
    if (studentId) {
      await admin.from('students').delete().eq('id', studentId);
    }
  });

  it(
    'inserts a quiz_session_shuffles row with non-null options_version_at_serve ' +
      'and integrity_hash, and returns options_displayed with no correct_answer_index leak',
    async (ctx) => {
      skipIfRpcNotDeployed(ctx, deployed, RPC, '20260801100800_fix_start_quiz_session_options_version_null.sql');
      skipIfNoSubstrate(ctx, studentId && questionId, `could not seed student/question fixture: ${setupError ?? ''}`);

      const { data, error } = await admin.rpc(RPC, {
        p_student_id: studentId,
        p_question_ids: [questionId],
      });

      // The whole point: this call raised a NOT NULL violation on
      // options_version_at_serve on EVERY invocation for three months.
      expect(error, `start_quiz_session must not error: ${error?.message}`).toBeNull();

      const parsed = typeof data === 'string' ? JSON.parse(data) : data;
      expect(parsed?.session_id, 'RPC must return a session_id').toBeTruthy();
      const sessionId = parsed.session_id as string;
      createdSessionIds.push(sessionId);

      // ── Returned shape ──────────────────────────────────────────────
      expect(Array.isArray(parsed.questions)).toBe(true);
      expect(parsed.questions).toHaveLength(1);
      const q = parsed.questions[0];
      expect(q.question_id).toBe(questionId);
      expect(Array.isArray(q.options_displayed)).toBe(true);
      expect(q.options_displayed).toHaveLength(4);
      // P6/P1-adjacent: the client must NEVER receive the answer key.
      expect(Object.prototype.hasOwnProperty.call(q, 'correct_answer_index')).toBe(false);
      expect(Object.keys(q).some((k) => /correct/i.test(k))).toBe(false);

      // ── quiz_session_shuffles row: this is the exact assertion that ──
      // ── would have caught the 3-month P0 silent failure. ─────────────
      const { data: shuffleRows, error: shuffleErr } = await admin
        .from('quiz_session_shuffles')
        .select('session_id, question_id, student_id, options_version_at_serve, integrity_hash, shuffle_map, options_snapshot, correct_answer_index_snapshot')
        .eq('session_id', sessionId)
        .eq('question_id', questionId);

      expect(shuffleErr, shuffleErr?.message).toBeNull();
      expect(shuffleRows, 'a row must land in quiz_session_shuffles').toHaveLength(1);
      const row = shuffleRows![0] as {
        options_version_at_serve: number | null;
        integrity_hash: string | null;
        student_id: string;
        correct_answer_index_snapshot: number | null;
        shuffle_map: number[];
      };

      expect(row.options_version_at_serve, 'options_version_at_serve must be populated (NOT NULL)').not.toBeNull();
      expect(typeof row.options_version_at_serve).toBe('number');
      expect(row.integrity_hash, 'integrity_hash must be populated (NOT NULL)').not.toBeNull();
      expect(row.integrity_hash).toMatch(SHA256_HEX);
      expect(row.student_id).toBe(studentId);
      // Server-side snapshot retains the real answer key even though the
      // client response never does.
      expect(row.correct_answer_index_snapshot).toBe(0);
      expect(Array.isArray(row.shuffle_map)).toBe(true);
      expect(row.shuffle_map).toHaveLength(4);
    },
  );

  it('is safe to call twice for the same student (two independent sessions, both persisted)', async (ctx) => {
    skipIfRpcNotDeployed(ctx, deployed, RPC, '20260801100800_fix_start_quiz_session_options_version_null.sql');
    skipIfNoSubstrate(ctx, studentId && questionId, `could not seed student/question fixture: ${setupError ?? ''}`);

    const first = await admin.rpc(RPC, { p_student_id: studentId, p_question_ids: [questionId] });
    const second = await admin.rpc(RPC, { p_student_id: studentId, p_question_ids: [questionId] });

    expect(first.error, first.error?.message).toBeNull();
    expect(second.error, second.error?.message).toBeNull();

    const firstParsed = typeof first.data === 'string' ? JSON.parse(first.data) : first.data;
    const secondParsed = typeof second.data === 'string' ? JSON.parse(second.data) : second.data;
    createdSessionIds.push(firstParsed.session_id, secondParsed.session_id);

    expect(firstParsed.session_id).not.toBe(secondParsed.session_id);

    const { data: rows, error } = await admin
      .from('quiz_session_shuffles')
      .select('session_id, options_version_at_serve, integrity_hash')
      .in('session_id', [firstParsed.session_id, secondParsed.session_id]);

    expect(error, error?.message).toBeNull();
    expect(rows).toHaveLength(2);
    for (const r of rows as Array<{ options_version_at_serve: number | null; integrity_hash: string | null }>) {
      expect(r.options_version_at_serve).not.toBeNull();
      expect(r.integrity_hash).not.toBeNull();
    }
  });
});
