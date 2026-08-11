/**
 * GET /api/v1/leaderboard/titles
 *
 * The CALLER'S OWN earned titles. Own-data only — no peer titles, ever.
 *
 * ── WHY THIS ROUTE EXISTS ────────────────────────────────────────────────────
 * The "My Titles" tab read `student_titles` from the browser with the anon-key
 * client. `student_titles` has RLS enabled with EXACTLY ONE policy —
 * "Service role full access on student_titles" (service_role only). There is no
 * student SELECT policy at all, so an anon-key read returns 0 rows for every
 * student, always. The tab was permanently empty and told the student
 * "No Titles Yet" even when they had titles.
 *
 * This is genuinely own-data; it failed only because the table is
 * service-role-only. The fix is a service-role read scoped SERVER-SIDE to the
 * caller's own `students.id` — NOT an RLS change (P8: no policy is weakened).
 *
 * ── IDENTITY ────────────────────────────────────────────────────────────────
 * The student id comes from the SESSION (`auth.studentId`). A `?student_id`
 * query param is IGNORED even when present — P13: never trust a client-supplied
 * identity on an "own" endpoint. Without a resolved student id the route
 * returns an empty list, never another student's rows.
 *
 * ── P13 FIELD WHITELIST ─────────────────────────────────────────────────────
 * id, title, title_hi, icon, tier, source, earned_at.
 * `source_id` (the internal competition/achievement FK) and `student_id` are
 * deliberately omitted — the caller already knows who they are and has no use
 * for the internal join key.
 *
 * Auth: `progress.view_own` — the established own-data read permission.
 * Cache: `private, max-age=60` (caller-specific; never `public`).
 *
 * Response (200):
 *   { success: true,
 *     data: { schemaVersion: 1, resolvedAt: ISO,
 *             titles: Array<{ id, title, title_hi, icon, tier, source, earned_at }> } }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { logger } from '@alfanumrik/lib/logger';

const ROUTE = '/api/v1/leaderboard/titles';
const MAX_TITLES = 50;

interface TitleItem {
  id: string;
  title: string;
  title_hi: string | null;
  icon: string | null;
  tier: string | null;
  source: string | null;
  earned_at: string | null;
}

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'progress.view_own');
  if (!auth.authorized) return auth.errorResponse!;

  const studentId = auth.studentId ?? null;

  const empty = (status = 200) =>
    NextResponse.json(
      {
        success: true,
        data: { schemaVersion: 1, resolvedAt: new Date().toISOString(), titles: [] as TitleItem[] },
      },
      { status, headers: { 'Cache-Control': 'private, max-age=60' } },
    );

  // A caller with a role but no student row (teacher/parent/admin hitting the
  // student surface) simply has no titles. Not an error, not a 404.
  if (!studentId) return empty();

  try {
    const { data, error } = await getSupabaseAdmin()
      .from('student_titles')
      .select('id, title, title_hi, icon, tier, source, earned_at')
      .eq('student_id', studentId) // server-side scoping — the ONLY filter that matters
      .eq('is_active', true)
      .order('earned_at', { ascending: false })
      .limit(MAX_TITLES);

    if (error) {
      // A failed read must NOT arrive at the client as an empty list — the UI
      // would render "No Titles Yet", which is a claim, not an omission.
      logger.error('leaderboard_titles_read_failed', {
        route: ROUTE,
        error: new Error(error.message),
      });
      return NextResponse.json(
        { success: false, error: 'titles_read_failed' },
        { status: 500 },
      );
    }

    const titles: TitleItem[] = (data ?? []).map((t: Record<string, unknown>) => ({
      id: String(t.id),
      title: String(t.title ?? ''),
      title_hi: (t.title_hi as string | null) ?? null,
      icon: (t.icon as string | null) ?? null,
      tier: (t.tier as string | null) ?? null,
      source: (t.source as string | null) ?? null,
      earned_at: (t.earned_at as string | null) ?? null,
    }));

    return NextResponse.json(
      {
        success: true,
        data: { schemaVersion: 1, resolvedAt: new Date().toISOString(), titles },
      },
      { status: 200, headers: { 'Cache-Control': 'private, max-age=60' } },
    );
  } catch (err) {
    logger.error('leaderboard_titles_failed', {
      route: ROUTE,
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return NextResponse.json({ success: false, error: 'internal' }, { status: 500 });
  }
}
