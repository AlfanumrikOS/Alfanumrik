/**
 * GET /api/learner/next — the Learner Loop's single entry point.
 *
 * Returns the one LearnerAction the UI should dispatch right now for the
 * authenticated student. Every "Begin Lesson" / "Continue learning" /
 * "Start Today's Quiz" button is meant to call this and route to the
 * returned `action.url`. The 8-branch resolver lives in
 * src/lib/state/learner-loop/resolve-next-action.ts.
 *
 * Gating: ff_learner_loop_v1. When OFF, returns 404 so callers fall
 * through to their legacy "what should I do next?" heuristic. The flag
 * lets us roll Phase 1 per-user per the existing rollout pattern.
 *
 * Caching: 30-second private cache. Short window because mastery + due
 * reviews shift after every quiz attempt and we don't want a stale
 * resolver answer surviving a learning event. Long enough to coalesce
 * the dashboard's two-or-three components that all want "what next?"
 * on the same render.
 *
 * Telemetry:
 *   - learner_next_resolved (always, every successful response)
 *   - resolver_branch_chosen (the chosen branch name)
 *   - learner_next_404 (flag off / no profile / not signed in)
 *
 * Tenant scope: the resolver itself is tenant-agnostic; the augmenter
 * scopes by student_id. Tenant-aware sensitivity tuning (Phase 4) will
 * thread through the optional `config` parameter.
 *
 * ADR: docs/architecture/ADR-001-learner-loop-unification.md
 */
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { createStudentStateBuilder } from '@/lib/state/student-state-builder';
import {
  buildLoopAugmentation,
  resolveNextLearnerAction,
} from '@/lib/state/learner-loop/resolve-next-action';
import type { ResolveNextResponse } from '@/lib/state/learner-loop/types';
import {
  dayBucketIst,
  expiresAtForHorizon,
} from '@/lib/state/learner-loop/scheduled-actions';
import { logger } from '@/lib/logger';
import { capture } from '@/lib/posthog/server';

export const dynamic = 'force-dynamic';

const FLAG_NAME = 'ff_learner_loop_v1';
const SCHEDULED_FLAG_NAME = 'ff_scheduled_actions_v1';

export async function GET(_request: Request) {
  const supabase = await createSupabaseServerClient();

  const { data: userResult, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResult?.user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const userId = userResult.user.id;

  // Flag gate. Mirrors the rhythm/today pattern — 404 when off so
  // upstream consumers fall through to legacy behaviour without branching.
  const flagOn = await isFeatureEnabled(FLAG_NAME, {
    userId,
    role: 'student',
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  });
  if (!flagOn) {
    await capture('learner_next_404', userId, { reason: 'flag_off' });
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Build StudentState via the canonical builder (single source of truth).
  const builder = createStudentStateBuilder({ sb: supabase });
  let state;
  try {
    state = await builder(userId);
  } catch (err) {
    logger.warn('learner/next: state builder failed', {
      userId, error: (err as Error).message,
    });
    await capture('learner_next_404', userId, { reason: 'no_profile' });
    return NextResponse.json({ error: 'no_student_profile' }, { status: 404 });
  }

  // Build the small augmentation (due reviews, today's quizzes, in-progress
  // lessons). Defensive — failures here degrade to "empty" not "500".
  let augmentation;
  try {
    augmentation = await buildLoopAugmentation(supabase, userId, state.studentId);
  } catch (err) {
    logger.warn('learner/next: augmentation failed; using safe defaults', {
      userId, error: (err as Error).message,
    });
    augmentation = {
      dueReviewCount: 0,
      attemptedQuizToday: false,
      inProgressLessons: [],
    };
  }

  const now = new Date();
  const action = resolveNextLearnerAction(state, augmentation, { now });

  const payload: ResolveNextResponse = {
    schemaVersion: 1,
    resolvedAt: now.toISOString(),
    action,
    meta: {
      branch: action.kind,
      cached: false,
    },
  };

  await capture('learner_next_resolved', userId, {
    branch: action.kind,
    reason: action.reason,
    due_review_count: augmentation.dueReviewCount,
    attempted_quiz_today: augmentation.attemptedQuizToday,
    in_progress_lesson_count: augmentation.inProgressLessons.length,
    mastery_subject_count: state.mastery.length,
  });

  // ADR-001 Phase 3c — write-through to scheduled_actions. Best-effort:
  // never blocks the response. Gated by ff_scheduled_actions_v1 — when
  // OFF, the upsert is skipped and the response is identical to Phase 1/2.
  // Overwrite-within-day semantics (DO UPDATE on conflict). A future PR
  // may switch to pin-once-per-day stability.
  try {
    const scheduledFlagOn = await isFeatureEnabled(SCHEDULED_FLAG_NAME, {
      userId, role: 'student',
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
    });
    if (scheduledFlagOn) {
      const dayBucket = dayBucketIst(now);
      const expiresAt = expiresAtForHorizon('daily', now);
      const { error: upsertErr } = await supabaseAdmin
        .from('scheduled_actions')
        .upsert({
          student_id: state.studentId,
          horizon: 'daily',
          day_bucket: dayBucket,
          rank: 0,
          action_kind: action.kind,
          action_payload: action,
          source: 'scheduler',
          generated_at: now.toISOString(),
          expires_at: expiresAt,
        }, {
          onConflict: 'student_id,horizon,day_bucket,rank',
        });
      if (upsertErr) {
        logger.warn('learner/next: scheduled_actions upsert failed', {
          userId, studentId: state.studentId, error: upsertErr.message,
        });
      }
    }
  } catch (err) {
    logger.warn('learner/next: scheduled_actions write-through threw', {
      userId, error: err instanceof Error ? err.message : String(err),
    });
  }

  return NextResponse.json(payload, {
    headers: {
      // Short cache — mastery shifts after every quiz; we want the next
      // resolution after a learning event, not 5 minutes later.
      'Cache-Control': 'private, max-age=30, must-revalidate',
    },
  });
}
