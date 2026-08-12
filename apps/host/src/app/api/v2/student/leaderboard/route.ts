/**
 * GET /api/v2/student/leaderboard — XP leaderboard (mobile + web).
 *
 * Thin read. Reuses the SAME get_leaderboard RPC the web /leaderboard page uses
 * (via getLeaderboard in src/lib/domains/profile.ts → supabase.rpc('get_leaderboard')).
 * The RPC's period switch maps weekly/monthly/all (its ELSE branch = all-time),
 * so we forward the period verbatim — no new query logic.
 *
 * P13: the response carries ONLY the fields the existing leaderboard exposes
 * (rank, name, grade, total_xp, streak) — no emails/phones.
 *
 * Auth: progress.view_own (a student-scoped read permission).
 *
 * ── CONTRACT CORRECTIONS (2026-08) ──────────────────────────────────────────
 * 1. `scope=school` is now REJECTED with HTTP 400 `SCOPE_UNSUPPORTED`.
 *    It used to be accepted and echoed back in the response while
 *    `get_leaderboard(p_period, p_limit)` has no scope parameter at all — so
 *    `scope=school` silently returned GLOBAL data labelled "school". Real
 *    school scoping needs a school-aware RPC (a schema change, architect's
 *    domain); until that exists the endpoint refuses the param rather than
 *    lying about it. `scope` is still echoed, and is always `'global'`.
 *    Mobile has never sent `scope` (`leaderboard_provider.dart` sends only
 *    `period`), so no shipped client is affected.
 *
 * 2. `school`, `city`, `avatar_url` are retained as response KEYS for
 *    backwards compatibility with the generated mobile client, but they are
 *    permanently `null`: `get_leaderboard` does not emit them, and enriching
 *    them from `students` would put a minor's institution and city on a peer
 *    leaderboard, which is outside the accepted peer-visible norm (P13).
 *    They are null by decision, not by accident.
 *
 * 3. `me` (new, additive) reports the caller's own standing. `get_leaderboard`
 *    filters `HAVING SUM(xp_earned) > 0`, so a zero-XP student is absent from
 *    their OWN leaderboard and previously had no way to tell "I'm not in the
 *    top 50" from "the board is broken". `me.on_board = false` /
 *    `me.rank = null` now says so explicitly. Derived purely from the rows
 *    already returned — no extra query.
 */
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { createSupabaseRouteClient } from '@alfanumrik/lib/supabase-route';
import { logger } from '@alfanumrik/lib/logger';
import { v2Success, v2Error } from '@alfanumrik/lib/api/v2/envelope';
import { withRoute } from '@alfanumrik/lib/api/v2/with-route';

const LIMIT = 50;

/**
 * What `get_leaderboard` actually emits (baseline `:4639`):
 *   student_id, name, grade, total_xp, sessions, streak, rank
 * Nothing else. `school` / `city` / `avatar_url` are NOT in the RPC output and
 * are therefore not modelled here — the response emits them as literal nulls.
 */
interface RpcLeaderboardRow {
  rank?: number;
  student_id?: string;
  name?: string | null;
  total_xp?: number;
  streak?: number;
  grade?: string | number | null;
}

export const GET = withRoute(async (request: NextRequest) => {
  try {
    const auth = await authorizeRequest(request, 'progress.view_own');
    if (!auth.authorized) return auth.errorResponse as unknown as NextResponse;

    const url = new URL(request.url);
    const periodParam = url.searchParams.get('period') ?? 'weekly';
    const scopeParam = url.searchParams.get('scope');

    const period = (['weekly', 'monthly', 'all'] as const).includes(periodParam as never)
      ? (periodParam as 'weekly' | 'monthly' | 'all')
      : 'weekly';

    // `get_leaderboard` takes only (p_period, p_limit). There is no school
    // scoping to forward, so accepting `scope=school` and echoing it back was a
    // lie: the caller got GLOBAL rows labelled "school". Refuse instead.
    if (scopeParam != null && scopeParam !== 'global') {
      return v2Error(
        'scope=school is not supported by this endpoint; only scope=global is served',
        400,
        'SCOPE_UNSUPPORTED',
      );
    }
    const scope = 'global' as const;

    // Same RPC as the web leaderboard. Forward the period verbatim.
    //
    // Bearer-aware client (same swap as the quiz submit/start routes). This was
    // the cookie-only client, so mobile callers reached `get_leaderboard` as
    // role `anon` and only succeeded because of a residual PUBLIC EXECUTE grant
    // — the `REVOKE EXECUTE ... FROM anon` in migration 20260515000002 is a
    // silent no-op while PUBLIC still grants it. The anon-revocation campaign
    // (cf. 20260813000006's `REVOKE ALL ... FROM PUBLIC`) removes that and the
    // mobile leaderboard would break. Web/cookie callers are unaffected:
    // `createSupabaseRouteClient` delegates verbatim to
    // `createSupabaseServerClient()` when there is no Bearer header.
    const supabase = await createSupabaseRouteClient(request);
    const { data, error } = await supabase.rpc('get_leaderboard', {
      p_period: period,
      p_limit: LIMIT,
    });

    if (error) {
      logger.warn('v2_student_leaderboard_rpc_failed', { error: error.message, period });
      return v2Error('Failed to load leaderboard', 500, 'INTERNAL_ERROR');
    }

    const rows: RpcLeaderboardRow[] = Array.isArray(data) ? data : [];
    const entries = rows.map((s, i) => ({
      rank: typeof s.rank === 'number' ? s.rank : i + 1,
      student_id: s.student_id ?? '',
      name: s.name ?? null,
      total_xp: s.total_xp ?? 0,
      streak: s.streak ?? 0,
      // Permanently null — see contract note (2) in the header. get_leaderboard
      // emits none of these, and enriching them would put a minor's institution
      // and city on a peer board (P13). Retained as keys for mobile client
      // compatibility only.
      avatar_url: null as string | null,
      grade: s.grade == null ? null : String(s.grade),
      school: null as string | null,
      city: null as string | null,
    }));

    // Caller's own standing, derived from the rows we already have. Absence
    // from the board is a real answer (the RPC's HAVING SUM(xp_earned) > 0
    // excludes zero-XP students from their own leaderboard), not a failure.
    const callerStudentId = auth.studentId ?? null;
    const own = callerStudentId
      ? entries.find((e) => e.student_id === callerStudentId)
      : undefined;
    const me = {
      student_id: callerStudentId,
      on_board: !!own,
      rank: own?.rank ?? null,
      total_xp: own?.total_xp ?? null,
    };

    return v2Success({
      schemaVersion: 1 as const,
      period,
      scope,
      entries,
      me,
    });
  } catch (err) {
    logger.error('v2_student_leaderboard_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/v2/student/leaderboard',
    });
    return v2Error('Internal server error', 500, 'INTERNAL_ERROR');
  }
});
