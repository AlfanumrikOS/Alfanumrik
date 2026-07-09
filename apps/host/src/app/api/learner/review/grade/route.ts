/**
 * POST /api/learner/review/grade — server-side SM-2 grading + event publish.
 *
 * Phase 2b of ADR-001 (The Learner Loop). Replaces the client-side direct
 * UPDATE on `spaced_repetition_cards` that lived in `/review/page.tsx`'s
 * `rateCard()`. Reasons for the move:
 *
 *   1. **Publish `learner.review_graded`.** The Learner Loop's bus consumes
 *      this; client direct-writes never produced an event.
 *   2. **Server-side SM-2.** Caps (ease 1.3–3.0, interval ≤365, streak ≤100)
 *      are enforced where DevTools can't tamper. Client keeps its own
 *      defense-in-depth checks but the server is now the source of truth.
 *   3. **Idempotency.** Same `cardId` graded twice in one second is a single
 *      published event (idempotencyKey is per-card-per-attempt timestamp).
 *
 * Behaviour parity with the legacy client path:
 *   - Same SM-2 algorithm verbatim from `src/app/review/page.tsx:163-180`
 *   - Same caps verbatim
 *   - Same UPDATE field set (ease_factor, interval_days, streak,
 *     repetition_count, next_review_date, last_review_date, last_quality,
 *     total_reviews, correct_reviews, updated_at)
 *
 * Gating: there is NO route-level flag. The publishEvent() call is gated
 * by `ff_event_bus_v1`; when OFF the event is dropped but the SM-2 update
 * still happens (so this route is a strict superset of the legacy client
 * path's behaviour, ready to take over without a flag flip).
 *
 * Request:
 *   { cardId: uuid, quality: 0 | 3 | 4 | 5 }
 *
 * Response (200):
 *   { ok: true, card: { id, ease_factor, interval_days, streak,
 *                       repetition_count, next_review_date, last_review_date,
 *                       last_quality, total_reviews, correct_reviews } }
 *
 * Errors:
 *   400 invalid body / unknown card
 *   401 unauthenticated
 *   403 card belongs to a different student
 *   500 DB write failed
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { publishEvent } from '@alfanumrik/lib/state/events/publish';
import { applySm2, coerceSource, parseChapterNumber } from './helpers';

// ─── Constants — mirror the legacy client's caps ────────────────────

// SM-2 quality only accepts the 4 buttons the UI exposes.
const RequestSchema = z.object({
  cardId: z.string().uuid(),
  quality: z.union([z.literal(0), z.literal(3), z.literal(4), z.literal(5)]),
});

interface CardRow {
  id: string;
  student_id: string;
  subject: string | null;
  chapter_title: string | null;
  ease_factor: number;
  interval_days: number;
  streak: number;
  repetition_count: number | null;
  total_reviews: number | null;
  correct_reviews: number | null;
  source: string | null;
}

// ─── Handler ─────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Auth (uses the existing review.practice permission).
  const auth = await authorizeRequest(request, 'review.practice', {
    requireStudentId: true,
  });
  if (!auth.authorized) return auth.errorResponse!;

  const userId = auth.userId!;
  const studentId = auth.studentId!;

  // Body validate.
  let body: z.infer<typeof RequestSchema>;
  try {
    body = RequestSchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: 'invalid_body', detail: (err as Error).message.slice(0, 300) },
      { status: 400 },
    );
  }
  const { cardId, quality } = body;

  // Read the card. Service-role so we can update; we enforce student_id
  // ownership ourselves below.
  const { data: cardRaw, error: readErr } = await supabaseAdmin
    .from('spaced_repetition_cards')
    .select('id, student_id, subject, chapter_title, ease_factor, interval_days, streak, repetition_count, total_reviews, correct_reviews, source')
    .eq('id', cardId)
    .maybeSingle();
  if (readErr) {
    logger.warn('review.grade: card read failed', { cardId, error: readErr.message });
    return NextResponse.json({ ok: false, error: 'card_read_failed' }, { status: 500 });
  }
  const card = cardRaw as CardRow | null;
  if (!card) {
    return NextResponse.json({ ok: false, error: 'card_not_found' }, { status: 400 });
  }
  if (card.student_id !== studentId) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  // Apply SM-2.
  const sm2 = applySm2({
    easeFactor: card.ease_factor,
    intervalDays: card.interval_days,
    streak: card.streak,
    quality,
  });

  const todayYmd = new Date().toISOString().split('T')[0];
  const nextReviewYmd = new Date(Date.now() + sm2.intervalDays * 86_400_000)
    .toISOString()
    .split('T')[0];

  const newTotalReviews = (card.total_reviews ?? 0) + 1;
  const newCorrectReviews = (card.correct_reviews ?? 0) + (quality >= 3 ? 1 : 0);
  const newRepetitionCount = (card.repetition_count ?? 0) + 1;

  // Persist.
  const { error: updateErr } = await supabaseAdmin
    .from('spaced_repetition_cards')
    .update({
      ease_factor: sm2.easeFactor,
      interval_days: sm2.intervalDays,
      streak: sm2.streak,
      repetition_count: newRepetitionCount,
      next_review_date: nextReviewYmd,
      last_review_date: todayYmd,
      last_quality: quality,
      total_reviews: newTotalReviews,
      correct_reviews: newCorrectReviews,
      updated_at: new Date().toISOString(),
    })
    .eq('id', card.id);
  if (updateErr) {
    logger.warn('review.grade: card update failed', { cardId, error: updateErr.message });
    return NextResponse.json({ ok: false, error: 'card_update_failed' }, { status: 500 });
  }

  // Publish learner.review_graded. Best-effort — never blocks the response.
  // Gated by ff_event_bus_v1 inside publishEvent (no-op when OFF).
  try {
    // Resolve tenant scope from students.school_id. Read is cheap and the
    // student row is small. If it fails, fall through to tenantId=null.
    const { data: studentRow } = await supabaseAdmin
      .from('students')
      .select('school_id')
      .eq('id', studentId)
      .maybeSingle();
    const tenantId = (studentRow as { school_id?: string | null } | null)?.school_id ?? null;

    // Subject/chapter come from the card. Chapter is stored as a *title*
    // (text), not a number — only emit when we can parse a positive int
    // off the front. Otherwise omit by emitting null; the event schema
    // does not allow null chapterNumber, so when we can't parse we skip
    // the event rather than publish a malformed payload.
    const chapterNum = parseChapterNumber(card.chapter_title);
    if (card.subject && chapterNum !== null) {
      await publishEvent(supabaseAdmin, {
        kind: 'learner.review_graded',
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        actorAuthUserId: userId,
        tenantId,
        idempotencyKey: `review_graded:${card.id}:${newTotalReviews}`,
        payload: {
          cardId: card.id,
          subjectCode: card.subject.toLowerCase(),
          chapterNumber: chapterNum,
          quality,
          source: coerceSource(card.source),
          previousIntervalDays: card.interval_days,
        },
      });
    }
  } catch (err) {
    logger.warn('review.grade: publishEvent learner.review_graded failed', {
      cardId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return NextResponse.json(
    {
      ok: true,
      card: {
        id: card.id,
        ease_factor: sm2.easeFactor,
        interval_days: sm2.intervalDays,
        streak: sm2.streak,
        repetition_count: newRepetitionCount,
        next_review_date: nextReviewYmd,
        last_review_date: todayYmd,
        last_quality: quality,
        total_reviews: newTotalReviews,
        correct_reviews: newCorrectReviews,
      },
    },
    { status: 200 },
  );
}
