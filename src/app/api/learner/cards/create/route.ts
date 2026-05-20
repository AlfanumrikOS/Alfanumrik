/**
 * POST /api/learner/cards/create — student-created flashcards.
 *
 * Section D of the /refresh page. Inserts a new row into
 * `spaced_repetition_cards` with `source = 'student_created'` and SM-2
 * defaults (ease 2.5, interval 1 day, streak 0). The card becomes due
 * "tomorrow" in the existing Quick Recall section.
 *
 * Validations (defense in depth — the migration check constraint also
 * enforces `source IN (...)`):
 *   - subjectCode: 1-32 chars, lowercase letters/digits only
 *   - frontText: 1-200 chars
 *   - backText:  1-200 chars
 *   - hint:      0-100 chars (optional)
 *
 * Rate limit: per-student daily insert cap is enforced by the in-route
 * count query (≤ 20 cards in the trailing 24 hours).
 *
 * Spec: docs/superpowers/specs/2026-05-20-study-section-consolidation-design.md §6 Section D
 *
 * Returns:
 *   200 { ok: true, cardId }
 *   400 invalid body OR daily cap hit
 *   401 unauthenticated
 *   500 insert failed
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

const RequestSchema = z.object({
  subjectCode: z.string().regex(/^[a-z0-9_]{1,32}$/),
  frontText: z.string().min(1).max(200),
  backText: z.string().min(1).max(200),
  hint: z.string().max(100).optional(),
});

const DAILY_CAP = 20;

export async function POST(request: NextRequest) {
  const auth = await authorizeRequest(request, 'review.practice', {
    requireStudentId: true,
  });
  if (!auth.authorized) return auth.errorResponse!;

  const studentId = auth.studentId!;

  let body: z.infer<typeof RequestSchema>;
  try {
    body = RequestSchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: 'invalid_body', detail: (err as Error).message.slice(0, 300) },
      { status: 400 },
    );
  }

  // Daily-cap check: how many cards has this student created in the last 24h?
  const sinceIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count: existingCount, error: countErr } = await supabaseAdmin
    .from('spaced_repetition_cards')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', studentId)
    .eq('source', 'student_created')
    .gte('created_at', sinceIso);

  if (countErr) {
    logger.warn('cards.create: cap-count failed', { error: countErr.message });
    return NextResponse.json({ ok: false, error: 'count_failed' }, { status: 500 });
  }

  if ((existingCount ?? 0) >= DAILY_CAP) {
    return NextResponse.json(
      { ok: false, error: 'daily_cap_hit', cap: DAILY_CAP },
      { status: 400 },
    );
  }

  const todayYmd = new Date().toISOString().split('T')[0];
  const tomorrowYmd = new Date(Date.now() + 86_400_000).toISOString().split('T')[0];

  const row = {
    student_id: studentId,
    subject: body.subjectCode,
    chapter_title: null,
    front_text: body.frontText,
    back_text: body.backText,
    hint: body.hint ?? null,
    source: 'student_created' as const,
    ease_factor: 2.5,
    interval_days: 1,
    streak: 0,
    repetition_count: 0,
    total_reviews: 0,
    correct_reviews: 0,
    next_review_date: tomorrowYmd,
    last_review_date: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data, error: insertErr } = await supabaseAdmin
    .from('spaced_repetition_cards')
    .insert(row)
    .select('id')
    .single();

  if (insertErr) {
    logger.warn('cards.create: insert failed', { error: insertErr.message });
    return NextResponse.json({ ok: false, error: 'insert_failed' }, { status: 500 });
  }

  logger.info('cards.create: card created', {
    studentId,
    cardId: (data as { id: string } | null)?.id,
    subjectCode: body.subjectCode,
  });

  return NextResponse.json(
    { ok: true, cardId: (data as { id: string } | null)?.id, scheduledFor: tomorrowYmd },
    { status: 200 },
  );

  // Note: this route deliberately does NOT publish learner.review_graded
  // (no review happened) and does NOT publish learner.card_created (event
  // schema for that is added separately in src/lib/state/events/registry.ts
  // in Task 3.3; this route will be re-edited at that point).
  void todayYmd;
}
