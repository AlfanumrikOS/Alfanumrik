/**
 * GET /api/v2/parent/glance?student_id=<uuid> — at-a-glance view for one linked
 * child (mobile parent screen parity; mirrors the web ParentGlanceHome).
 *
 * Thin read. Reuses the EXISTING parent glance data flow with no new
 * aggregation: it calls the `parent-portal` Edge Function `get_child_dashboard`
 * action — the SAME payload ParentGlanceHome consumes — and shapes the result
 * into Snapshot + Moments + weeklyActivity. The Edge Function owns ALL the
 * aggregation (IST-bucketed daily activity, accuracy, BKT mastery, insights).
 *
 * Auth/ownership (mirrors /api/v2/parent/encourage + /api/parent/report exactly):
 *   authorizeRequest(request, 'child.view_progress')              → RBAC gate (P9).
 *   getGuardianByAuthUserId(auth.userId)                          → 403 if none.
 *   isGuardianLinkedToStudent(guardian.id, student_id)            → 403 if not linked.
 * The Edge Function re-runs its own JWT-bound guardian + link check as
 * defense-in-depth (the caller's Bearer JWT is forwarded), so the boundary is
 * enforced twice.
 *
 * P5: grade is a string. P13: only the parent-entitled child data (name/grade +
 * the child's own learning stats) crosses the wire; no raw error text leaks.
 */
import { NextRequest } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { getGuardianByAuthUserId } from '@/lib/domains/identity';
import { isGuardianLinkedToStudent } from '@/lib/domains/relationship';
import { isValidUUID } from '@/lib/sanitize';
import { logger } from '@/lib/logger';
import { v2Success, v2Error } from '@/lib/api/v2/envelope';

/** Edge Function dashboard payload — only the fields we read (matches index.ts). */
interface DashboardPayload {
  error?: string;
  name?: string | null;
  grade?: string | number | null;
  student?: { name?: string | null; grade?: string | number | null };
  stats?: {
    xp?: number;
    streak?: number;
    accuracy?: number;
    totalQuizzes?: number;
    minutes?: number;
    totalChats?: number;
    avgScore?: number;
  };
  dailyActivity?: Array<{ label?: string; active?: boolean; quizzes?: number }>;
  weekSummary?: { quizzes?: number; avgScore?: number; activeDays?: number };
  bktMastery?: { levels?: Record<string, number>; total?: number };
  insights?: string[];
}

export async function GET(request: NextRequest) {
  try {
    // ── 1. AuthZ (RBAC permission gate, P9) ──
    const auth = await authorizeRequest(request, 'child.view_progress');
    if (!auth.authorized) return auth.errorResponse!;

    // ── 2. Validate student_id (must be a UUID). ──
    const studentId = new URL(request.url).searchParams.get('student_id');
    if (!studentId || !isValidUUID(studentId)) {
      return v2Error('Valid student_id is required', 400, 'VALIDATION_ERROR');
    }

    // ── 3. Resolve guardian (same helper as encourage + report). ──
    const guardianResult = await getGuardianByAuthUserId(auth.userId!);
    if (!guardianResult.ok || !guardianResult.data) {
      return v2Error('No parent profile found', 403, 'NO_GUARDIAN_PROFILE');
    }
    const guardian = guardianResult.data;

    // ── 4. Verify parent ↔ student link (P13). ──
    const linkCheck = await isGuardianLinkedToStudent(guardian.id, studentId);
    if (!linkCheck.ok) {
      logger.error('v2_parent_glance_link_check_failed', {
        route: '/api/v2/parent/glance',
        guardianId: guardian.id,
        studentId,
      });
      return v2Error('Internal server error', 500, 'INTERNAL_ERROR');
    }
    if (!linkCheck.data) {
      return v2Error('You are not linked to this student', 403, 'NOT_LINKED');
    }

    // ── 5. Reuse the parent-portal Edge Function `get_child_dashboard` action —
    //       the SAME payload the web ParentGlanceHome consumes. One round-trip;
    //       no aggregation logic duplicated here. The caller's Bearer JWT is
    //       forwarded so the Edge Function's own P13 guardian+link guard runs. ──
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      logger.error('v2_parent_glance_config_missing', { route: '/api/v2/parent/glance' });
      return v2Error('Server configuration error', 500, 'INTERNAL_ERROR');
    }

    // The Edge Function binds the caller to the JWT in the Authorization header.
    const bearer = request.headers.get('Authorization');
    let dash: DashboardPayload;
    try {
      const efResponse = await fetch(`${supabaseUrl}/functions/v1/parent-portal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: bearer ?? `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify({
          action: 'get_child_dashboard',
          student_id: studentId,
          guardian_id: guardian.id,
        }),
      });

      if (!efResponse.ok) {
        // 403/404 from the Edge Function map straight through; everything else 502.
        if (efResponse.status === 403) {
          return v2Error('You are not linked to this student', 403, 'NOT_LINKED');
        }
        if (efResponse.status === 404) {
          return v2Error('No data available for this child', 404, 'NO_DATA');
        }
        logger.error('v2_parent_glance_edge_failed', {
          route: '/api/v2/parent/glance',
          guardianId: guardian.id,
          studentId,
          status: efResponse.status,
        });
        return v2Error('Could not load child data. Please try again later.', 502, 'UPSTREAM_ERROR');
      }

      dash = (await efResponse.json()) as DashboardPayload;
    } catch (efErr) {
      logger.error('v2_parent_glance_edge_unreachable', {
        error: efErr instanceof Error ? efErr : new Error(String(efErr)),
        route: '/api/v2/parent/glance',
      });
      return v2Error('Could not load child data. Please try again later.', 502, 'UPSTREAM_ERROR');
    }

    if (dash.error) {
      return v2Error('No data available for this child', 404, 'NO_DATA');
    }

    // ── 6. Shape into Snapshot + Moments + weeklyActivity from the Edge Function
    //       payload. Same derivations the web ParentGlanceHome uses; no new math. ──
    const stats = dash.stats ?? {};
    const week = dash.weekSummary ?? {};
    const childName = dash.student?.name ?? dash.name ?? null;
    const rawGrade = dash.student?.grade ?? dash.grade ?? null;

    const snapshot = {
      sessions_this_week: Number(week.quizzes) || 0,
      streak_days: Number(stats.streak) || 0,
      accuracy: typeof stats.accuracy === 'number' ? stats.accuracy : null,
      avg_score: typeof week.avgScore === 'number' ? week.avgScore : null,
      time_minutes: typeof stats.minutes === 'number' ? stats.minutes : null,
      xp: typeof stats.xp === 'number' ? stats.xp : null,
      total_quizzes: typeof stats.totalQuizzes === 'number' ? stats.totalQuizzes : null,
      total_chats: typeof stats.totalChats === 'number' ? stats.totalChats : null,
    };

    // Highlights / concerns derived from the SAME existing fields the web
    // ParentGlanceHome derives moments from (weekSummary / streak / bktMastery /
    // insights). English source lines; the client renders bilingually (P7).
    const highlights: string[] = [];
    const concerns: string[] = [];

    if ((Number(week.quizzes) || 0) > 0) {
      const n = Number(week.quizzes);
      highlights.push(`Completed ${n} quiz${n > 1 ? 'zes' : ''} this week.`);
    }
    if ((Number(stats.streak) || 0) >= 3) {
      highlights.push(`On a ${Number(stats.streak)}-day learning streak.`);
    }
    const mastered = Number(dash.bktMastery?.levels?.mastered) || 0;
    if (mastered > 0) {
      highlights.push(`Mastered ${mastered} concept${mastered > 1 ? 's' : ''} so far.`);
    }
    if ((Number(stats.totalChats) || 0) > 0) {
      const n = Number(stats.totalChats);
      highlights.push(`Asked Foxy ${n} question${n > 1 ? 's' : ''}.`);
    }

    if ((Number(stats.streak) || 0) === 0) {
      concerns.push('No active streak right now — a short session would restart it.');
    }
    if (typeof stats.accuracy === 'number' && stats.accuracy > 0 && stats.accuracy < 50) {
      concerns.push(`Accuracy is at ${stats.accuracy}%. More practice on weak topics could help.`);
    }
    if ((Number(week.quizzes) || 0) === 0) {
      concerns.push('No sessions yet this week.');
    }

    // A single suggestion line, lifted from the Edge Function's own insights when
    // present (read-only — no new text generated here).
    const suggestion =
      Array.isArray(dash.insights) && dash.insights.length > 0 ? dash.insights[0] : null;

    const weeklyActivity = Array.isArray(dash.dailyActivity)
      ? dash.dailyActivity.map((d) => ({
          label: String(d.label ?? ''),
          active: Boolean(d.active),
          quizzes: Number(d.quizzes) || 0,
        }))
      : undefined;

    return v2Success(
      {
        schemaVersion: 1 as const,
        child: {
          student_id: studentId,
          name: childName,
          // P5: grade is a string.
          grade: rawGrade == null ? null : String(rawGrade),
        },
        snapshot,
        moments: { highlights, concerns, suggestion },
        ...(weeklyActivity ? { weeklyActivity } : {}),
      },
      { headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' } },
    );
  } catch (err) {
    logger.error('v2_parent_glance_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/v2/parent/glance',
    });
    return v2Error('Internal server error', 500, 'INTERNAL_ERROR');
  }
}
