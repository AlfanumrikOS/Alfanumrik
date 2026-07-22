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
 * Gating: NONE (unconditional, permanent default — matches the pattern
 * used for ff_study_menu_v2). This route originally shipped behind
 * ff_revise_route_v1 (Phase 4 of ADR-001). That flag row was deleted by
 * migration 20260603120000_remove_ff_revise_route_v1.sql once the
 * standalone /revise page was folded into /refresh's "Chapter Refresh"
 * section (Study Menu v2 consolidation, Task 6.4). The migration and its
 * companion plan correctly removed the OLD /revise page + its nav-visibility
 * flag check, but this route's OWN internal isFeatureEnabled() gate was
 * never removed — since isFeatureEnabled() returns false for any
 * nonexistent flag row, that left this endpoint 404ing UNCONDITIONALLY for
 * every student after the flag row was dropped. Fixed 2026-07-21 by
 * deleting the dead gate rather than re-seeding the flag (re-seeding would
 * just recreate the same "flag lifecycle drifts from code" fragility).
 * See REG-303.
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
 *   404 no student profile / no decayed topics
 *   500 builder failure
 */

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';
import { createStudentStateBuilder } from '@alfanumrik/lib/state/student-state-builder';
import { decayedChapters } from '@alfanumrik/lib/state/learner-loop/resolve-next-action';
import {
  modalityForMastery,
  type ReviseStackItem,
  type ReviseStackResponse,
} from '@alfanumrik/lib/state/learner-loop/revise-stack-modality';
import { logger } from '@alfanumrik/lib/logger';

export const dynamic = 'force-dynamic';

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
