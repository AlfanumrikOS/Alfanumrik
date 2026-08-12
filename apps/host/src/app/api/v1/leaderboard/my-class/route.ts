/**
 * GET /api/v1/leaderboard/my-class?period=weekly&limit=20
 *
 * The caller's OWN class leaderboard, with class membership resolved
 * SERVER-SIDE from `class_students`.
 *
 * ── WHY THIS ROUTE EXISTS ────────────────────────────────────────────────────
 * The "My Class" tab resolved the class id as `(student as any).class_id`.
 * **`students.class_id` does not exist.** It is not in the baseline schema —
 * see `supabase/migrations/20260504200100_stem_lab_badges.sql:499`:
 *   "NOTE: students has NO class_id column (verified against baseline schema)."
 * `AuthContext` does `select('*')`, so the field never arrived, `classId` was
 * always `null`, and every enrolled student was told "You're not in a class
 * yet." The phantom field was also declared on the `Student` TS interface,
 * which is why the bug type-checked; that declaration has been removed.
 *
 * Class membership actually lives in `class_students` (baseline `:10368`), so
 * this route resolves it there and returns the board in ONE round trip — no
 * client-side class-id juggling, nothing for the browser to get wrong.
 *
 * The pre-existing `/api/v1/leaderboard/class/[classId]` route is UNCHANGED
 * (it serves teachers and any caller that already knows a class id). This is a
 * caller-scoped convenience wrapper over the same `get_class_leaderboard` RPC
 * and the same field whitelist.
 *
 * ── ENROLLED vs FAILED vs EMPTY ─────────────────────────────────────────────
 * The three are distinguishable, deliberately:
 *   `enrolled: false, class_id: null, items: []` → genuinely not in a class.
 *   `enrolled: true,  items: []`                 → in a class, nobody has XP yet.
 *   HTTP 5xx                                     → the read failed; the client
 *                                                  must NOT render an empty state.
 *
 * Gating: `ff_class_leaderboard_v1` — 404 when OFF, matching
 *         `/api/v1/leaderboard/class/[classId]`. The flag default is NOT
 *         changed here; ramping it is an operator decision.
 *
 * Auth: `leaderboard.view`.
 *
 * Client: the RLS-SCOPED request client (`createSupabaseRouteClient`), NOT the
 *   service-role client — deliberately, so RLS is a real second line of defense
 *   behind `authorizeRequest` (P8, XC-3 §5b: new routes default to the scoped
 *   client and the admin-client blast radius only ratchets down).
 *     - `class_students` : "Students can view own enrollment" (student_id ∈
 *       students WHERE auth_user_id = auth.uid()) — so the enrolment lookup can
 *       only ever return the CALLER'S OWN class, whatever the code does.
 *     - `get_class_leaderboard` : SECURITY DEFINER with EXECUTE granted to
 *       `authenticated` (migration `20260624110000`), which is exactly how it
 *       reads peer rows without the caller holding service-role.
 *   Fail-CLOSED: an RLS deny on the enrolment read yields no row → `enrolled:
 *   false`, never another class's board.
 *
 * Cache: `private, max-age=60` — the response depends on WHICH class the caller
 *        is in, so it must never be a shared CDN entry.
 *
 * P13: email, phone, auth_user_id are NOT included. The item whitelist matches
 *      `/api/v1/leaderboard/class/[classId]` exactly.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseRouteClient } from '@alfanumrik/lib/supabase-route';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { isFeatureEnabled } from '@alfanumrik/lib/feature-flags';
import { logger } from '@alfanumrik/lib/logger';

const ROUTE = '/api/v1/leaderboard/my-class';
const FLAG_NAME = 'ff_class_leaderboard_v1';
const VALID_PERIODS = ['daily', 'weekly', 'monthly'] as const;
type Period = (typeof VALID_PERIODS)[number];

interface ClassLeaderItem {
  rank: number;
  student_id: string;
  name: string | null;
  grade: string | null;
  avatar_url: string | null;
  xp_total: number;
  xp_this_period: number;
  quizzes: number;
}

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'leaderboard.view');
  if (!auth.authorized) return auth.errorResponse!;

  const flagOn = await isFeatureEnabled(FLAG_NAME, {
    userId: auth.userId ?? undefined,
    role: auth.roles[0] ?? 'student',
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  });
  if (!flagOn) {
    return NextResponse.json({ success: false, error: 'not_found' }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const rawPeriod = searchParams.get('period') || 'weekly';
  const period: Period = VALID_PERIODS.includes(rawPeriod as Period)
    ? (rawPeriod as Period)
    : 'weekly';
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '20', 10) || 20, 1), 50);

  // Identity from the SESSION only — a `?student_id` param is ignored (P13).
  const studentId = auth.studentId ?? null;

  const notEnrolled = () =>
    NextResponse.json(
      {
        success: true,
        data: {
          schemaVersion: 1,
          period,
          enrolled: false,
          class_id: null,
          resolvedAt: new Date().toISOString(),
          items: [] as ClassLeaderItem[],
        },
      },
      { status: 200, headers: { 'Cache-Control': 'private, max-age=60' } },
    );

  if (!studentId) return notEnrolled();

  const supabase = await createSupabaseRouteClient(request);

  try {
    // ── Resolve class membership from class_students (NOT students.class_id) ──
    // A student can in principle hold more than one active enrolment row; take
    // the most recent one deterministically rather than erroring.
    const { data: enrolment, error: enrolErr } = await supabase
      .from('class_students')
      .select('class_id, joined_at')
      .eq('student_id', studentId)
      .eq('is_active', true)
      .order('joined_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (enrolErr) {
      logger.error('my_class_leaderboard_enrolment_failed', {
        route: ROUTE,
        error: new Error(enrolErr.message),
      });
      return NextResponse.json({ success: false, error: 'internal' }, { status: 500 });
    }

    const classId = (enrolment?.class_id as string | undefined) ?? null;
    if (!classId) return notEnrolled();

    const { data, error } = await supabase.rpc('get_class_leaderboard', {
      p_class_id: classId,
      p_period: period,
      p_limit: limit,
    });

    if (error) {
      logger.error('my_class_leaderboard_rpc_failed', {
        route: ROUTE,
        error: new Error(error.message),
      });
      return NextResponse.json({ success: false, error: 'internal' }, { status: 500 });
    }

    // P13: whitelist identical to /api/v1/leaderboard/class/[classId].
    const items: ClassLeaderItem[] = (Array.isArray(data) ? data : []).map(
      (row: Record<string, unknown>, i: number) => ({
        rank: Number(row.rank ?? i + 1),
        student_id: String(row.student_id ?? ''),
        name: (row.name as string | null) ?? null,
        // P5: grades are strings.
        grade: row.grade == null ? null : String(row.grade),
        avatar_url: (row.avatar_url as string | null) ?? null,
        xp_total: Number(row.xp_total ?? 0),
        xp_this_period: Number(row.xp_this_period ?? 0),
        quizzes: Number(row.quizzes ?? 0),
      }),
    );

    return NextResponse.json(
      {
        success: true,
        data: {
          schemaVersion: 1,
          period,
          enrolled: true,
          class_id: classId,
          resolvedAt: new Date().toISOString(),
          items,
        },
      },
      { status: 200, headers: { 'Cache-Control': 'private, max-age=60' } },
    );
  } catch (err) {
    logger.error('my_class_leaderboard_failed', {
      route: ROUTE,
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return NextResponse.json({ success: false, error: 'internal' }, { status: 500 });
  }
}
