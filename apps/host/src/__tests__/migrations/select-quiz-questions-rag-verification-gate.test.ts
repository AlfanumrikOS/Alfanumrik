/**
 * select_quiz_questions_rag verification gate — LIVE-DB integration pins.
 *
 * These are architect's condition-2 pins for
 * `supabase/migrations/20260802100000_select_quiz_questions_rag_verification_gate.sql`,
 * per spec `docs/superpowers/specs/2026-08-02-quiz-rag-verification-gate-
 * correctness.md` §6.2 (AC-1 through AC-6 in §6.5).
 *
 * They execute a real Postgres RPC against seeded data, so they CANNOT run in
 * the unit lane. This file runs ONLY under `RUN_INTEGRATION_TESTS=1` with
 * real STAGING_SUPABASE_* secrets and skips cleanly otherwise — the same
 * guard as `get-plan-limit-school-coverage.test.ts` and
 * `seat-enforcement.test.ts`.
 *
 * ⚠️ HONEST COVERAGE STATEMENT: on a normal PR these pins DO NOT EXECUTE. The
 * unit-lane companion
 * `apps/host/src/__tests__/contract/select-quiz-questions-rag-verification-gate.test.ts`
 * is what gates every PR, and it can only detect SOURCE drift (predicate
 * text missing from one of the four blocks, the ladder wiring removed, the
 * signature accidentally changed). Do not read a green PR as "the
 * verification-gate serving semantics were verified" — that claim can only
 * be made by an actual run of THIS file against a real database, which this
 * authoring environment does not have (no DB access — this file is written
 * correctly-gated per the established pattern and has not been executed).
 *
 * P13: every fixture is synthetic (grade/subject/student rows created and
 * torn down by this suite); no real student data touched.
 *
 * Isolation strategy: this suite seeds its OWN synthetic `subjects.code`
 * (not one of the real CBSE subject codes) so `question_bank.subject` and
 * `ff_grounded_ai_enforced_pairs.subject_code` can never collide with a real
 * admin-enabled pair on a shared staging DB — toggling `enabled` on a REAL
 * (grade, subject) pair from a test would be a genuine production-adjacent
 * side effect (the whole point of this fix is that flipping `enabled` for a
 * pair changes what every student in that pair is served), which this suite
 * must never risk.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { hasSupabaseIntegrationEnv, skipIfNoSubstrate } from '../helpers/integration';
import { SAFE_PREFERRED_SUBJECT_CODE } from './_helpers/reference-data';

const describeIntegration = hasSupabaseIntegrationEnv() ? describe : describe.skip;

const RUN = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const TEST_SUBJECT_CODE = `zzq_vgate_${RUN}`.slice(0, 60);
const TEST_GRADE = '9'; // must satisfy chk_question_bank_grade_p5

const created = {
  questionIds: [] as string[],
  studentId: '' as string,
  subjectSeeded: false,
  pairSeeded: false,
};

interface SeedQuestionOpts {
  chapterNumber: number;
  verificationState: 'legacy_unverified' | 'pending' | 'verified' | 'failed';
  verifiedAgainstNcert: boolean;
  isActive?: boolean;
  deletedAt?: string | null;
  contentStatus?: 'draft' | 'review' | 'published' | 'archived';
  marker: string;
}

async function seedSubjectOnce(): Promise<void> {
  if (created.subjectSeeded) return;
  const { error } = await supabaseAdmin.from('subjects').insert({
    code: TEST_SUBJECT_CODE,
    name: `ZZQ VerifyGate Test ${RUN}`,
    name_hi: 'परीक्षण विषय',
    subject_kind: 'platform_elective',
    is_active: true,
    display_order: 9999,
  });
  if (error) throw new Error(`seed subjects failed: ${error.message}`);
  created.subjectSeeded = true;
}

async function seedStudentOnce(): Promise<string> {
  if (created.studentId) return created.studentId;
  const { data, error } = await supabaseAdmin
    .from('students')
    .insert({
      name: `ZZQ VerifyGate Student ${RUN}`,
      grade: TEST_GRADE, // P5 — string
      board: 'CBSE',
      is_active: true,
      preferred_subject: SAFE_PREFERRED_SUBJECT_CODE,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seed student failed: ${error?.message}`);
  created.studentId = (data as { id: string }).id;
  return created.studentId;
}

async function seedQuestion(opts: SeedQuestionOpts): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('question_bank')
    .insert({
      subject: TEST_SUBJECT_CODE,
      grade: TEST_GRADE,
      chapter_number: opts.chapterNumber,
      question_text: `ZZQ VerifyGate ${opts.marker} question ${RUN} — placeholder text over ten chars`,
      options: ['Option A', 'Option B', 'Option C', 'Option D'],
      correct_answer_index: 0,
      explanation: `ZZQ explanation ${opts.marker}`,
      question_type_v2: 'mcq',
      difficulty: 2,
      is_active: opts.isActive ?? true,
      deleted_at: opts.deletedAt ?? null,
      content_status: opts.contentStatus ?? 'published',
      verification_state: opts.verificationState,
      verified_against_ncert: opts.verifiedAgainstNcert,
      source: 'ai_generated_grounded',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seed question_bank failed (${opts.marker}): ${error?.message}`);
  const id = (data as { id: string }).id;
  created.questionIds.push(id);
  return id;
}

async function setEnforcedPair(enabled: boolean): Promise<void> {
  const { error } = await supabaseAdmin.from('ff_grounded_ai_enforced_pairs').upsert(
    {
      grade: TEST_GRADE,
      subject_code: TEST_SUBJECT_CODE,
      enabled,
      enabled_at: enabled ? new Date().toISOString() : null,
      enabled_by: null,
      auto_disabled_at: null,
      auto_disabled_reason: null,
    },
    { onConflict: 'grade,subject_code' },
  );
  if (error) throw new Error(`ff_grounded_ai_enforced_pairs upsert failed: ${error.message}`);
  created.pairSeeded = true;
}

interface RagRow {
  id: string;
  chapter_number: number | null;
  [key: string]: unknown;
}

async function callRag(params: {
  chapterNumber: number;
  count: number;
}): Promise<RagRow[]> {
  const { data, error } = await supabaseAdmin.rpc('select_quiz_questions_rag', {
    p_student_id: created.studentId,
    p_subject: TEST_SUBJECT_CODE,
    p_grade: TEST_GRADE,
    p_chapter_number: params.chapterNumber,
    p_count: params.count,
    p_difficulty_mode: 'mixed',
    p_question_types: ['mcq'],
    p_query_embedding: null,
  });
  if (error) throw new Error(`select_quiz_questions_rag failed: ${error.message}`);
  return (Array.isArray(data) ? data : []) as RagRow[];
}

/** Look up verification_state for a set of returned ids directly (P13-safe: UUIDs only). */
async function verificationStatesFor(ids: string[]): Promise<Map<string, { verification_state: string; verified_against_ncert: boolean }>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabaseAdmin
    .from('question_bank')
    .select('id, verification_state, verified_against_ncert')
    .in('id', ids);
  if (error) throw new Error(`verificationStatesFor lookup failed: ${error.message}`);
  const map = new Map<string, { verification_state: string; verified_against_ncert: boolean }>();
  for (const row of (data ?? []) as Array<{ id: string; verification_state: string; verified_against_ncert: boolean }>) {
    map.set(row.id, { verification_state: row.verification_state, verified_against_ncert: row.verified_against_ncert });
  }
  return map;
}

describeIntegration('select_quiz_questions_rag — verification gate (live DB)', () => {
  let available = false;
  let setupError: string | null = null;

  beforeAll(async () => {
    try {
      await seedSubjectOnce();
      await seedStudentOnce();
      available = true;
    } catch (e) {
      setupError = e instanceof Error ? e.message : String(e);
    }
  }, 60_000);

  afterAll(async () => {
    // Teardown order respects FKs: user_question_history rows this RPC
    // itself writes -> question_bank rows -> the enforced-pair row -> the
    // student -> the synthetic subject.
    if (created.studentId) {
      await supabaseAdmin.from('user_question_history').delete().eq('student_id', created.studentId);
    }
    if (created.questionIds.length > 0) {
      await supabaseAdmin.from('question_bank').delete().in('id', created.questionIds);
    }
    if (created.pairSeeded) {
      await supabaseAdmin
        .from('ff_grounded_ai_enforced_pairs')
        .delete()
        .eq('grade', TEST_GRADE)
        .eq('subject_code', TEST_SUBJECT_CODE);
    }
    if (created.studentId) {
      await supabaseAdmin.from('students').delete().eq('id', created.studentId);
    }
    if (created.subjectSeeded) {
      await supabaseAdmin.from('subjects').delete().eq('code', TEST_SUBJECT_CODE);
    }
  }, 60_000);

  // ── AC-1: enforced + sufficient verified pool -> strict (Rung E0) ────────
  it('AC-1: pair enabled, verified pool >= requested count -> 100% of returned rows are verified', async (ctx) => {
    skipIfNoSubstrate(ctx, available, setupError ?? 'setup did not complete');
    const chapter = 101;
    for (let i = 0; i < 5; i++) {
      await seedQuestion({
        chapterNumber: chapter,
        verificationState: 'verified',
        verifiedAgainstNcert: true,
        marker: `ac1-verified-${i}`,
      });
    }
    await setEnforcedPair(true);

    const rows = await callRag({ chapterNumber: chapter, count: 3 });
    expect(rows.length).toBe(3);
    const states = await verificationStatesFor(rows.map((r) => r.id));
    for (const row of rows) {
      const s = states.get(row.id);
      expect(s?.verification_state).toBe('verified');
      expect(s?.verified_against_ncert).toBe(true);
    }
  });

  // ── AC-2: enforced + locally thin -> relaxed (Rung E1) + telemetry ───────
  it('AC-2: pair enabled but locally thin -> reaches requested count via non-verified rows + emits quiz_verification_gap telemetry', async (ctx) => {
    skipIfNoSubstrate(ctx, available, setupError ?? 'setup did not complete');
    const chapter = 102;
    await seedQuestion({ chapterNumber: chapter, verificationState: 'verified', verifiedAgainstNcert: true, marker: 'ac2-verified-0' });
    await seedQuestion({ chapterNumber: chapter, verificationState: 'verified', verifiedAgainstNcert: true, marker: 'ac2-verified-1' });
    for (let i = 0; i < 5; i++) {
      await seedQuestion({
        chapterNumber: chapter,
        verificationState: 'legacy_unverified',
        verifiedAgainstNcert: false,
        marker: `ac2-legacy-${i}`,
      });
    }
    await setEnforcedPair(true);

    const beforeTelemetry = new Date().toISOString();
    const rows = await callRag({ chapterNumber: chapter, count: 5 });
    expect(rows.length).toBe(5); // 2 verified + 5 legacy = 7 available, non-failed pool covers p_count
    const states = await verificationStatesFor(rows.map((r) => r.id));
    const nonVerifiedCount = rows.filter((r) => states.get(r.id)?.verification_state !== 'verified').length;
    expect(nonVerifiedCount).toBeGreaterThan(0); // NOT restricted to verified-only

    // Telemetry: quiz_verification_gap fired for this pair after we called it.
    const { data: events, error: evErr } = await supabaseAdmin
      .from('ops_events')
      .select('id, category, message, context, occurred_at')
      .eq('category', 'grounding.quiz_serving')
      .eq('message', 'quiz_verification_gap')
      .gte('occurred_at', beforeTelemetry)
      .contains('context', { grade: TEST_GRADE, subject: TEST_SUBJECT_CODE, chapter_number: chapter });
    expect(evErr).toBeNull();
    expect((events ?? []).length).toBeGreaterThanOrEqual(1);
  });

  // ── AC-3: pair not enforced -> Tier-0-only default, no telemetry ─────────
  it('AC-3: pair not enabled -> serves both verified and legacy rows, no telemetry fires', async (ctx) => {
    skipIfNoSubstrate(ctx, available, setupError ?? 'setup did not complete');
    const chapter = 103;
    await seedQuestion({ chapterNumber: chapter, verificationState: 'verified', verifiedAgainstNcert: true, marker: 'ac3-verified-0' });
    await seedQuestion({ chapterNumber: chapter, verificationState: 'verified', verifiedAgainstNcert: true, marker: 'ac3-verified-1' });
    await seedQuestion({ chapterNumber: chapter, verificationState: 'legacy_unverified', verifiedAgainstNcert: false, marker: 'ac3-legacy-0' });
    await seedQuestion({ chapterNumber: chapter, verificationState: 'pending', verifiedAgainstNcert: false, marker: 'ac3-pending-0' });
    await setEnforcedPair(false); // explicit false row (distinct from "absent")

    const beforeTelemetry = new Date().toISOString();
    const rows = await callRag({ chapterNumber: chapter, count: 4 });
    expect(rows.length).toBe(4);
    const states = await verificationStatesFor(rows.map((r) => r.id));
    const distinctStates = new Set(rows.map((r) => states.get(r.id)?.verification_state));
    expect(distinctStates.size).toBeGreaterThan(1); // a genuine mix, not filtered to one tier

    const { data: events, error: evErr } = await supabaseAdmin
      .from('ops_events')
      .select('id')
      .eq('category', 'grounding.quiz_serving')
      .eq('message', 'quiz_verification_gap')
      .gte('occurred_at', beforeTelemetry)
      .contains('context', { grade: TEST_GRADE, subject: TEST_SUBJECT_CODE, chapter_number: chapter });
    expect(evErr).toBeNull();
    expect((events ?? []).length).toBe(0); // AC-3: unenforced default never fires telemetry
  });

  // ── AC-4: failed rows never served, enforced or not ──────────────────────
  it('AC-4a: failed rows are never returned even when they are the only rows available (unenforced)', async (ctx) => {
    skipIfNoSubstrate(ctx, available, setupError ?? 'setup did not complete');
    const chapter = 104;
    for (let i = 0; i < 5; i++) {
      await seedQuestion({ chapterNumber: chapter, verificationState: 'failed', verifiedAgainstNcert: false, marker: `ac4a-failed-${i}` });
    }
    await setEnforcedPair(false);

    const rows = await callRag({ chapterNumber: chapter, count: 5 });
    expect(rows.length).toBeLessThan(5); // cannot reach p_count — floor behavior, never re-admits failed
    const states = await verificationStatesFor(rows.map((r) => r.id));
    for (const row of rows) {
      expect(states.get(row.id)?.verification_state).not.toBe('failed');
    }
  });

  it('AC-4b: failed rows are never returned even when they are the only rows available (enforced)', async (ctx) => {
    skipIfNoSubstrate(ctx, available, setupError ?? 'setup did not complete');
    const chapter = 105;
    for (let i = 0; i < 5; i++) {
      await seedQuestion({ chapterNumber: chapter, verificationState: 'failed', verifiedAgainstNcert: false, marker: `ac4b-failed-${i}` });
    }
    await setEnforcedPair(true);

    const rows = await callRag({ chapterNumber: chapter, count: 5 });
    expect(rows.length).toBeLessThan(5);
    const states = await verificationStatesFor(rows.map((r) => r.id));
    for (const row of rows) {
      expect(states.get(row.id)?.verification_state).not.toBe('failed');
    }
  });

  // ── AC-5 / AC-6: soft-deleted and unpublished rows never served ──────────
  it('AC-5: deleted_at IS NOT NULL rows are never returned regardless of is_active', async (ctx) => {
    skipIfNoSubstrate(ctx, available, setupError ?? 'setup did not complete');
    const chapter = 106;
    const deletedId = await seedQuestion({
      chapterNumber: chapter,
      verificationState: 'verified',
      verifiedAgainstNcert: true,
      isActive: true,
      deletedAt: new Date().toISOString(),
      marker: 'ac5-soft-deleted',
    });
    await seedQuestion({ chapterNumber: chapter, verificationState: 'verified', verifiedAgainstNcert: true, marker: 'ac5-control' });
    await setEnforcedPair(false);

    const rows = await callRag({ chapterNumber: chapter, count: 10 });
    expect(rows.map((r) => r.id)).not.toContain(deletedId);
  });

  it('AC-6: content_status draft/review/archived rows are never returned regardless of is_active', async (ctx) => {
    skipIfNoSubstrate(ctx, available, setupError ?? 'setup did not complete');
    const chapter = 107;
    const draftId = await seedQuestion({
      chapterNumber: chapter,
      verificationState: 'verified',
      verifiedAgainstNcert: true,
      contentStatus: 'draft',
      marker: 'ac6-draft',
    });
    const reviewId = await seedQuestion({
      chapterNumber: chapter,
      verificationState: 'verified',
      verifiedAgainstNcert: true,
      contentStatus: 'review',
      marker: 'ac6-review',
    });
    const archivedId = await seedQuestion({
      chapterNumber: chapter,
      verificationState: 'verified',
      verifiedAgainstNcert: true,
      contentStatus: 'archived',
      marker: 'ac6-archived',
    });
    await seedQuestion({ chapterNumber: chapter, verificationState: 'verified', verifiedAgainstNcert: true, marker: 'ac6-control' });
    await setEnforcedPair(false);

    const rows = await callRag({ chapterNumber: chapter, count: 10 });
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(draftId);
    expect(ids).not.toContain(reviewId);
    expect(ids).not.toContain(archivedId);
  });
});
