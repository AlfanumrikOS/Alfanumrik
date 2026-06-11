/**
 * GET /api/learner/revise-stack — the decayed-topics list backing /revise.
 *
 * Phase 4 of ADR-001. Returns the full set of decayed chapters for the
 * authenticated learner, sorted most-stale-first. The Loop's single-
 * action resolver (/api/learner/next) only returns the TOP decayed
 * topic; this endpoint returns the whole stack so /revise can render
 * a browsable list.
 *
 * Reuses the `decayedChapters()` pure helper from resolve-next-action.ts —
 * same threshold (REVISE_MIN_MASTERY, RETENTION_WINDOW_DAYS) so /revise
 * and the resolver never disagree about what counts as decayed.
 *
 * Gating: ff_revise_route_v1. When OFF, returns 404 so callers fall
 * through to legacy behaviour. Independent of ff_learner_loop_v1 (the
 * resolver flag) so /revise can ship as a destination even before the
 * resolver is wired everywhere.
 *
 * Response (200):
 *   { schemaVersion: 1,
 *     resolvedAt: ISO,
 *     items: Array<{
 *       subjectCode: string,
 *       chapterNumber: number,
 *       mastery: number,        // 0..1
 *       daysSinceLastTouch: number,
 *       recommendedModality: 'read' | 'explainer' | 'worked-example',
 *       url: string,            // /learn/[subject]/[chapter]?mode=read&from=revise
 *     }>
 *   }
 *
 * Errors:
 *   401 unauthenticated
 *   404 flag off / no student profile / no decayed topics
 *   500 builder failure
 */

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { createStudentStateBuilder } from '@/lib/state/student-state-builder';
import { decayedChapters } from '@/lib/state/learner-loop/resolve-next-action';
import {
  modalityForMastery,
  type ReviseStackItem,
  type ReviseStackResponse,
} from '@/lib/state/learner-loop/revise-stack-modality';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const FLAG_NAME = 'ff_revise_route_v1';

/** Cap on stack size — past this is too much choice (Hick's law) and
 *  also too much to render on a mobile screen. */
const MAX_ITEMS = 12;

export async function GET(_request: Request) {
  const supabase = await createSupabaseServerClient();

  const { data: userResult, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResult?.user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const userId = userResult.user.id;

  // Flag gate.
  const flagOn = await isFeatureEnabled(FLAG_NAME, {
    userId, role: 'student',
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  });
  if (!flagOn) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Build StudentState — same canonical builder /api/learner/next uses.
  const builder = createStudentStateBuilder({ sb: supabase });
  let state;
  try {
    state = await builder(userId);
  } catch (err) {
    logger.warn('learner/revise-stack: state builder failed', {
      userId, error: (err as Error).message,
    });
    return NextResponse.json({ error: 'no_student_profile' }, { status: 404 });
  }

  const now = new Date();
  const decayed = decayedChapters(state, now);
  if (decayed.length === 0) {
    return NextResponse.json({ error: 'no_decayed_topics' }, { status: 404 });
  }

  const items: ReviseStackItem[] = decayed.slice(0, MAX_ITEMS).map(d => ({
    subjectCode: d.subjectCode,
    chapterNumber: d.chapterNumber,
    mastery: d.mastery,
    daysSinceLastTouch: Math.round(d.daysSince),
    recommendedModality: modalityForMastery(d.mastery),
    url: `/learn/${encodeURIComponent(d.subjectCode)}/${d.chapterNumber}?mode=read&from=revise`,
  }));

  const response: ReviseStackResponse = {
    schemaVersion: 1,
    resolvedAt: now.toISOString(),
    items,
  };

  return NextResponse.json(response, {
    headers: {
      // Same short cache as /api/learner/next. Mastery + last-touch
      // shift after every quiz; we want a fresh stack after activity.
      'Cache-Control': 'private, max-age=30, must-revalidate',
    },
  });
}
