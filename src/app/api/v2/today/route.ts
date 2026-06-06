/**
 * GET /api/v2/today — the "Today" home BFF (Consumer Minimalism Wave A).
 *
 * Returns the ordered "what could I do today?" queue for the authenticated
 * student, as render-ready DTOs. This is a THIN handler: every "what next"
 * decision lives in `resolveTodayQueue` (the Learner Loop's single source of
 * truth). The route only:
 *   1. authorizes (study_plan.view — student-scoped read),
 *   2. flag-gates (ff_today_home_v1 → 404 when off; callers fall back to
 *      /dashboard, mirroring the /api/learner/next + /api/rhythm/today pattern),
 *   3. builds StudentState + the loop augmentation via the SAME canonical
 *      wiring /api/learner/next uses (no re-derivation of student state),
 *   4. runs `resolveTodayQueue`,
 *   5. projects primary + queue into TodayQueueItem render DTOs, and
 *   6. assembles the TodayResponse envelope.
 *
 * Read-only — no learner-state writes (no scheduled_actions write-through;
 * that belongs to /api/learner/next). No scoring / XP / mastery math (P1/P2
 * untouched). No PII in logs (P13). 30s private cache to match
 * /api/learner/next (mastery + due reviews shift after each learning event).
 *
 * Spec: docs/superpowers/plans/2026-06-06-phase-1-consumer-minimalism.md
 */
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { authorizeRequest } from '@/lib/rbac';
import { isFeatureEnabled, CONSUMER_MINIMALISM_FLAGS } from '@/lib/feature-flags';
import { createStudentStateBuilder } from '@/lib/state/student-state-builder';
import {
  buildLoopAugmentation,
  resolveTodayQueue,
} from '@/lib/state/learner-loop/resolve-next-action';
import { mapActionToTodayItem } from '@/lib/today/map-action';
import type { TodayResponse } from '@/lib/today/types';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const FLAG_NAME = CONSUMER_MINIMALISM_FLAGS.TODAY_HOME_V1;

export async function GET(request: Request) {
  // 1. Auth — student-scoped read permission. Mirrors /api/student/daily-plan.
  const auth = await authorizeRequest(request, 'study_plan.view', {
    requireStudentId: true,
  });
  if (!auth.authorized) return auth.errorResponse!;

  const userId = auth.userId!;

  // 2. Flag gate. 404 when OFF so callers fall through to /dashboard, mirroring
  //    /api/learner/next + /api/rhythm/today.
  const flagOn = await isFeatureEnabled(FLAG_NAME, {
    userId,
    role: 'student',
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  });
  if (!flagOn) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  try {
    // 3. Build StudentState via the canonical builder (single source of truth).
    //    Same wiring as /api/learner/next — never re-derive student state here.
    const supabase = await createSupabaseServerClient();
    const builder = createStudentStateBuilder({ sb: supabase });

    let state;
    try {
      state = await builder(userId);
    } catch (err) {
      // No student profile → 404 (callers fall back), not a 500. No PII logged.
      logger.warn('v2/today: state builder failed', {
        userId,
        error: (err as Error).message,
      });
      return NextResponse.json({ error: 'no_student_profile' }, { status: 404 });
    }

    // Build the small augmentation (due reviews, today's quiz, in-progress
    // lessons). Defensive — failures degrade to "empty", never a 500.
    let augmentation;
    try {
      augmentation = await buildLoopAugmentation(supabase, userId, state.studentId);
    } catch (err) {
      logger.warn('v2/today: augmentation failed; using safe defaults', {
        userId,
        error: (err as Error).message,
      });
      augmentation = {
        dueReviewCount: 0,
        attemptedQuizToday: false,
        inProgressLessons: [],
      };
    }

    // 4. Resolve the Today queue — all "what next" logic stays here.
    const now = new Date();
    const result = resolveTodayQueue(state, augmentation, { now });

    // 5. Project primary + queue into render DTOs (1-based rank).
    const queue = result.queue.map((action, i) => mapActionToTodayItem(action, i + 1));
    const primary = queue[0] ?? mapActionToTodayItem(result.primary, 1);

    // 6. Assemble the envelope.
    const payload: TodayResponse = {
      schemaVersion: 1,
      resolvedAt: now.toISOString(),
      primary,
      queue,
      meta: {
        branch: result.branch,
        masterySubjectCount: state.mastery.length,
        dueReviewCount: augmentation.dueReviewCount,
      },
    };

    return NextResponse.json(payload, {
      headers: {
        // Short cache — mastery shifts after every learning event; match
        // /api/learner/next so dashboard components coalesce on one render.
        'Cache-Control': 'private, max-age=30, must-revalidate',
      },
    });
  } catch (err) {
    // Clean 500, no PII (P13) — log only an opaque message.
    logger.error('v2/today: unexpected failure', {
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
