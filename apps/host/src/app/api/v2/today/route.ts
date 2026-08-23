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
 * VIEW-AS (?studentId=…): the route also serves a READ-ONLY queue for a
 * TARGET student to authenticated non-student callers (parent / teacher /
 * institution admin), mirroring the /api/pulse/student/[id] contract:
 *   - authorizeRequest(request) — authenticate + load roles/perms only,
 *   - canAccessStudent(caller, target) — THE hard boundary (own / linked /
 *     assigned / institution / admin) → 403 + denied audit,
 *   - hasAnyPermission([viewing permissions]) — relationship without a viewing
 *     permission is still denied → 403 + denied audit,
 *   - target state is built via the service-role admin client (P8) keyed to the
 *     target's auth_user_id; the caller's own studentId is never used.
 * The teacher-remediation status flip is SKIPPED for view-as callers (read-only
 * lens); it only ever fires for the student's own session.
 *
 * Read-only — no learner-state writes (no scheduled_actions write-through;
 * that belongs to /api/learner/next). No scoring / XP / mastery math (P1/P2
 * untouched). No PII in logs (P13). 30s private cache to match
 * /api/learner/next (mastery + due reviews shift after each learning event).
 *
 * Spec: docs/superpowers/plans/2026-06-06-phase-1-consumer-minimalism.md
 */
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseRouteClient } from '@alfanumrik/lib/supabase-route';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import {
  authorizeRequest,
  canAccessStudent,
  hasAnyPermission,
  logAudit,
} from '@alfanumrik/lib/rbac';
import { isFeatureEnabled, CONSUMER_MINIMALISM_FLAGS } from '@alfanumrik/lib/feature-flags';
import { isValidUUID } from '@alfanumrik/lib/sanitize';
import { createStudentStateBuilder } from '@alfanumrik/lib/state/student-state-builder';
import {
  buildLoopAugmentation,
  markTeacherRemediationInProgress,
  resolveTodayQueue,
} from '@alfanumrik/lib/state/learner-loop/resolve-next-action';
import { mapActionToTodayItem } from '@alfanumrik/lib/today/map-action';
import type { TodayResponse } from '@alfanumrik/lib/today/types';
import { logger } from '@alfanumrik/lib/logger';
import { withRoute } from '@alfanumrik/lib/api/v2/with-route';

type ChapterTitleMap = Map<string, { title: string; titleHi: string | null }>;

export const dynamic = 'force-dynamic';

const FLAG_NAME = CONSUMER_MINIMALISM_FLAGS.TODAY_HOME_V1;

/** Viewing permissions for the view-as lens — holding ANY one (with a valid
 *  relationship) grants. Mirrors /api/pulse/student/[id]. */
const VIEW_AS_PERMISSIONS = [
  'child.view_progress', // parent
  'class.view_analytics', // teacher
  'report.view_class', // teacher / coordinator
  'institution.view_analytics', // principal / institution_admin
];

export const GET = withRoute(async (request: Request) => {
  // 0. Optional view-as target. The hook sends it so the SWR key and the URL
  //    always agree (P13 — no cross-student cache pollution on shared devices).
  const requestedStudentId = new URL(request.url).searchParams.get('studentId');

  // 1. Auth — self: student-scoped read permission (mirrors
  //    /api/student/daily-plan). View-as: authenticate + load the caller's
  //    roles/permissions only; the relationship + permission gates below are
  //    the actual boundary (mirrors /api/pulse/student/[id]).
  let auth;
  if (requestedStudentId) {
    auth = await authorizeRequest(request);
  } else {
    auth = await authorizeRequest(request, 'study_plan.view', {
      requireStudentId: true,
    });
  }
  if (!auth.authorized) return auth.errorResponse as unknown as NextResponse;

  const callerId = auth.userId!;
  const isSelf = !requestedStudentId || requestedStudentId === auth.studentId;

  // 2. Flag gate. 404 when OFF so callers fall through to /dashboard, mirroring
  //    /api/learner/next + /api/rhythm/today.
  const flagOn = await isFeatureEnabled(FLAG_NAME, {
    userId: callerId,
    role: 'student',
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  });
  if (!flagOn) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // 3. View-as gates (only when targeting someone OTHER than the caller).
  if (!isSelf) {
    const targetStudentId = requestedStudentId!;
    if (!isValidUUID(targetStudentId)) {
      return NextResponse.json({ error: 'invalid_student_id' }, { status: 400 });
    }

    // Hard ownership boundary (own / linked / assigned / institution / admin).
    const canAccess = await canAccessStudent(callerId, targetStudentId);
    if (!canAccess) {
      void logAudit(callerId, {
        action: 'today.student_viewed',
        resourceType: 'students',
        resourceId: targetStudentId,
        status: 'denied',
        details: { reason: 'no_relationship' },
      });
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    // Relationship alone is not enough — a viewing permission is required.
    const canView = await hasAnyPermission(callerId, VIEW_AS_PERMISSIONS);
    if (!canView) {
      void logAudit(callerId, {
        action: 'today.student_viewed',
        resourceType: 'students',
        resourceId: targetStudentId,
        status: 'denied',
        details: { reason: 'no_view_permission' },
      });
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
  }

  try {
    // 4. Build StudentState via the canonical builder (single source of truth).
    //    Same wiring as /api/learner/next — never re-derive student state here.
    //    Service-role admin client for the teacher-remediation read (Phase 3A
    //    Wave A / A3) — the teacher_remediation_assignments row is student-keyed
    //    and read through the admin client per the A1 contract.
    const admin = getSupabaseAdmin();

    // Self → RLS-respecting client + caller's auth user. View-as → service-role
    // client keyed to the TARGET's auth user (P8); the caller's own identity is
    // never substituted into the state reads.
    //
    // The SELF branch uses the Bearer-AWARE route client. The cookie-only
    // createSupabaseServerClient() NULLed auth.uid() for `Authorization: Bearer`
    // callers (the entire Flutter app), so the state builder's RLS reads denied
    // and this route answered a spurious 404 no_student_profile. Still RLS-
    // scoped on both transports — never service-role. The VIEW-AS branch is
    // unchanged: it must stay on the admin client because it reads the TARGET
    // student's rows, which the caller's own JWT can never see under RLS; that
    // path's boundary is canAccessStudent + hasAnyPermission above.
    let stateClient: SupabaseClient;
    let targetUserId = callerId;
    if (isSelf) {
      stateClient = await createSupabaseRouteClient(request);
    } else {
      stateClient = admin;
      const { data: target, error: targetErr } = await admin
        .from('students')
        .select('auth_user_id')
        .eq('id', requestedStudentId!)
        .maybeSingle();
      if (targetErr) {
        logger.error('v2/today: target lookup failed', {
          userId: callerId,
          error: new Error(targetErr.message),
        });
        return NextResponse.json({ error: 'internal_error' }, { status: 500 });
      }
      if (!target || !target.auth_user_id) {
        return NextResponse.json({ error: 'no_student_profile' }, { status: 404 });
      }
      targetUserId = target.auth_user_id;
    }

    const builder = createStudentStateBuilder({ sb: stateClient });

    let state;
    try {
      state = await builder(targetUserId);
    } catch (err) {
      // No student profile → 404 (callers fall back), not a 500. No PII logged.
      logger.warn('v2/today: state builder failed', {
        userId: targetUserId,
        error: (err as Error).message,
      });
      return NextResponse.json({ error: 'no_student_profile' }, { status: 404 });
    }

    const masteryPairs = state.mastery.flatMap(s =>
      s.chapters.map(c => ({ s: s.subjectCode, c: c.chapterNumber }))
    );

    // Build the small augmentation (due reviews, today's quiz, in-progress
    // lessons, pending teacher remediation). Defensive — failures degrade to
    // "empty", never a 500.
    let augmentation;
    try {
      augmentation = await buildLoopAugmentation(stateClient, targetUserId, state.studentId, {
        adminClient: admin,
      });
    } catch (err) {
      logger.error('v2/today: augmentation failed; using safe defaults', {
        error: err instanceof Error ? err : new Error(String(err)),
        userId: targetUserId,
      });
      augmentation = {
        dueReviewCount: 0,
        attemptedQuizToday: false,
        inProgressLessons: [],
        completedLessons: [],
        pendingTeacherRemediation: null,
      };
    }

    // Chapter titles — parallel round-trip, empty map on failure (graceful degradation).
    let chapterTitles: ChapterTitleMap = new Map();
    if (masteryPairs.length > 0) {
      try {
        const { data, error } = await stateClient.rpc('get_chapter_titles_for_pairs', {
          p_pairs: masteryPairs,
        }) as { data: Array<{ subject_code: string; chapter_number: number; title: string; title_hi: string | null }> | null; error: unknown };
        if (!error && data) {
          for (const row of data) {
            chapterTitles.set(`${row.subject_code}|${row.chapter_number}`, {
              title: row.title,
              titleHi: row.title_hi,
            });
          }
        }
      } catch {
        // Graceful degradation: queue renders without chapter titles.
      }
    }

    // 5. Resolve the Today queue — all "what next" logic stays here.
    const now = new Date();
    const result = resolveTodayQueue(state, augmentation, { now });

    // STATUS FLIP — surfacing the assigned task moves it `assigned → in_progress`
    // (assessment rule 4). Fire-and-forget service-role write keyed by the
    // assignment id; never blocks the response, never throws. Only flips when an
    // `assigned` row was actually surfaced (no churn for already in_progress).
    // SELF-ONLY: the view-as lens is read-only and must never write learner state.
    const surfaced = augmentation.pendingTeacherRemediation;
    if (isSelf && surfaced && surfaced.status === 'assigned') {
      void markTeacherRemediationInProgress(admin, surfaced.assignmentId).catch(() => {
        /* best-effort; the next /today read re-attempts. */
      });
    }

    // 6. Project primary + queue into render DTOs (1-based rank).
    const queue = result.queue.map((action, i) => mapActionToTodayItem(action, i + 1, chapterTitles));
    const primary = queue[0] ?? mapActionToTodayItem(result.primary, 1, chapterTitles);

    // 7. Assemble the envelope.
    const payload: TodayResponse = {
      schemaVersion: 1,
      resolvedAt: now.toISOString(),
      primary,
      queue,
      meta: {
        branch: result.branch,
        masterySubjectCount: state.mastery.length,
        dueReviewCount: augmentation.dueReviewCount,
        practicedToday: augmentation.attemptedQuizToday,
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
});
