/**
 * Pedagogy v2 — Wave 1B
 * GET /api/rhythm/today
 *
 * Returns today's daily-rhythm queue for the authenticated student:
 *   5 SRS reviews + 1 ZPD problem + 1 reflection
 *
 * Gating: ff_pedagogy_v2_daily_rhythm. When off, returns 404.
 *
 * Queue composition (student lookup, SRS reviews, ZPD targeting, remediation
 * lane) lives in the runtime-agnostic shared module
 * `@alfanumrik/lib/learn/build-rhythm-queue` (moved out of this route
 * verbatim, 2026-07-30, so the WhatsApp bot can reuse it with a service-role
 * client). This route is the auth + flag-gate + per-student-cache wrapper.
 *
 * Spec: docs/superpowers/specs/2026-05-08-pedagogy-v2-three-speed-rhythm-design.md
 */
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { isFeatureEnabled, PEDAGOGY_V2_FLAGS } from '@alfanumrik/lib/feature-flags';
import { buildRhythmQueue } from '@alfanumrik/lib/learn/build-rhythm-queue';
import { logger } from '@alfanumrik/lib/logger';
import { cacheFetchAsync, CACHE_TTL, cacheInvalidatePrefixAsync } from '@alfanumrik/lib/cache';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request) {
  const supabase = await createSupabaseServerClient();

  const auth = await authorizeRequest(_request, 'study_plan.view', { requireStudentId: true });
  if (!auth.authorized || !auth.userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const userId = auth.userId;

  // Flag gate.
  const flagOn = await isFeatureEnabled(PEDAGOGY_V2_FLAGS.DAILY_RHYTHM, {
    userId,
    role: 'student',
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  });
  if (!flagOn) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Phase 5 perf: the daily-rhythm composition below issues ~5 Supabase reads
  // (student row, due reviews, question_bank, curriculum_topics, ZPD pool) and
  // fires on dashboard mount alongside the other per-student aggregate calls.
  // Collapse repeat reads within a 30s window with a SERVER-SIDE cache keyed by
  // userId + day bucket (the reflection prompt + queue rotate daily, so the day
  // belongs in the key). The key includes userId so students NEVER collide
  // (P13: per-student data must never be shared). This is a server cache, NOT a
  // CDN/`s-maxage` header — Vercel's edge does not vary by auth, so a public
  // cache would leak one student's queue to another. This handler has no writes
  // (all reads + read RPCs), so it is safe to cache. The 404 "no profile" path
  // stays OUTSIDE the cache via a sentinel so a transient lookup miss is never
  // pinned.
  const dayKey = Math.floor(Date.now() / 86_400_000);
  let cached: unknown;
  try {
    cached = await cacheFetchAsync<unknown>(
      `rhythm:today:${userId}:${dayKey}`,
      CACHE_TTL.USER,
      async () => {
        const built = await buildRhythmQueue(supabase, userId);
        // A null build (missing profile) is wrapped in a sentinel so the 404
        // branch is reproduced on cache hits without caching a transient miss.
        return built ?? { __noProfile: true };
      },
    );
  } catch (err) {
    // Transient student-lookup failure — surfaced as 500, never cached.
    logger.error('rhythm/today: build failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      userId,
    });
    return NextResponse.json({ error: 'student_lookup_failed' }, { status: 500 });
  }
  if (cached && (cached as { __noProfile?: boolean }).__noProfile) {
    return NextResponse.json({ error: 'no_student_profile' }, { status: 404 });
  }
  return NextResponse.json(cached, {
    headers: { 'Cache-Control': 'private, max-age=0, must-revalidate' },
  });
}

/**
 * POST /api/rhythm/today
 *
 * Cache-bust endpoint: invalidates this student's rhythm queue from both
 * in-memory L1 and Redis L2. Called by quiz/page.tsx after quiz submission
 * so the next GET /api/rhythm/today returns a fresh queue reflecting the
 * student's updated chapter progress.
 *
 * Auth: same as GET — requires authenticated Supabase session.
 * No body required. Returns { ok: true } on success.
 */
export async function POST(_request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: userResult, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResult?.user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const userId = userResult.user.id;

  // Invalidate both L1 and L2 cache for this student's rhythm key.
  // Uses prefix-match so all dayKey variants are busted (handles edge case
  // where POST fires at midnight boundary and GET uses next day's key).
  await cacheInvalidatePrefixAsync(`rhythm:today:${userId}:`);

  return NextResponse.json({ ok: true });
}
