/**
 * Pedagogy v2 — Wave 2 Task 6
 * GET /api/dive/history?limit=N
 *
 * Returns the authenticated student's past weekly dive artifacts in
 * reverse-chronological order. Wave 3 (Monthly Synthesis) will join this
 * data into a monthly bundle; for now this surface is just for the
 * student's own /dive/history page.
 *
 * Server-gated by ff_pedagogy_v2_weekly_dive — when off, returns 404 so
 * the surface is fully hidden.
 *
 * RLS on `dive_artifacts` (Wave 2 Task 1 migration) restricts SELECT to
 * the row's own student. The route uses the user-bound supabase client
 * so policies enforce authorization; no service-role bypass needed.
 */
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';
import { isFeatureEnabled, PEDAGOGY_V2_FLAGS } from '@alfanumrik/lib/feature-flags';
import { logger } from '@alfanumrik/lib/logger';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 60;

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();

  const { data: userResult, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResult?.user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const userId = userResult.user.id;

  const flagOn = await isFeatureEnabled(PEDAGOGY_V2_FLAGS.WEEKLY_DIVE, {
    userId,
    role: 'student',
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  });
  if (!flagOn) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { searchParams } = new URL(request.url);
  const rawLimit = parseInt(searchParams.get('limit') ?? '', 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 && rawLimit <= MAX_LIMIT
    ? rawLimit
    : DEFAULT_LIMIT;

  // Resolve the surrogate students.id (random uuid; distinct from the auth
  // uid). dive_artifacts.student_id references this surrogate — keying the
  // read on the auth uid would always miss. Same resolution pattern as
  // /api/dive/state + /api/dive/artifact + src/lib/supabase.ts. A missing
  // student row degrades to the empty-history success shape rather than 500.
  let studentDbId: string | null = null;
  {
    const { data: studentRow, error: studentErr } = await supabase
      .from('students')
      .select('id')
      .eq('auth_user_id', userId)
      .maybeSingle();
    if (studentErr) {
      logger.warn('dive/history: students fetch failed (degrading)', {
        userId, error: studentErr.message,
      });
    }
    if (studentRow) studentDbId = (studentRow as { id: string }).id ?? null;
  }
  if (!studentDbId) {
    return NextResponse.json(
      { artifacts: [] },
      { headers: { 'Cache-Control': 'private, max-age=0, must-revalidate' } },
    );
  }

  const { data, error } = await supabase
    .from('dive_artifacts')
    .select('id, iso_week, picker_option, dive_topic, dive_subjects, phenomenon_slug, title, created_at')
    .eq('student_id', studentDbId)
    .order('iso_week', { ascending: false })
    .limit(limit);

  if (error) {
    logger.warn('dive/history: fetch failed', { userId, error: error.message });
    return NextResponse.json({ error: 'history_fetch_failed' }, { status: 500 });
  }

  return NextResponse.json(
    {
      artifacts: (data ?? []).map((row) => {
        const r = row as {
          id: string;
          iso_week: string;
          picker_option: 'phenomenon' | 'weak_topic' | 'own_topic';
          dive_topic: string;
          dive_subjects: string[];
          phenomenon_slug: string | null;
          title: string;
          created_at: string;
        };
        return {
          id: r.id,
          isoWeek: r.iso_week,
          pickerOption: r.picker_option,
          diveTopic: r.dive_topic,
          diveSubjects: r.dive_subjects ?? [],
          phenomenonSlug: r.phenomenon_slug,
          title: r.title,
          createdAt: r.created_at,
        };
      }),
    },
    { headers: { 'Cache-Control': 'private, max-age=0, must-revalidate' } },
  );
}
