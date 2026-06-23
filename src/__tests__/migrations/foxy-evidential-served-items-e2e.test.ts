import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { hasSupabaseIntegrationEnv } from '../helpers/integration';

/**
 * PART B1 — foxy_served_items verification substrate — END-TO-END (integration).
 *
 * Companion to the mocked route contract (src/__tests__/api/foxy/quiz-answer.test.ts)
 * and the structural pins. This exercises the DB-level invariants that make the
 * served-item the trustworthy verification anchor (anti mastery-injection):
 *
 *   B1.6  — a SECOND gradable serve for the SAME (session, concept) is refused
 *           by the UNIQUE(session_id, concept_id) constraint (Postgres 23505)
 *           -> the second "Quiz me" on the same concept is NON-evidential.
 *   B1.4  — the single-use claim: a conditional UPDATE on `answered_at IS NULL`
 *           claims the row exactly once. A second claim (even a different
 *           attempt_id) matches 0 rows -> no double-apply window.
 *   correct_index is a SERVER-HELD answer key (0..3 CHECK) and is owned by the
 *   inserting student.
 *
 * NOTE: the full graded mastery move (served-item -> tutor_commit_attempt ->
 * conceptMasteryProjector) is proven by canonical-mastery-e2e.test.ts (the BKT
 * RPC moves concept_mastery live) + quiz-answer.test.ts (the route wires the
 * served item into tutor_commit_attempt). This file pins the SUBSTRATE
 * guarantees the route relies on.
 *
 * LANE: integration. Skips cleanly unless real Supabase creds are present.
 *
 * DATA HYGIENE: reuses ONE existing student + ONE existing chapter_concepts row
 * + ONE existing foxy_session FOR THAT STUDENT (read from the DB). The only rows
 * written are foxy_served_items keyed by that (session, concept). afterAll
 * DELETEs every served-item row this test created (tracked by id). No throwaway
 * students/concepts/sessions; no mastery / XP / quiz writes.
 */

const describeIntegration = hasSupabaseIntegrationEnv() ? describe : describe.skip;

describeIntegration('PART B1 — foxy_served_items substrate (live DB)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: SupabaseClient<any>;
  let studentId: string;
  let conceptId: string;
  let sessionId: string;
  let available = false;
  const createdIds: string[] = [];

  beforeAll(async () => {
    const { makeServiceSupabase } = await import('./_helpers/supabase-runtime');
    admin = makeServiceSupabase();

    // Need a student that owns a foxy_session, plus any chapter_concepts row.
    const { data: session } = await admin
      .from('foxy_sessions')
      .select('id, student_id')
      .limit(1)
      .maybeSingle();
    const { data: concept } = await admin
      .from('chapter_concepts')
      .select('id')
      .limit(1)
      .maybeSingle();

    if (!session || !concept) {
      // Substrate not populated on this DB — leave available=false; the tests
      // assert availability so the gap is visible rather than silently green.
      return;
    }
    sessionId = (session as { id: string }).id;
    studentId = (session as { student_id: string }).student_id;
    conceptId = (concept as { id: string }).id;

    // Clean any pre-existing served item for this exact (session, concept) so the
    // UNIQUE-guard assertion is deterministic.
    await admin
      .from('foxy_served_items')
      .delete()
      .eq('session_id', sessionId)
      .eq('concept_id', conceptId);

    available = true;
  });

  afterAll(async () => {
    if (!admin) return;
    if (createdIds.length > 0) {
      await admin.from('foxy_served_items').delete().in('id', createdIds);
    }
    // Belt-and-braces: clear anything left for this (session, concept).
    if (sessionId && conceptId) {
      await admin
        .from('foxy_served_items')
        .delete()
        .eq('session_id', sessionId)
        .eq('concept_id', conceptId);
    }
  });

  it('substrate available (student + concept + session exist to drive the test)', () => {
    expect(available, 'no foxy_session / chapter_concepts to reuse on this DB').toBe(true);
  });

  it('B1.6 — a second serve for the SAME (session, concept) is refused (23505)', async () => {
    if (!available) return;
    const first = await admin
      .from('foxy_served_items')
      .insert({
        session_id: sessionId,
        student_id: studentId,
        concept_id: conceptId,
        question_id: `${conceptId}:evidential:v1`,
        question_payload: { stem: 'q', options: ['a', 'b', 'c', 'd'], source: 'mcq_block' },
        correct_index: 1,
      })
      .select('id')
      .single();
    expect(first.error).toBeNull();
    createdIds.push((first.data as { id: string }).id);

    // Second serve for the same (session, concept) → UNIQUE violation.
    const second = await admin
      .from('foxy_served_items')
      .insert({
        session_id: sessionId,
        student_id: studentId,
        concept_id: conceptId,
        question_id: `${conceptId}:evidential:v1`,
        question_payload: { stem: 'q2', options: ['a', 'b', 'c', 'd'], source: 'mcq_block' },
        correct_index: 2,
      })
      .select('id')
      .single();
    expect(second.error, 'second serve must be refused by the UNIQUE guard').not.toBeNull();
    expect(second.error!.code).toBe('23505');
    if (second.data) createdIds.push((second.data as { id: string }).id);
  });

  it('B1.4 — single-use claim: conditional UPDATE on answered_at IS NULL claims exactly once', async () => {
    if (!available) return;
    const claimTime = new Date().toISOString();
    const firstAttempt = crypto.randomUUID();
    const secondAttempt = crypto.randomUUID();

    // First claim: matches the unanswered row.
    const claim1 = await admin
      .from('foxy_served_items')
      .update({ answered_at: claimTime, attempt_id: firstAttempt })
      .eq('session_id', sessionId)
      .eq('concept_id', conceptId)
      .is('answered_at', null)
      .select('id');
    expect(claim1.error).toBeNull();
    expect((claim1.data ?? []).length).toBe(1);

    // Second claim (different attempt_id): row already answered → matches 0 rows.
    const claim2 = await admin
      .from('foxy_served_items')
      .update({ answered_at: new Date().toISOString(), attempt_id: secondAttempt })
      .eq('session_id', sessionId)
      .eq('concept_id', conceptId)
      .is('answered_at', null)
      .select('id');
    expect(claim2.error).toBeNull();
    expect(
      (claim2.data ?? []).length,
      'a second claim must match 0 rows (no double-apply window)',
    ).toBe(0);
  });

  it('correct_index CHECK rejects an out-of-range answer key (0..3)', async () => {
    if (!available) return;
    const bad = await admin
      .from('foxy_served_items')
      .insert({
        session_id: sessionId,
        student_id: studentId,
        concept_id: conceptId,
        question_id: `${conceptId}:evidential:bad`,
        question_payload: { stem: 'q', options: ['a', 'b', 'c', 'd'], source: 'mcq_block' },
        correct_index: 9, // out of 0..3
      })
      .select('id')
      .single();
    expect(bad.error, 'correct_index=9 must violate the CHECK constraint').not.toBeNull();
    if (bad.data) createdIds.push((bad.data as { id: string }).id);
  });
});
