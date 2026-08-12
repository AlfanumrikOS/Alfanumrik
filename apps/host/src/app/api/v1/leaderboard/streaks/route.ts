/**
 * GET /api/v1/leaderboard/streaks?limit=50
 *
 * Daily-challenge streak leaderboard.
 *
 * ── WHY THIS ROUTE EXISTS ────────────────────────────────────────────────────
 * The leaderboard page used to read `challenge_streaks` cross-student FROM THE
 * BROWSER with a `students!inner(...)` join. Both tables are own-row-only under
 * RLS (`challenge_streaks_student_select`, `students_select_merged`), so the
 * anon-key read could return AT MOST ONE ROW — the caller's — and the UI
 * rendered that single row as a "Top Streaks" board.
 *
 * The fix is NOT to loosen RLS (that would breach P8/P13). It is this route:
 * service-role read + explicit server-side filtering + an explicit field
 * whitelist.
 *
 * ── P13 PEER FIELD WHITELIST (justification) ─────────────────────────────────
 * The accepted peer-visible norm on this surface is `get_leaderboard`'s own
 * output: `student_id, name, grade, total_xp, sessions, streak, rank`. Peers on
 * THIS board therefore get:
 *
 *   rank            — position only, derived.
 *   student_id      — already the join key on every leaderboard surface; the
 *                     client needs it to highlight the caller's own row.
 *   name            — display name. Explicitly in the norm (get_leaderboard
 *                     emits `name`), so peer display names are an accepted
 *                     product decision on leaderboards.
 *   grade           — in the norm. P5: emitted as a STRING.
 *   current_streak  — in the norm (`get_leaderboard.streak`). An effort /
 *                     activity counter, not an attainment measure.
 *   badges          — DERIVED, not disclosed: filtered to milestone badges whose
 *                     day threshold is already <= the peer's exposed
 *                     `current_streak`. Every surviving badge is recomputable by
 *                     the client from `current_streak` alone, so this adds ZERO
 *                     incremental disclosure. Unknown/unmatched badge ids are
 *                     dropped (fail closed).
 *
 * Deliberately NOT exposed for peers:
 *   best_streak     — a peer's HISTORICAL maximum is outside the norm and
 *                     supports inference about their past engagement decline.
 *                     Own row only.
 *   avatar_url      — not in the `get_leaderboard` norm. The UI renders
 *                     initials-based avatars from `name`, so nothing is lost.
 *   school / city / board — institution + location of a minor. Never.
 *   last_challenge_date, mercy_days_used_week, mercy_week_start — behavioural
 *                     internals (exactly when a child studies, and how many
 *                     "misses" they were forgiven). Never leaves the server.
 *   email / phone / auth_user_id — never.
 *
 * ── VISIBILITY THRESHOLD ─────────────────────────────────────────────────────
 * Mirrors the `HAVING SUM(xp_earned) > 0` discipline of `get_leaderboard`:
 * a student appears only at `current_streak >= STREAK_VISIBILITY_THRESHOLD`
 * (3) and only while `students.is_active = true`. A student below the
 * threshold is absent from the board — so the caller's own streak is returned
 * separately in `me`, which is own-data and always present.
 *
 * Auth: `leaderboard.view` (same code as every sibling /api/v1/leaderboard/*).
 * Cache: `private, max-age=60` — the response contains a caller-specific `me`
 *        block, so it must NEVER be `public` CDN-cached.
 *
 * Response (200):
 *   { success: true,
 *     data: {
 *       schemaVersion: 1,
 *       resolvedAt: ISO,
 *       threshold: 3,
 *       items: Array<{ rank, student_id, name, grade, current_streak, badges }>,
 *       me: { student_id, current_streak, best_streak, badges, rank, on_board }
 *            | null
 *     } }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { logger } from '@alfanumrik/lib/logger';
import {
  STREAK_MILESTONES,
  STREAK_VISIBILITY_THRESHOLD,
} from '@alfanumrik/lib/challenge-config';

const ROUTE = '/api/v1/leaderboard/streaks';

/** Bound the service-role read. 200 rows is >> any top-50 board. */
const MAX_SCAN = 200;

interface StreakRow {
  student_id: string;
  current_streak: number;
  best_streak: number;
  badges: unknown;
}

interface PeerStreakItem {
  rank: number;
  student_id: string;
  name: string | null;
  grade: string | null;
  current_streak: number;
  badges: string[];
}

/** badgeId -> milestone day threshold. */
const BADGE_DAYS = new Map(STREAK_MILESTONES.map((m) => [m.badgeId, m.days]));

function asBadgeArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((b): b is string => typeof b === 'string');
}

/**
 * Peer badge projection. Keeps only badges already implied by the peer's
 * publicly-visible `current_streak`, so the client learns nothing it could not
 * compute itself. Unknown badge ids are dropped (fail closed).
 */
function peerBadges(badges: string[], currentStreak: number): string[] {
  return badges.filter((b) => {
    const days = BADGE_DAYS.get(b);
    return days !== undefined && days <= currentStreak;
  });
}

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'leaderboard.view');
  if (!auth.authorized) return auth.errorResponse!;

  const { searchParams } = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 50);

  // The caller's own students.id comes from the SESSION only. A `?student_id`
  // query param is ignored even when present (P13).
  const callerStudentId = auth.studentId ?? null;

  const admin = getSupabaseAdmin();

  try {
    // 1. Streak rows above the visibility threshold, best first.
    const { data: streakRaw, error: streakErr } = await admin
      .from('challenge_streaks')
      .select('student_id, current_streak, best_streak, badges')
      .gte('current_streak', STREAK_VISIBILITY_THRESHOLD)
      .order('current_streak', { ascending: false })
      .limit(MAX_SCAN);

    if (streakErr) {
      logger.error('leaderboard_streaks_read_failed', {
        route: ROUTE,
        error: new Error(streakErr.message),
      });
      return NextResponse.json({ success: false, error: 'streaks_read_failed' }, { status: 500 });
    }

    const streakRows = (streakRaw ?? []) as StreakRow[];

    // 2. Student meta for exactly those ids — never a full-table read.
    let items: PeerStreakItem[] = [];
    if (streakRows.length > 0) {
      const ids = streakRows.map((r) => r.student_id).filter(Boolean);
      const { data: studentsRaw, error: studentsErr } = await admin
        .from('students')
        .select('id, name, grade')
        .eq('is_active', true)
        .is('deleted_at', null)
        .in('id', ids);

      if (studentsErr) {
        logger.error('leaderboard_streaks_students_read_failed', {
          route: ROUTE,
          error: new Error(studentsErr.message),
        });
        return NextResponse.json({ success: false, error: 'streaks_read_failed' }, { status: 500 });
      }

      const meta = new Map<string, { name: string | null; grade: string | null }>();
      for (const s of (studentsRaw ?? []) as Array<Record<string, unknown>>) {
        meta.set(String(s.id), {
          name: (s.name as string | null) ?? null,
          // P5: grades are strings.
          grade: s.grade == null ? null : String(s.grade),
        });
      }

      items = streakRows
        .filter((r) => meta.has(r.student_id)) // drops inactive / deleted students
        .slice(0, limit)
        .map((r, i) => {
          const m = meta.get(r.student_id)!;
          const current = Number(r.current_streak) || 0;
          return {
            rank: i + 1,
            student_id: r.student_id,
            name: m.name,
            grade: m.grade,
            current_streak: current,
            badges: peerBadges(asBadgeArray(r.badges), current),
          };
        });
    }

    // 3. The caller's OWN row — full fidelity, own data, present even when the
    //    caller is below the visibility threshold or off the top-N board.
    let me: {
      student_id: string;
      current_streak: number;
      best_streak: number;
      badges: string[];
      rank: number | null;
      on_board: boolean;
    } | null = null;

    if (callerStudentId) {
      const { data: mineRaw } = await admin
        .from('challenge_streaks')
        .select('student_id, current_streak, best_streak, badges')
        .eq('student_id', callerStudentId)
        .maybeSingle();

      const mine = (mineRaw ?? null) as StreakRow | null;
      const boardIndex = items.findIndex((i) => i.student_id === callerStudentId);
      me = {
        student_id: callerStudentId,
        current_streak: Number(mine?.current_streak) || 0,
        best_streak: Number(mine?.best_streak) || 0,
        badges: asBadgeArray(mine?.badges),
        rank: boardIndex >= 0 ? items[boardIndex].rank : null,
        on_board: boardIndex >= 0,
      };
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          schemaVersion: 1,
          resolvedAt: new Date().toISOString(),
          threshold: STREAK_VISIBILITY_THRESHOLD,
          items,
          me,
        },
      },
      {
        status: 200,
        // Caller-specific (`me`) — private only, never a shared CDN entry.
        headers: { 'Cache-Control': 'private, max-age=60' },
      },
    );
  } catch (err) {
    logger.error('leaderboard_streaks_failed', {
      route: ROUTE,
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return NextResponse.json({ success: false, error: 'internal' }, { status: 500 });
  }
}
